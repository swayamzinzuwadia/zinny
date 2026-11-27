/**
 * "Sign in as" (a Super Admin inside someone's account for two hours).
 *
 * AUTH-04: while signed in as someone, the Super Admin could change that person's mobile number
 * to their own and keep signing in as them with a phone code after the two hours, or sign the
 * person out of every device. How someone signs in now stays theirs.
 *
 * AUTH-07: Zinny team actions taken while signed in as another team member were logged as that
 * member alone. The real Super Admin is now in every such entry.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { loadActor } from "@/server/actor";
import { ForbiddenError } from "@/server/errors";
import { grantPlatformRole, revokePlatformRole, setTrialState, updateUniversity } from "@/server/services/core-api";
import { enterSupportMode, exitSupportMode } from "@/server/services/support";
import { changePassword, removePhone, signOutEverywhere, signOutSession, startPhoneChange, verifyPhoneChange } from "@/modules/identity/profile";
import { grant, makeUniversity, makeUser, person } from "../fixtures";
import { resetOutbox, setPassword, useIdentityOnly } from "../identity/helpers";

beforeAll(() => useIdentityOnly());
beforeEach(() => resetOutbox());
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

async function superAdmin(name: string) {
  const u = await makeUser(name);
  await grant(u.id, "super_admin");
  return u;
}

/** The actor a request has while `admin` is signed in as `userId` (what loadActor builds from the session). */
const signedInAs = (userId: string, universityId: string | null, admin: { id: string }) =>
  loadActor(userId, universityId, { session: { userId, impersonatorUserId: admin.id } });

describe("AUTH-04: a Super Admin signed in as someone can't change how that person signs in", () => {
  it("refuses a new mobile number, removing it, a new password and signing devices out", async () => {
    const zara = await superAdmin("Zara Behind");
    const uni = await makeUniversity("Signed In As U");
    const asha = await person("Asha Target", "institute_admin", { universityId: uni.id });
    await setPassword(asha.user.id, "asha own pass phrase");
    const actor = await signedInAs(asha.user.id, uni.id, zara);
    expect(actor.impersonatedBy?.userId).toBe(zara.id);

    const id = asha.user.id;
    await expect(startPhoneChange(actor, id, { phone: "+919811100001", ip: "10.46.0.1", defer: () => {} })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(verifyPhoneChange(actor, id, { code: "123456" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(removePhone(actor, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changePassword(actor, id, { current: "asha own pass phrase", next: "zara chose this one", confirm: "zara chose this one", keepSessionId: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(signOutEverywhere(actor, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(signOutSession(actor, id, "5b1f6f0e-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(ForbiddenError);

    const [after] = await systemDb().select({ phone: users.phone }).from(users).where(eq(users.id, id));
    expect(after.phone).toBeNull();
  });

  it("the person themselves still can", async () => {
    const uni = await makeUniversity("Own Profile U");
    const asha = await person("Asha Herself", "institute_admin", { universityId: uni.id });
    const actor = await loadActor(asha.user.id, uni.id, { session: { userId: asha.user.id, impersonatorUserId: null } });
    const r = await startPhoneChange(actor, asha.user.id, { phone: `+9198111${String(Date.now() % 100000).padStart(5, "0")}`, ip: "10.46.0.2", defer: () => {} });
    expect(r.masked).toMatch(/^\+91 98/);
    expect(await signOutEverywhere(actor, asha.user.id)).toEqual({ sessionsEnded: 0 });
  });
});

describe("AUTH-07: Zinny team changes made while signed in as a team member name the real Super Admin", () => {
  it("role grants and removals, support mode, institute edits and trial changes", async () => {
    const zara = await superAdmin("Zara Real");
    const other = await superAdmin("Other Super");
    const asOther = await signedInAs(other.id, null, zara);
    const uni = await makeUniversity("Logged Edit U");
    const email = `logged.${Date.now()}@zinny-team.test`;

    const granted = await grantPlatformRole(asOther, { email, name: "Logged Hire", role: "support_agent" });
    await revokePlatformRole(asOther, granted.id);
    const session = await enterSupportMode(asOther, uni.id, "Checking a report");
    await exitSupportMode(asOther, session.id);
    await updateUniversity(asOther, uni.id, { name: "Logged Edit U (renamed)" });
    await setTrialState(asOther, uni.id, { trialEndsAt: "2031-01-31" });

    for (const action of ["platform.role_grant", "platform.role_revoke", "support.enter", "support.exit", "university.update", "university.trial_update"]) {
      const [row] = await systemDb()
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, action), eq(auditLog.actorUserId, other.id)))
        .orderBy(desc(auditLog.at))
        .limit(1);
      expect([action, row?.data]).toEqual([action, expect.objectContaining({ impersonatedBy: { userId: zara.id, name: "Zara Real" } })]);
    }
  });

  it("and stay as they were for a Super Admin acting as themselves", async () => {
    const zara = await superAdmin("Zara Alone");
    const actor = await loadActor(zara.id, null, { session: { userId: zara.id, impersonatorUserId: null } });
    const granted = await grantPlatformRole(actor, { email: `alone.${Date.now()}@zinny-team.test`, name: "Alone Hire", role: "content_qa" });
    const [row] = await systemDb().select().from(auditLog).where(and(eq(auditLog.action, "platform.role_grant"), eq(auditLog.entityId, granted.id)));
    expect(row.data).toEqual({ userId: granted.userId, role: "content_qa" });
  });
});
