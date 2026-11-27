/**
 * AUTH-05: support mode makes a Zinny team member Institute Admin of one institute for two
 * hours. From inside it they could give themselves a lasting role there (Institute Admin
 * included), so the access outlived the session and its time limit. They no longer can.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { roleAssignments, supportSessions } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { ForbiddenError } from "@/server/errors";
import { addPerson, assignRole, importPeople, teachMyselfTx } from "@/server/services/users";
import { withTenant } from "@/server/tenant";
import { grant, makeDepartment, makeUniversity, makeUser, person, uniqueCode } from "../fixtures";

afterAll(closeDb);

async function supportScene() {
  const uni = await makeUniversity("Support Mode U");
  const agent = await makeUser("Sam Support");
  await grant(agent.id, "support_agent");
  await systemDb().insert(supportSessions).values({ staffUserId: agent.id, universityId: uni.id, reason: "Fixing an import", expiresAt: new Date(Date.now() + 3_600_000) });
  const actor = await loadActor(agent.id, uni.id, { session: null });
  expect(actor.supportSessionId).toBeTruthy();
  return { uni, agent, actor };
}

const heldHere = (userId: string, universityId: string) =>
  systemDb().select().from(roleAssignments).where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.universityId, universityId), isNull(roleAssignments.revokedAt)));

describe("AUTH-05: support mode can't be made permanent", () => {
  it("refuses giving yourself a role, by id, by email, by CSV or as a teacher", async () => {
    const { uni, agent, actor } = await supportScene();
    const dept = await makeDepartment(uni.id, uniqueCode(), "Science");
    await expect(assignRole(actor, { userId: agent.id, role: "institute_admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addPerson(actor, { name: "Sam Support", email: agent.email, role: "institute_admin" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(importPeople(actor, `name,email,role\nSam Support,${agent.email},board_owner`, { commit: true })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(withTenant(actor, (tx) => teachMyselfTx(tx, actor, dept.id))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await heldHere(agent.id, uni.id)).toHaveLength(0);
  });

  it("still lets support add and fix other people's roles", async () => {
    const { uni, actor } = await supportScene();
    const userId = await addPerson(actor, { name: "New Accountant", email: `acct.${Date.now()}@test.zinny`, role: "accounts_fees" });
    expect((await heldHere(userId, uni.id)).map((r) => r.role)).toEqual(["accounts_fees"]);
  });

  it("an Institute Admin outside support mode can still put themselves on the teaching staff", async () => {
    const uni = await makeUniversity("Self Teach U");
    const dept = await makeDepartment(uni.id, uniqueCode(), "Maths");
    const admin = await person("Owner Teaches", "institute_admin", { universityId: uni.id });
    const actor = await admin.actor();
    await withTenant(actor, (tx) => teachMyselfTx(tx, actor, dept.id));
    expect((await heldHere(admin.user.id, uni.id)).map((r) => r.role).sort()).toEqual(["institute_admin", "permanent_faculty"]);
  });
});
