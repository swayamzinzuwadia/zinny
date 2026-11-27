/**
 * Row-level security coverage, read from the live catalogue (security review DATA-01, DATA-02,
 * DATA-03, DATA-04). These fail the moment a table, a grant or a role drifts:
 *   - every table holding university data has row-level security enabled AND forced, with the
 *     one tenant policy and nothing that widens it;
 *   - every other table is forced too (deny-all for anyone but the owner);
 *   - the app role is bound by row-level security and holds only the grants it uses;
 *   - no other role (PUBLIC, a hosting provider's API roles) keeps any privilege;
 *   - without a tenant the app role sees nothing, and the tenant can't be injected.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { appDb, closeDb, systemDb } from "@/db/client";
import { departments, roleAssignments } from "@/db/schema";
import { withTenant } from "@/server/tenant";
import type { Actor } from "@/server/authz/engine";
import { applyPolicies, verifyAppRole } from "../../scripts/db-push";
import { makeDepartment, makeUniversity, makeUser, grant, uniqueCode } from "../fixtures";

afterAll(closeDb);

type Rel = { relname: string; rls: boolean; forced: boolean; tenant: boolean };

async function relations(): Promise<Rel[]> {
  return (await systemDb().execute(sql`
    select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'university_id' and not a.attisdropped) as tenant
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname`)) as unknown as Rel[];
}

type Policy = { relname: string; polname: string; cmd: string; permissive: boolean; qual: string | null; check: string | null; roles: string[] };

async function policies(): Promise<Policy[]> {
  return (await systemDb().execute(sql`
    select c.relname, p.polname, p.polcmd::text as cmd, p.polpermissive as permissive,
           pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as check,
           array(select case when r = 0 then 'public' else pg_get_userbyid(r) end from unnest(p.polroles) r) as roles
      from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'`)) as unknown as Policy[];
}

/** Every privilege a role holds on public tables, as "table:PRIVILEGE" (and "table.column:PRIVILEGE"). */
async function privilegesOf(role: string): Promise<string[]> {
  const rows = (await systemDb().execute(sql`
    select c.relname || ':' || a.privilege_type as p
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) a
     where n.nspname = 'public' and a.grantee = (select oid from pg_roles where rolname = ${role})
    union all
    select c.relname || '.' || att.attname || ':' || a.privilege_type
      from pg_attribute att join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(att.attacl) a
     where n.nspname = 'public' and att.attacl is not null and a.grantee = (select oid from pg_roles where rolname = ${role})
     order by 1`)) as unknown as { p: string }[];
  return rows.map((r) => r.p);
}

describe("row-level security covers every table", () => {
  it("every table with a university_id column has row-level security enabled and forced", async () => {
    const tenant = (await relations()).filter((r) => r.tenant);
    expect(tenant.length, "the catalogue should list the tenant tables").toBeGreaterThan(100);
    const weak = tenant.filter((r) => !r.rls || !r.forced).map((r) => `${r.relname} (enabled ${r.rls}, forced ${r.forced})`);
    expect(weak, "tables holding university data without forced row-level security").toEqual([]);
  });

  it("each of them has exactly the tenant policy, for every command and role, filtering on university_id both ways", async () => {
    const tenant = new Set((await relations()).filter((r) => r.tenant && r.relname !== "universities").map((r) => r.relname));
    const byTable = new Map<string, Policy[]>();
    for (const p of await policies()) byTable.set(p.relname, [...(byTable.get(p.relname) ?? []), p]);
    const wrong: string[] = [];
    for (const t of tenant) {
      const ps = byTable.get(t) ?? [];
      const ok =
        ps.length === 1 &&
        ps[0].polname === "tenant_isolation" &&
        ps[0].cmd === "*" &&
        ps[0].permissive &&
        ps[0].roles.join() === "public" &&
        ps[0].qual === "(university_id = zinny_current_university())" &&
        ps[0].check === "(university_id = zinny_current_university())";
      if (!ok) wrong.push(`${t}: ${JSON.stringify(ps.map((p) => [p.polname, p.cmd, p.qual, p.check]))}`);
    }
    expect(wrong).toEqual([]);
  });

  it("the new onboarding, privacy and seat-pack tables are among them", async () => {
    const tenant = (await relations()).filter((r) => r.tenant && r.rls && r.forced).map((r) => r.relname);
    for (const t of ["onb_documents", "onb_student_kyc", "onb_signups", "onb_plan_orders", "dpdp_consents", "dpdp_requests", "dpdp_guardian_consents", "dpdp_settings", "dpdp_retention_flags", "plat_seat_packs"]) {
      expect(tenant, t).toContain(t);
    }
  });

  it("every other table is forced too, so it is deny-all for anyone but the owner", async () => {
    const rest = (await relations()).filter((r) => !r.tenant);
    expect(rest.map((r) => r.relname)).toEqual(expect.arrayContaining(["sessions", "idn_tokens", "dpdp_breaches", "plat_plans"]));
    expect(rest.filter((r) => !r.rls || !r.forced).map((r) => r.relname)).toEqual([]);
    const ps = await policies();
    const open = ps.filter((p) => rest.some((r) => r.relname === p.relname) && !["users", "universities"].includes(p.relname));
    expect(open, "tables without university_id must have no policy that lets anyone in").toEqual([]);
  });

  it("users and universities keep their own policies: your own university row, and people who hold a role in it", async () => {
    const ps = await policies();
    const uni = ps.filter((p) => p.relname === "universities");
    expect(uni.map((p) => [p.polname, p.qual, p.check])).toEqual([["own_university", "(id = zinny_current_university())", "(id = zinny_current_university())"]]);
    const people = ps.filter((p) => p.relname === "users");
    expect(people.map((p) => p.polname)).toEqual(["visible_users"]);
    expect(people[0].qual).toContain("zinny_current_user()");
    expect(people[0].qual).toContain("zinny_current_university()");
  });
});

describe("the app role is bound by row-level security and holds only what it uses", () => {
  it("is not a superuser, has no BYPASSRLS, can't create roles or databases, owns nothing and isn't in the owner role", async () => {
    const [me] = (await appDb().execute(sql`
      select current_user as name, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
             pg_has_role(current_user, (select relowner from pg_class where relname = 'users' and relnamespace = 'public'::regnamespace), 'member') as in_owner,
             (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relowner = r.oid) as owns,
             has_schema_privilege(current_user, 'public', 'create') as can_create
        from pg_roles r where r.rolname = current_user`)) as unknown as {
      name: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
      in_owner: boolean;
      owns: number;
      can_create: boolean;
    }[];
    expect(me).toEqual({ name: "zinny_app", rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, in_owner: false, owns: 0, can_create: false });
  });

  it("gets select/insert/update/delete on tenant tables (select/insert on the two logs), and nothing else", async () => {
    const privs = await privilegesOf("zinny_app");
    const rels = await relations();
    const expected: string[] = [];
    for (const r of rels) {
      if (r.relname === "users" || r.relname === "universities") continue;
      if (!r.tenant) continue;
      const kinds = ["audit_log", "domain_events"].includes(r.relname) ? ["INSERT", "SELECT"] : ["DELETE", "INSERT", "SELECT", "UPDATE"];
      for (const k of kinds) expected.push(`${r.relname}:${k}`);
    }
    expected.push("universities:SELECT", "universities.gst_enabled:UPDATE");
    expected.push("users:SELECT", "users.email:UPDATE", "users.name:UPDATE", "users.password_hash:UPDATE", "users.phone:UPDATE");
    expect([...privs].sort()).toEqual(expected.sort());
  });

  it("can run only the three Zinny functions in public", async () => {
    const rows = (await systemDb().execute(sql`
      select p.proname, has_function_privilege('zinny_app', p.oid, 'execute') as app, has_function_privilege('public', p.oid, 'execute') as everyone
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`)) as unknown as { proname: string; app: boolean; everyone: boolean }[];
    expect(rows.filter((r) => r.app).map((r) => r.proname)).toEqual(["zinny_current_university", "zinny_current_user", "zinny_upsert_user"]);
    expect(rows.filter((r) => r.everyone).map((r) => r.proname)).toEqual([]);
  });

  it("a deploy refuses a DATABASE_URL that would bypass row-level security", async () => {
    await expect(verifyAppRole(process.env.DATABASE_URL!)).resolves.toBeUndefined();
    await expect(verifyAppRole(process.env.DATABASE_URL_OWNER!)).rejects.toThrow(/row-level security would not keep institutes apart/);
  });
});

describe("no other role can reach the tables", () => {
  it("PUBLIC holds nothing on any table in public", async () => {
    const rows = (await systemDb().execute(sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(c.relacl) a
       where n.nspname = 'public' and a.grantee = 0`)) as unknown as { relname: string }[];
    expect(rows).toEqual([]);
  });

  it("grants a hosting provider's API role picked up (like Supabase's anon) are taken back when the policies are applied", async () => {
    const role = `zinny_probe_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const owner = postgres(process.env.DATABASE_URL_OWNER!, { max: 1, onnotice: () => {} });
    try {
      await owner.unsafe(`create role ${role} nologin`);
      await owner.unsafe(`grant usage on schema public to ${role}`);
      await owner.unsafe(`grant all on all tables in schema public to ${role}`);
      await owner.unsafe(`grant execute on function zinny_upsert_user(text, text, text) to ${role}`);
      await owner.unsafe(`grant select on sessions, idn_tokens to public`);
      expect((await privilegesOf(role)).length).toBeGreaterThan(100);

      await applyPolicies(process.env.DATABASE_URL_OWNER!);

      expect(await privilegesOf(role)).toEqual([]);
      const [fn] = await owner.unsafe(`select has_function_privilege('${role}', 'zinny_upsert_user(text, text, text)', 'execute') as can`);
      expect(fn.can).toBe(false);
      const pub = await owner.unsafe(`select count(*)::int as n from pg_class c cross join lateral aclexplode(c.relacl) a where c.relname in ('sessions', 'idn_tokens') and a.grantee = 0`);
      expect(pub[0].n).toBe(0);
    } finally {
      await owner.unsafe(`drop owned by ${role}`).catch(() => undefined);
      await owner.unsafe(`drop role if exists ${role}`).catch(() => undefined);
      await owner.end();
    }
  });
});

describe("the tenant comes only from the signed-in actor", () => {
  it("without a tenant set, the app role sees no row of any table holding university data, nor any person or university", async () => {
    const A = await makeUniversity("No Tenant A");
    await makeDepartment(A.id, uniqueCode(), "Visible only inside A");
    const u = await makeUser("No Tenant Person");
    await grant(u.id, "student", { universityId: A.id });
    const tables = (await relations()).filter((r) => r.tenant).map((r) => r.relname);
    const seen: string[] = [];
    for (const t of tables) {
      const [{ n }] = (await appDb().execute(sql`select count(*)::int as n from ${sql.identifier(t)}`)) as unknown as { n: number }[];
      if (n > 0) seen.push(`${t}: ${n}`);
    }
    expect(seen).toEqual([]);
    const [{ n }] = (await appDb().execute(sql`select count(*)::int as n from users`)) as unknown as { n: number }[];
    expect(n).toBe(0);
  });

  it("without a tenant set, the app role can't write a row for any university", async () => {
    const A = await makeUniversity("No Tenant Write");
    await expect(appDb().insert(departments).values({ universityId: A.id, code: uniqueCode(), name: "Smuggled" })).rejects.toThrow();
  });

  it("an institute can't give anyone a Zinny team role, even writing to the table directly", async () => {
    const A = await makeUniversity("No Platform Roles");
    const u = await makeUser("Would Be Super");
    const actor: Actor = { userId: randomUUID(), name: "Sys", email: "", universityId: A.id, assignments: [], supportSessionId: null };
    // A platform role has no institute, so row-level security refuses it...
    await expect(
      withTenant(actor, (tx) => tx.insert(roleAssignments).values({ userId: u.id, role: "super_admin", scopeType: "platform", universityId: null })),
    ).rejects.toThrow();
    // ...and with the institute's id, the table's own check refuses it.
    await expect(
      withTenant(actor, (tx) => tx.insert(roleAssignments).values({ userId: u.id, role: "super_admin", scopeType: "platform", universityId: A.id })),
    ).rejects.toThrow();
    const held = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, u.id));
    expect(held).toEqual([]);
  });

  it("the tenant id is a bound parameter: SQL in it is refused, not run", async () => {
    const A = await makeUniversity("Injection A");
    await makeDepartment(A.id, uniqueCode(), "Something to read");
    const evil: Actor = {
      userId: randomUUID(),
      name: "Mallory",
      email: "mallory@example.com",
      universityId: `${A.id}', true); drop table departments; --`,
      assignments: [],
      supportSessionId: null,
    };
    await expect(withTenant(evil, (tx) => tx.select().from(departments))).rejects.toThrow();
    const [{ n }] = (await systemDb().execute(sql`select count(*)::int as n from pg_class where relname = 'departments'`)) as unknown as { n: number }[];
    expect(n).toBe(1);
  });

  it("the tenant is local to the transaction: the next query on the pool has none", async () => {
    const A = await makeUniversity("Local Setting A");
    const actor: Actor = { userId: randomUUID(), name: "Sys", email: "", universityId: A.id, assignments: [], supportSessionId: null };
    for (let i = 0; i < 5; i++) {
      const inside = await withTenant(actor, async (tx) => {
        const [r] = (await tx.execute(sql`select zinny_current_university()::text as u`)) as unknown as { u: string | null }[];
        return r.u;
      });
      expect(inside).toBe(A.id);
      const [after] = (await appDb().execute(sql`select zinny_current_university()::text as u`)) as unknown as { u: string | null }[];
      expect(after.u).toBeNull();
    }
  });
});
