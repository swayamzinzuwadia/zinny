/**
 * The data console (/platform/data): a Super Admin's create, read, update and delete on
 * every table. Only Super Admins get in; names are checked against the catalogue; secrets
 * stay hidden; every change is in the platform activity log.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, departments, universities, users } from "@/db/schema";
import type { Actor } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  CORE_GROUP,
  deleteRows,
  describeTable,
  getRow,
  insertRow,
  instituteOptions,
  isSecretColumn,
  listRows,
  listTables,
  parseArrayInput,
  updateRow,
} from "@/modules/zinny-team-panel/data-console";
import { decodeRowKey, encodeRowKey } from "@/modules/zinny-team-panel/lib/data-links";
import { navFor } from "@/modules/zinny-team-panel/lib/access";
import { activityLog, actionLabel, describeDetails } from "@/modules/zinny-team-panel/services/support";
import { makeUniversity, makeUser, person, uniqueCode } from "../fixtures";
import { team } from "../zinny-team-panel/helpers";

afterAll(closeDb);

let sa: Actor;
let others: { label: string; actor: Actor }[];
let uni: { id: string; name: string };

beforeAll(async () => {
  uni = await makeUniversity("Data Console Institute");
  sa = await team("Dana Super", "super_admin");
  const admin = await person("Ina Admin", "institute_admin", { universityId: uni.id });
  others = [
    { label: "Account Manager", actor: await team("Dc Account", "account_manager") },
    { label: "Support Agent", actor: await team("Dc Support", "support_agent") },
    { label: "Content QA", actor: await team("Dc Content", "content_qa") },
    { label: "Finance Admin", actor: await team("Dc Finance", "finance_admin") },
    { label: "Partnerships", actor: await team("Dc Partners", "partnerships") },
    { label: "institute admin", actor: await admin.actor() },
  ];
});

const auditFor = (action: string, entity: string, entityId: string) =>
  systemDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), eq(auditLog.entity, entity), eq(auditLog.entityId, entityId)));

describe("who can use the data console", () => {
  it("lets a Super Admin in, and shows Data in their sidebar", async () => {
    const groups = await listTables(sa);
    expect(groups.length).toBeGreaterThan(3);
    expect(navFor(sa).some((s) => s.items.some((i) => i.href === "/data"))).toBe(true);
  });

  it("refuses every other platform role and institute admins, for every action", async () => {
    const [dept] = await systemDb().insert(departments).values({ universityId: uni.id, code: uniqueCode(), name: "Guarded" }).returning();
    for (const { label, actor } of others) {
      const calls: [string, () => Promise<unknown>][] = [
        ["listTables", () => listTables(actor)],
        ["describeTable", () => describeTable(actor, "departments")],
        ["listRows", () => listRows(actor, "departments")],
        ["getRow", () => getRow(actor, "departments", [dept.id])],
        ["insertRow", () => insertRow(actor, "departments", { university_id: uni.id, code: uniqueCode(), name: "Nope" })],
        ["updateRow", () => updateRow(actor, "departments", [dept.id], { name: "Hacked" })],
        ["deleteRows", () => deleteRows(actor, "departments", [[dept.id]], "delete")],
        ["instituteOptions", () => instituteOptions(actor)],
      ];
      for (const [name, call] of calls) {
        await expect(call(), `${label} ${name}`).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(navFor(actor).some((s) => s.items.some((i) => i.href === "/data")), label).toBe(false);
    }
    const [still] = await systemDb().select().from(departments).where(eq(departments.id, dept.id));
    expect(still.name).toBe("Guarded");
  });
});

describe("tables index", () => {
  it("lists every table from the catalogue, grouped core first, with exact row counts", async () => {
    const groups = await listTables(sa);
    expect(groups[0].group).toBe(CORE_GROUP);
    const all = groups.flatMap((g) => g.tables);
    const names = all.map((t) => t.name);
    for (const n of ["universities", "users", "audit_log", "plat_plans", "pay_settings", "assess_tests", "site_pages"]) expect(names).toContain(n);
    expect(names.some((n) => n.startsWith("__drizzle"))).toBe(false);
    expect(all.find((t) => t.name === "plat_plans")?.groupLabel).toBe("Zinny team panel");
    expect(all.find((t) => t.name === "plat_partner_contacts")?.label).toBe("Partner contacts");
    const [{ n }] = (await systemDb().execute("select count(*)::int as n from universities")) as unknown as { n: number }[];
    expect(all.find((t) => t.name === "universities")?.rows).toBe(n);
  });

  it("searches by name", async () => {
    const groups = await listTables(sa, { q: "plat_" });
    expect(groups.every((g) => g.group === "plat")).toBe(true);
  });
});

describe("rows: read, add, change, delete", () => {
  it("adds, reads, changes and deletes a department, with an audit entry for each", async () => {
    const code = uniqueCode();
    const key = await insertRow(sa, "departments", { university_id: uni.id, code, name: "Robotics" });
    expect(key).toHaveLength(1);
    const id = key[0];

    const row = await getRow(sa, "departments", key);
    expect(row.row.values).toMatchObject({ id, code, name: "Robotics", university_id: uni.id });
    expect(row.row.values.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(row.institute).toBe("Data Console Institute");

    // The same row through the encoded URL key.
    expect((await getRow(sa, "departments", encodeRowKey(key))).row.key).toEqual(key);

    const added = await auditFor("plat.data.insert", "departments", id);
    expect(added).toHaveLength(1);
    expect(added[0].actorUserId).toBe(sa.userId);
    expect(added[0].data).toMatchObject({ table: "departments", row: id, universityId: uni.id, after: { name: "Robotics", code } });

    // Unchanged values aren't written; only the name changes.
    const changed = await updateRow(sa, "departments", key, { name: "Robotics and AI", code, created_at: row.row.values.created_at });
    expect(changed).toEqual(["name"]);
    expect(await updateRow(sa, "departments", key, { name: "Robotics and AI" })).toEqual([]);
    const upd = await auditFor("plat.data.update", "departments", id);
    expect(upd).toHaveLength(1);
    expect(upd[0].data).toMatchObject({ changed: ["name"], before: { name: "Robotics" }, after: { name: "Robotics and AI" } });

    const page = await listRows(sa, "departments", { q: "robotics and", universityId: uni.id });
    expect(page.rows.map((r) => r.values.id)).toEqual([id]);
    expect(page.institutes[uni.id]).toBe("Data Console Institute");

    expect(await deleteRows(sa, "departments", [key], "delete")).toBe(1);
    await expect(getRow(sa, "departments", key)).rejects.toBeInstanceOf(NotFoundError);
    const del = await auditFor("plat.data.delete", "departments", id);
    expect(del[0].data).toMatchObject({ before: { name: "Robotics and AI" } });
  });

  it("handles enums, defaults, nulls, jsonb and check rules (plat_partners, plat_plans)", async () => {
    const key = await insertRow(sa, "plat_partners", { name: "Acme Learning", kind: "sponsor" });
    let row = (await getRow(sa, "plat_partners", key)).row.values;
    expect(row.status).toBe("prospect"); // the default filled it in
    expect(row.website).toBeNull();
    await expect(updateRow(sa, "plat_partners", key, { kind: "pirate" })).rejects.toThrow(/kind needs one of/);
    await updateRow(sa, "plat_partners", key, { status: "active", website: "https://acme.example", city: null });
    row = (await getRow(sa, "plat_partners", key)).row.values;
    expect(row).toMatchObject({ status: "active", website: "https://acme.example", city: null });
    // An empty text field stays an empty string; ticking null makes it null.
    await updateRow(sa, "plat_partners", key, { website: "" });
    expect((await getRow(sa, "plat_partners", key)).row.values.website).toBe("");
    await updateRow(sa, "plat_partners", key, { website: null });
    expect((await getRow(sa, "plat_partners", key)).row.values.website).toBeNull();
    await expect(updateRow(sa, "plat_partners", key, { name: null })).rejects.toThrow(/name can't be empty/);
    await deleteRows(sa, "plat_partners", [key], "DELETE");

    const planKey = await insertRow(sa, "plat_plans", {
      key: `dc-${uniqueCode().toLowerCase()}`,
      name: "Console plan",
      price_paise: "500000",
      billing_months: "12",
      student_cap: "50",
      staff_cap: "5",
      modules: '["assessments", "live-classes"]',
    });
    const plan = (await getRow(sa, "plat_plans", planKey)).row.values;
    expect(JSON.parse(plan.modules!)).toEqual(["assessments", "live-classes"]);
    expect(plan.gst_rate_bp).toBe("1800");
    await expect(updateRow(sa, "plat_plans", planKey, { modules: "{not json" })).rejects.toThrow(/modules isn't valid JSON/);
    await expect(updateRow(sa, "plat_plans", planKey, { price_paise: "12.5" })).rejects.toThrow(/price_paise needs a whole number/);
    await expect(updateRow(sa, "plat_plans", planKey, { student_cap: "0" })).rejects.toThrow(/breaks a rule on plat_plans \(plat_plan_caps\)/);
    await expect(updateRow(sa, "plat_plans", planKey, { id: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(/primary key/);
    await deleteRows(sa, "plat_plans", [planKey], "delete");
  });

  it("edits text arrays as lines or JSON (custom_roles.actions)", async () => {
    const key = await insertRow(sa, "custom_roles", { university_id: uni.id, kind: "custom_institute", name: `Console ${uniqueCode()}`, actions: "people.view\ncourses.view" });
    expect(JSON.parse((await getRow(sa, "custom_roles", key)).row.values.actions!)).toEqual(["people.view", "courses.view"]);
    await updateRow(sa, "custom_roles", key, { actions: '["people.view"]' });
    expect(JSON.parse((await getRow(sa, "custom_roles", key)).row.values.actions!)).toEqual(["people.view"]);
    expect(parseArrayInput(" a \n\n b ")).toEqual(["a", "b"]);
    await deleteRows(sa, "custom_roles", [key], "delete");
  });

  it("changes an institute's name, logged against that institute", async () => {
    const u = await makeUniversity("Rename Me Institute");
    expect(await updateRow(sa, "universities", [u.id], { name: "Renamed Institute" })).toEqual(["name"]);
    const [after] = await systemDb().select().from(universities).where(eq(universities.id, u.id));
    expect(after.name).toBe("Renamed Institute");
    const log = await activityLog(sa, { scope: "all", universityId: u.id, action: "plat.data.update" });
    expect(log.entries).toHaveLength(1);
    expect(actionLabel(log.entries[0].action)).toBe("Changed a row in Data");
    expect(describeDetails(log.entries[0].data, { action: log.entries[0].action })).toBe(`Table: universities · Row: ${u.id} · Changed: name`);
  });

  it("pages, sorts and filters by a column", async () => {
    const u = await makeUniversity("Paging Institute");
    for (const n of ["Bravo", "Alpha", "Charlie"]) await systemDb().insert(departments).values({ universityId: u.id, code: uniqueCode(), name: n });
    const asc = await listRows(sa, "departments", { universityId: u.id, sort: "name", dir: "asc" });
    expect(asc.rows.map((r) => r.values.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(asc.total).toBe(3);
    const desc = await listRows(sa, "departments", { filter: "university_id", value: u.id, sort: "name", dir: "desc" });
    expect(desc.rows.map((r) => r.values.name)).toEqual(["Charlie", "Bravo", "Alpha"]);
    expect(desc.linkLabels).toBeDefined();
  });

  it("bulk deletes the selected rows, after the word delete is typed", async () => {
    const u = await makeUniversity("Bulk Institute");
    const rows = await systemDb()
      .insert(departments)
      .values(["One", "Two", "Three"].map((name) => ({ universityId: u.id, code: uniqueCode(), name })))
      .returning();
    const keys = rows.slice(0, 2).map((r) => encodeRowKey([r.id]));
    await expect(deleteRows(sa, "departments", keys, "yes")).rejects.toThrow(/Type delete/);
    await expect(deleteRows(sa, "departments", [], "delete")).rejects.toThrow(/Select at least one row/);
    expect(await deleteRows(sa, "departments", keys, "delete")).toBe(2);
    const left = await systemDb().select().from(departments).where(eq(departments.universityId, u.id));
    expect(left.map((d) => d.name)).toEqual(["Three"]);
  });
});

describe("delete refused when other rows point at a row", () => {
  it("says how many rows in which table, in plain words, and deletes nothing", async () => {
    const u = await makeUser("Pointed At");
    await systemDb()
      .insert(auditLog)
      .values([1, 2].map(() => ({ actorUserId: u.id, action: "test.touch", entity: "user", entityId: u.id })));
    await expect(deleteRows(sa, "users", [[u.id]], "delete")).rejects.toThrow("Can't delete: 2 rows in audit_log point to this. Delete those first.");
    const [still] = await systemDb().select().from(users).where(eq(users.id, u.id));
    expect(still).toBeDefined();
    expect(await auditFor("plat.data.delete", "users", u.id)).toHaveLength(0);
  });

  it("says when a link points at a row that doesn't exist", async () => {
    await expect(insertRow(sa, "departments", { university_id: "00000000-0000-4000-8000-000000000000", code: uniqueCode(), name: "Orphan" })).rejects.toThrow(
      "The value in university_id doesn't match any row in universities. Use the id of a row that exists there.",
    );
    await expect(insertRow(sa, "departments", { code: uniqueCode(), name: "No institute" })).rejects.toThrow(/university_id can't be empty in departments/);
  });
});

describe("secrets", () => {
  it("masks password hashes and tokens, refuses to change them, and keeps them out of the log", async () => {
    expect(["password_hash", "token_hash", "code_hash", "client_secret", "api_token"].every(isSecretColumn)).toBe(true);
    expect(isSecretColumn("name")).toBe(false);
    const u = await makeUser("Secret Keeper");
    await systemDb().update(users).set({ passwordHash: "$2b$10$abcdefghijklmnopqrstuv" }).where(eq(users.id, u.id));

    const detail = await getRow(sa, "users", [u.id]);
    expect(detail.row.values.password_hash).toBe("••••••");
    const list = await listRows(sa, "users", { q: u.email });
    expect(list.rows[0].values.password_hash).toBe("••••••");
    expect(JSON.stringify(list)).not.toContain("$2b$10$");

    await expect(updateRow(sa, "users", [u.id], { password_hash: "x" })).rejects.toThrow(/hidden and can't be changed here\. Use Set password/);
    await expect(insertRow(sa, "users", { email: `s.${uniqueCode()}@test.zinny`, name: "S", password_hash: "x" })).rejects.toThrow(/hidden/);
    await expect(listRows(sa, "users", { sort: "password_hash" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listRows(sa, "users", { filter: "password_hash", value: "x" })).rejects.toBeInstanceOf(ValidationError);
    // Searching never matches inside a hidden column.
    expect((await listRows(sa, "users", { q: "$2b$10$abcdefghijk" })).total).toBe(0);

    await updateRow(sa, "users", [u.id], { name: "Secret Keeper Two" });
    const [entry] = await auditFor("plat.data.update", "users", u.id);
    expect(JSON.stringify(entry.data)).not.toContain("$2b$10$");
    expect((entry.data as { before: Record<string, string> }).before.password_hash).toBe("••••••");
    const [stored] = await systemDb().select().from(users).where(eq(users.id, u.id));
    expect(stored.passwordHash).toBe("$2b$10$abcdefghijklmnopqrstuv");
  });
});

describe("injection attempts", () => {
  it("refuses table names that aren't in the catalogue", async () => {
    for (const bad of ['users"; drop table users; --', '"users"', "public.users", "pg_authid", "information_schema.tables", "USERS", "", "users "]) {
      await expect(listRows(sa, bad)).rejects.toBeInstanceOf(NotFoundError);
      await expect(describeTable(sa, bad)).rejects.toBeInstanceOf(NotFoundError);
      await expect(insertRow(sa, bad, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
      await expect(deleteRows(sa, bad, [["x"]], "delete")).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("refuses column and sort names that aren't the table's", async () => {
    const u = await makeUser("Injection Target");
    for (const bad of ['name" = \'x\'; --', "name; drop table users", "1", "id desc, (select 1)", "NAME"]) {
      await expect(listRows(sa, "users", { sort: bad })).rejects.toBeInstanceOf(ValidationError);
      await expect(listRows(sa, "users", { filter: bad, value: "x" })).rejects.toBeInstanceOf(ValidationError);
      await expect(updateRow(sa, "users", [u.id], { [bad]: "x" })).rejects.toBeInstanceOf(ValidationError);
      await expect(insertRow(sa, "users", { [bad]: "x" })).rejects.toBeInstanceOf(ValidationError);
    }
    // A bad sort direction falls back to a safe one.
    const page = await listRows(sa, "users", { sort: "name", dir: "desc; drop table users" as "asc" });
    expect(page.dir).toBe("asc");
  });

  it("treats values, searches and keys as data only", async () => {
    const u = await makeUser("Value Target");
    const evil = "Robert'); drop table users; --";
    await updateRow(sa, "users", [u.id], { name: evil });
    const [stored] = await systemDb().select().from(users).where(eq(users.id, u.id));
    expect(stored.name).toBe(evil);
    expect((await listRows(sa, "users", { q: "' or '1'='1" })).total).toBe(0);
    expect((await listRows(sa, "users", { q: "drop table users; --" })).rows.map((r) => r.values.id)).toContain(u.id);
    await expect(getRow(sa, "users", ["' or 1=1 --"])).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRow(sa, "users", "not-a-key!")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRow(sa, "users", [u.id, "extra"])).rejects.toBeInstanceOf(NotFoundError);
    expect(decodeRowKey(encodeRowKey(["a", "b"]))).toEqual(["a", "b"]);
    expect(decodeRowKey("e30")).toBeNull(); // {} isn't a key
    await expect(listRows(sa, "departments", { universityId: "x' or 1=1" })).rejects.toBeInstanceOf(ValidationError);
    // The users table is still there.
    expect((await listRows(sa, "users")).total).toBeGreaterThan(0);
  });
});
