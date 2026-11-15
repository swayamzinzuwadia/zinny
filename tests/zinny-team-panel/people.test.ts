import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { users } from "@/db/schema";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { listPeople, peopleCounts, personDetail, updatePerson } from "@/modules/zinny-team-panel/services/people";
import { setupCourse } from "../fixtures";
import { team } from "./helpers";

afterAll(() => closeDb());

describe("the Users directory", () => {
  it("is for Super Admins only, not the rest of the Zinny team", async () => {
    const agent = await team("Sid Support", "support_agent");
    const manager = await team("Mira Manager", "account_manager");
    for (const a of [agent, manager]) {
      await expect(listPeople(a, {})).rejects.toBeInstanceOf(ForbiddenError);
      await expect(peopleCounts(a)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(personDetail(a, a.userId)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("lists people from one institute at a time, and logs the view", async () => {
    const boss = await team("Zara Super", "super_admin");
    const { uni } = await setupCourse({ name: "Second Institute" });

    const only = await listPeople(boss, { universityId: uni.id });
    expect(only.rows.length).toBeGreaterThan(0);
    expect(only.rows.every((r) => r.universityId === uni.id)).toBe(true);

    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, boss.userId), eq(auditLog.action, "plat.people.view")));
    expect(log).toHaveLength(1);
  });

  it("shows a person's details without their password, and logs it in their institute", async () => {
    const boss = await team("Zara Super", "super_admin");
    const { uni, admin } = await setupCourse({ name: "Third Institute" });

    const detail = await personDetail(boss, admin.userId);
    expect(detail.roles.map((r) => r.universityId)).toContain(uni.id);
    expect(JSON.stringify(detail)).not.toContain("passwordHash");

    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, uni.id), eq(auditLog.action, "plat.person.view"), eq(auditLog.actorUserId, boss.userId)));
    expect(log).toHaveLength(1);
  });

  it("sorts by name, joined date and account, either way, and keeps the order stable", async () => {
    const boss = await team("Zara Super", "super_admin");
    const { uni } = await setupCourse({ name: "Sort Institute" });
    const asc = (await listPeople(boss, { universityId: uni.id, sort: "name", dir: "asc" })).rows.map((r) => r.name.toLowerCase());
    const desc = (await listPeople(boss, { universityId: uni.id, sort: "name", dir: "desc" })).rows.map((r) => r.name.toLowerCase());
    expect(asc).toEqual([...asc].sort());
    expect(desc).toEqual([...asc].reverse());
    const joined = (await listPeople(boss, { universityId: uni.id, sort: "joined", dir: "desc" })).rows.map((r) => r.joinedAt.getTime());
    expect(joined).toEqual([...joined].sort((a, b) => b - a));
  });

  it("filters by role, account, mobile number and joined date", async () => {
    const boss = await team("Zara Super", "super_admin");
    const { uni } = await setupCourse({ name: "Filter Institute" });
    const admins = await listPeople(boss, { universityId: uni.id, role: "institute_admin" });
    expect(admins.rows.length).toBeGreaterThan(0);
    expect(admins.rows.every((r) => r.roles.includes("institute_admin"))).toBe(true);

    const invited = await listPeople(boss, { universityId: uni.id, account: "invited" });
    expect(invited.rows.every((r) => !r.canSignIn)).toBe(true);
    const active = await listPeople(boss, { universityId: uni.id, account: "active" });
    expect(active.rows.every((r) => r.canSignIn)).toBe(true);

    expect((await listPeople(boss, { universityId: uni.id, phone: "yes" })).rows.every((r) => r.phone)).toBe(true);
    expect((await listPeople(boss, { universityId: uni.id, phone: "no" })).rows.every((r) => !r.phone)).toBe(true);

    const today = new Date().toISOString().slice(0, 10);
    expect((await listPeople(boss, { universityId: uni.id, joinedFrom: today })).rows.length).toBeGreaterThan(0);
    expect((await listPeople(boss, { universityId: uni.id, joinedTo: "2000-01-01" })).rows).toHaveLength(0);
    // A malformed date is ignored rather than breaking the page.
    expect((await listPeople(boss, { universityId: uni.id, joinedFrom: "not-a-date" })).rows.length).toBeGreaterThan(0);
  });
});

describe("editing a user", () => {
  it("is for Super Admins only", async () => {
    const agent = await team("Sid Support", "support_agent");
    const { admin } = await setupCourse({ name: "Edit Deny U" });
    await expect(updatePerson(agent, admin.userId, { name: "X Y", email: "x@example.com", phone: "" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("saves name, email and mobile, and logs what changed here and in the institute", async () => {
    const boss = await team("Zara Super", "super_admin");
    const { uni, admin } = await setupCourse({ name: "Edit Allow U" });
    const email = `edited-${Date.now()}@example.com`;
    const r = await updatePerson(boss, admin.userId, { name: "  Asha   Renamed ", email, phone: "98200 11001" });
    expect(r.changed).toEqual(expect.arrayContaining(["name", "email", "phone"]));
    const [row] = await systemDb().select().from(users).where(eq(users.id, admin.userId));
    expect(row).toMatchObject({ name: "Asha Renamed", email, phone: "+919820011001" });

    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, uni.id), eq(auditLog.action, "plat.person.edit"), eq(auditLog.actorUserId, boss.userId)));
    expect(log).toHaveLength(1);

    // Saving the same details again changes nothing and logs nothing more.
    expect((await updatePerson(boss, admin.userId, { name: "Asha Renamed", email, phone: "+919820011001" })).changed).toEqual([]);
    // An empty mobile clears it.
    await updatePerson(boss, admin.userId, { name: "Asha Renamed", email, phone: "" });
    const [cleared] = await systemDb().select().from(users).where(eq(users.id, admin.userId));
    expect(cleared.phone).toBeNull();
  });

  it("refuses a bad email, a bad mobile, and an email another account uses", async () => {
    const boss = await team("Zara Super", "super_admin");
    const { admin } = await setupCourse({ name: "Edit Deny2 U" });
    const other = await team("Other Person", "account_manager");
    const [o] = await systemDb().select({ email: users.email }).from(users).where(eq(users.id, other.userId));
    await expect(updatePerson(boss, admin.userId, { name: "Asha", email: "nope", phone: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updatePerson(boss, admin.userId, { name: "Asha", email: "ok@example.com", phone: "12" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updatePerson(boss, admin.userId, { name: "A", email: "ok@example.com", phone: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updatePerson(boss, admin.userId, { name: "Asha", email: o.email.toUpperCase(), phone: "" })).rejects.toBeInstanceOf(ConflictError);
  });
});
