import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";

/**
 * Every table holding university data is protected by row-level security, automatically.
 * This fails as soon as a table (core or any module's) slips through.
 */
const owner = postgres(process.env.DATABASE_URL_OWNER!, { max: 1, onnotice: () => {} });
afterAll(() => owner.end());

const SPECIAL = ["users", "universities"];
const APPEND_ONLY = ["audit_log", "domain_events"];

async function tables() {
  return owner<{ name: string; rls: boolean; hasUni: boolean }[]>`
    select c.relname as name, c.relrowsecurity as rls,
      exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'university_id' and not a.attisdropped) as "hasUni"
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by 1`;
}

async function privileges(table: string) {
  const [p] = await owner<{ select: boolean; insert: boolean; update: boolean; delete: boolean }[]>`
    select has_table_privilege('zinny_app', ${`public.${table}`}, 'SELECT') as select,
           has_table_privilege('zinny_app', ${`public.${table}`}, 'INSERT') as insert,
           has_table_privilege('zinny_app', ${`public.${table}`}, 'UPDATE') as update,
           has_table_privilege('zinny_app', ${`public.${table}`}, 'DELETE') as delete`;
  return p;
}

describe("row-level security covers every table", () => {
  it("finds the core tables (sanity check)", async () => {
    const names = (await tables()).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["courses", "enrolments", "domain_events", "content_sections", "content_lessons"]));
  });

  it("every table with university_id has RLS enabled and the tenant_isolation policy", async () => {
    const policies = await owner<{ table: string; qual: string; check: string }[]>`
      select tablename as table, qual, with_check as check from pg_policies
      where schemaname = 'public' and policyname = 'tenant_isolation'`;
    const byTable = new Map(policies.map((p) => [p.table, p]));
    const missing: string[] = [];
    for (const t of (await tables()).filter((x) => x.hasUni && !SPECIAL.includes(x.name))) {
      const p = byTable.get(t.name);
      const ok = t.rls && p && /zinny_current_university\(\)/.test(p.qual) && /zinny_current_university\(\)/.test(p.check ?? "");
      if (!ok) missing.push(t.name);
    }
    expect(missing).toEqual([]);
  });

  it("the app role can use every university table, append-only for the audit log and events", async () => {
    const wrong: string[] = [];
    for (const t of (await tables()).filter((x) => x.hasUni && !SPECIAL.includes(x.name))) {
      const p = await privileges(t.name);
      const appendOnly = APPEND_ONLY.includes(t.name);
      const expected = { select: true, insert: true, update: !appendOnly, delete: !appendOnly };
      if (JSON.stringify(p) !== JSON.stringify(expected)) wrong.push(`${t.name}: ${JSON.stringify(p)}`);
    }
    expect(wrong).toEqual([]);
  });

  it("the app role can't touch any table without university_id except users and universities", async () => {
    const leaking: string[] = [];
    for (const t of (await tables()).filter((x) => !x.hasUni && !SPECIAL.includes(x.name))) {
      const p = await privileges(t.name);
      if (p.select || p.insert || p.update || p.delete) leaking.push(t.name);
    }
    expect(leaking).toEqual([]);
  });

  it("users and universities keep their own policies", async () => {
    const rows = await owner<{ table: string; policy: string }[]>`
      select tablename as table, policyname as policy from pg_policies
      where schemaname = 'public' and tablename in ('users', 'universities') order by 1`;
    expect(rows).toEqual([
      { table: "universities", policy: "own_university" },
      { table: "users", policy: "visible_users" },
    ]);
    expect(await privileges("users")).toEqual({ select: true, insert: false, update: true, delete: false });
    expect(await privileges("universities")).toEqual({ select: true, insert: false, update: true, delete: false });
  });

  it("a brand-new table is protected as soon as policies.sql runs, and nothing is granted by default", async () => {
    await owner.unsafe(`
      drop table if exists zz_rls_probe, zz_rls_probe_global;
      create table zz_rls_probe (id serial primary key, university_id uuid not null references universities(id));
      create table zz_rls_probe_global (id serial primary key, note text);`);
    try {
      expect((await privileges("zz_rls_probe_global")).select).toBe(false);
      const { readFileSync } = await import("node:fs");
      await owner.unsafe(readFileSync("src/db/policies.sql", "utf8"));
      const [t] = (await tables()).filter((x) => x.name === "zz_rls_probe");
      expect(t.rls).toBe(true);
      expect(await privileges("zz_rls_probe")).toEqual({ select: true, insert: true, update: true, delete: true });
      expect(await privileges("zz_rls_probe_global")).toEqual({ select: false, insert: false, update: false, delete: false });
    } finally {
      await owner.unsafe(`drop table if exists zz_rls_probe, zz_rls_probe_global;`);
    }
  });
});

describe("expectTenantIsolated", () => {
  it("passes for core tables, including the event outbox", async () => {
    const { expectTenantIsolated } = await import("../helpers/isolation");
    const { domainEvents, notifications } = await import("@/db/schema");
    const { makeUser } = await import("../fixtures");
    const u = await makeUser("Isolated Person");
    await expectTenantIsolated(notifications, (uni) => ({ universityId: uni.id, userId: u.id, kind: "test", title: "Hello" }));
    await expectTenantIsolated(domainEvents, (uni) => ({ universityId: uni.id, type: "lesson.completed", payload: { userId: u.id } }));
  });

  it("fails for a table without row-level security", async () => {
    const { expectTenantIsolated } = await import("../helpers/isolation");
    const { pgTable, serial, uuid } = await import("drizzle-orm/pg-core");
    await owner.unsafe(`drop table if exists zz_leaky; create table zz_leaky (id serial primary key, university_id uuid not null references universities(id));
      grant select, insert, update, delete on zz_leaky to zinny_app; grant usage on sequence zz_leaky_id_seq to zinny_app;`);
    const leaky = pgTable("zz_leaky", { id: serial("id").primaryKey(), universityId: uuid("university_id").notNull() });
    try {
      await expect(expectTenantIsolated(leaky, (uni) => ({ universityId: uni.id }))).rejects.toThrow(/must not see/);
    } finally {
      await owner.unsafe(`drop table if exists zz_leaky`);
    }
  });
});
