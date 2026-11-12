/** Super Admin powers over any account: set a password, find anyone, and sign in as them. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, roleAssignments, sessions, universities, users } from "@/db/schema";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { returnCookieName } from "@/server/auth/impersonation";
import { verifyPassword } from "@/server/auth/passwords";
import { createSession, listSessions, resolveSession, sessionCookieName, sessionFromCookies } from "@/server/auth/session";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createDepartment } from "@/server/services/departments";
import { describeRoles, landingFor, setPersonPassword, startImpersonation, stopImpersonation } from "@/modules/zinny-team-panel/services/accounts";
import { institutePeople, listPeople, peopleCounts } from "@/modules/zinny-team-panel/services/people";
import { activityLog, activityLogCsv, impersonatorIn, whoLabel } from "@/modules/zinny-team-panel/services/support";
import { createUniversityWithLicence } from "@/modules/zinny-team-panel/services/universities";
import { grant, makeUniversity, makeUser, setupCourse, uniqueCode } from "../fixtures";
import { cookieJar } from "../identity/helpers";
import { team } from "./helpers";

afterAll(closeDb);

const client = { ip: "10.0.0.9", userAgent: "Mozilla/5.0 (Macintosh) Chrome/141.0" };
const PW = "seven green lanterns";

let sa: Actor, am: Actor, sup: Actor, fin: Actor;
beforeAll(async () => {
  [sa, am, sup, fin] = await Promise.all([team("Zara Super", "super_admin"), team("Acc Manager", "account_manager"), team("Acc Support", "support_agent"), team("Acc Finance", "finance_admin")]);
});

/** A browser signed in as `userId`: a real session, its token in the cookie jar. */
async function browserFor(userId: string) {
  const s = await createSession(userId, "password", client);
  return { jar: cookieJar({ [sessionCookieName()]: s.token }), token: s.token, sessionId: s.sessionId };
}

const hashOf = async (userId: string) => (await systemDb().select({ h: users.passwordHash }).from(users).where(eq(users.id, userId)))[0].h;

describe("set password", () => {
  it("is for Super Admins only", async () => {
    const { admin } = await setupCourse({ name: "Password Deny U" });
    for (const a of [am, sup, fin, admin]) {
      await expect(setPersonPassword(a, admin.userId, { password: PW })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await hashOf(admin.userId)).toBeNull();
  });

  it("stores a hash that the password opens, and signs the person out everywhere by default", async () => {
    const { admin } = await setupCourse({ name: "Password Allow U" });
    const one = await createSession(admin.userId, "password", client);
    const two = await createSession(admin.userId, "password", client);

    const result = await setPersonPassword(sa, admin.userId, { password: PW, confirm: PW });
    expect(result).toMatchObject({ name: "Admin Asha", sessionsEnded: 2, signedOutEverywhere: true });
    const hash = await hashOf(admin.userId);
    expect(hash).not.toContain(PW);
    expect(await verifyPassword(PW, hash!)).toBe(true);
    expect(await resolveSession(one.token)).toBeNull();
    expect(await resolveSession(two.token)).toBeNull();
    // What comes back never carries the password.
    expect(JSON.stringify(result)).not.toContain(PW);
  });

  it("keeps their sessions when \"Sign them out everywhere\" is off", async () => {
    const { admin } = await setupCourse({ name: "Password Keep U" });
    const open = await createSession(admin.userId, "password", client);
    const result = await setPersonPassword(sa, admin.userId, { password: PW, signOutEverywhere: false });
    expect(result).toMatchObject({ sessionsEnded: 0, signedOutEverywhere: false });
    expect((await resolveSession(open.token))?.userId).toBe(admin.userId);
  });

  it("applies the usual password rules", async () => {
    const { admin } = await setupCourse({ name: "Password Rules U" });
    await expect(setPersonPassword(sa, admin.userId, { password: "short" })).rejects.toThrow(/at least 8/);
    await expect(setPersonPassword(sa, admin.userId, { password: "password123" })).rejects.toThrow(/too common/);
    await expect(setPersonPassword(sa, admin.userId, { password: PW, confirm: "something else" })).rejects.toThrow(/don't match/);
    await expect(setPersonPassword(sa, admin.userId, { password: "Admin Asha" })).rejects.toThrow(/name/);
    await expect(setPersonPassword(sa, "not-a-person", { password: PW })).rejects.toBeInstanceOf(NotFoundError);
    expect(await hashOf(admin.userId)).toBeNull();
  });

  it("is logged as its own action in the platform log and the institute's log, without the password", async () => {
    const { uni, admin } = await setupCourse({ name: "Password Log U" });
    await setPersonPassword(sa, admin.userId, { password: PW });
    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "plat.password.set"), eq(auditLog.entityId, admin.userId)));
    expect(log).toHaveLength(2);
    expect(log.map((l) => l.universityId).sort()).toEqual([uni.id, null].sort());
    for (const l of log) {
      expect(l.actorUserId).toBe(sa.userId);
      expect(l.data).toMatchObject({ name: "Admin Asha", signedOutEverywhere: true });
      expect(JSON.stringify(l)).not.toContain(PW);
      expect(JSON.stringify(l)).not.toContain((await hashOf(admin.userId))!);
    }
  });

  it("a Super Admin setting their own password keeps the session they are using", async () => {
    const mine = await createSession(sa.userId, "password", client);
    const other = await createSession(sa.userId, "password", client);
    await setPersonPassword(sa, sa.userId, { password: PW, keepSessionId: mine.sessionId });
    expect((await resolveSession(mine.token))?.userId).toBe(sa.userId);
    expect(await resolveSession(other.token)).toBeNull();
  });

  it("the first admin of a new institute can be given a password straight away, by a Super Admin only", async () => {
    const slug = `pw-${uniqueCode("s").toLowerCase()}`;
    const input = { name: "Password Institute", slug, adminName: "Pia Admin", adminEmail: `pia.${slug}@test.zinny`, adminPassword: PW };
    await expect(createUniversityWithLicence(am, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createUniversityWithLicence(sa, { ...input, adminPassword: "12345678" })).rejects.toThrow(/too common/);
    expect(await systemDb().select().from(universities).where(eq(universities.slug, slug))).toHaveLength(0);

    const uni = await createUniversityWithLicence(sa, input);
    const [pia] = await systemDb().select().from(users).where(eq(users.email, input.adminEmail));
    expect(await verifyPassword(PW, pia.passwordHash!)).toBe(true);
    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, uni.id), eq(auditLog.action, "plat.password.set")));
    expect(log).toHaveLength(1);

    // Someone who already has a password keeps it: the form says to leave the field empty.
    const again = `pw2-${uniqueCode("s").toLowerCase()}`;
    await expect(createUniversityWithLicence(sa, { ...input, name: "Second Institute", slug: again })).rejects.toThrow(/already has a Zinny account/);
    expect(await systemDb().select().from(universities).where(eq(universities.slug, again))).toHaveLength(0);
  });
});

describe("finding any account", () => {
  it("finds institute people, the Zinny team and accounts with no role at all", async () => {
    const tag = uniqueCode("F");
    const { uni, student } = await setupCourse({ name: "Find U" });
    const riya = await student(`Riya ${tag}`);
    const shopper = await makeUser(`Shopper ${tag}`);
    const buyer = await makeUser(`Buyer ${tag}`);
    await grant(buyer.id, "individual_learner", { universityId: uni.id });
    const agent = await team(`Agent ${tag}`, "support_agent");

    const found = (await listPeople(sa, { q: tag })).rows;
    const row = (id: string) => found.filter((r) => r.userId === id);
    expect(row(riya.userId)).toMatchObject([{ universityId: uni.id, roles: ["student"] }]);
    expect(row(buyer.id)).toMatchObject([{ universityId: uni.id, roles: ["individual_learner"] }]);
    // No role anywhere: a marketplace account, listed once with no institute.
    expect(row(shopper.id)).toMatchObject([{ universityId: null, universityName: null, roles: [] }]);
    expect(row(agent.userId)).toMatchObject([{ universityId: null, roles: ["support_agent"] }]);

    expect((await listPeople(sa, { q: tag, group: "team" })).rows.map((r) => r.userId)).toEqual([agent.userId]);
    expect((await listPeople(sa, { q: tag, universityId: uni.id })).rows.map((r) => r.userId).sort()).toEqual([riya.userId, buyer.id].sort());
    const counts = await peopleCounts(sa);
    expect(counts.team).toBeGreaterThanOrEqual(5);
    expect(counts.all).toBeGreaterThan(counts.students + counts.staff);
  });

  it("lists an institute's people for its page, admins and staff first, for Super Admins only", async () => {
    const { uni, admin, student } = await setupCourse({ name: "Institute People U" });
    await student("Aarav Student");
    const people = await institutePeople(sa, uni.id);
    expect(people.total).toBe(4);
    expect(people.rows[0]).toMatchObject({ userId: admin.userId, roles: ["institute_admin"], canSignIn: false });
    expect(people.rows.at(-1)!.roles).toEqual(["student"]);
    await expect(institutePeople(am, uni.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("where a person lands", () => {
  it("is their admin panel, learner app, the marketplace or the Zinny panel", async () => {
    const { uni, admin, student } = await setupCourse({ name: "Landing U" });
    const riya = await student("Riya Lands");
    const shopper = await makeUser("Shopper Lands");
    const buyer = await makeUser("Buyer Lands");
    await grant(buyer.id, "individual_learner", { universityId: uni.id });

    expect(await landingFor(admin.userId, uni.id)).toBe(`/${uni.slug}/admin`);
    expect(await landingFor(admin.userId)).toBe(`/${uni.slug}/admin`);
    expect(await landingFor(riya.userId, uni.id)).toBe(`/${uni.slug}/learn`);
    expect(await landingFor(riya.userId)).toBe(`/${uni.slug}/learn`);
    expect(await landingFor(shopper.id)).toBe("/marketplace");
    expect(await landingFor(buyer.id)).toBe("/marketplace");
    expect(await landingFor(buyer.id, uni.id)).toBe("/marketplace/library");
    expect(await landingFor(sup.userId)).toBe("/platform");
    // Someone in two institutes picks where to go.
    const other = await makeUniversity("Landing Other U");
    await grant(riya.userId, "student", { universityId: other.id });
    expect(await landingFor(riya.userId)).toBe("/");
    expect(await landingFor(riya.userId, other.id)).toBe(`/${other.slug}/learn`);
  });

  it("the banner says who they are and where", () => {
    const at = (role: "institute_admin" | "student" | "individual_learner", slug = "demo", name = "Demo University") => ({ role, universityId: "u-" + slug, slug, universityName: name });
    expect(describeRoles([at("student"), at("institute_admin")])).toBe("Institute Admin at Demo University");
    expect(describeRoles([at("student", "one", "One College"), at("student", "two", "Two College")], "two")).toBe("Current Student at Two College");
    expect(describeRoles([at("individual_learner")])).toBe("a marketplace learner");
    expect(describeRoles([{ role: "support_agent", universityId: null, slug: null, universityName: null }])).toBe("Support Agent on the Zinny team");
    expect(describeRoles([])).toBe("a marketplace learner");
  });
});

describe("sign in as", () => {
  it("only an active platform Super Admin can start", async () => {
    const { uni, admin } = await setupCourse({ name: "Impersonate Deny U" });
    for (const a of [am, sup, fin, admin]) {
      const { jar, token } = await browserFor(a.userId);
      await expect(startImpersonation(a, admin.userId === a.userId ? sa.userId : admin.userId, { jar, client })).rejects.toBeInstanceOf(ForbiddenError);
      // Nothing changed in their browser, and no session was made.
      expect(jar.values.get(sessionCookieName())).toBe(token);
      expect(jar.values.has(returnCookieName())).toBe(false);
    }
    // The only session the Institute Admin has is the one their own browser signed in with.
    expect((await systemDb().select().from(sessions).where(eq(sessions.userId, admin.userId))).filter((s) => s.impersonatorUserId)).toHaveLength(0);
    expect((await systemDb().select().from(sessions).where(eq(sessions.userId, sa.userId))).filter((s) => s.impersonatorUserId)).toHaveLength(0);
    expect(uni.id).toBeTruthy();
  });

  it("a Super Admin whose role has ended, or been removed, can't start", async () => {
    const { admin } = await setupCourse({ name: "Impersonate Ended U" });
    const former = await makeUser("Former Super");
    await grant(former.id, "super_admin", {}, new Date(Date.now() - 60_000));
    const formerActor = await loadActor(former.id, null);
    const a = await browserFor(former.id);
    await expect(startImpersonation(formerActor, admin.userId, { jar: a.jar, client })).rejects.toBeInstanceOf(ForbiddenError);

    // An actor that still says "Super Admin" doesn't help once the role is revoked: the session layer asks the database.
    const removed = await team("Removed Super", "super_admin");
    await systemDb().update(roleAssignments).set({ revokedAt: new Date() }).where(eq(roleAssignments.userId, removed.userId));
    const b = await browserFor(removed.userId);
    await expect(startImpersonation(removed, admin.userId, { jar: b.jar, client })).rejects.toThrow(/Only a Super Admin/);
    expect(await systemDb().select().from(sessions).where(eq(sessions.userId, admin.userId))).toHaveLength(0);
  });

  it("the browser's own session decides who is asking, not the actor passed in", async () => {
    const { admin } = await setupCourse({ name: "Impersonate Forged U" });
    // A support agent's browser, with a Super Admin's actor: refused.
    const { jar } = await browserFor(sup.userId);
    await expect(startImpersonation(sa, admin.userId, { jar, client })).rejects.toBeInstanceOf(ForbiddenError);
    // No session at all: refused.
    await expect(startImpersonation(sa, admin.userId, { jar: cookieJar(), client })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("can't be yourself, and the person must exist", async () => {
    const { jar } = await browserFor(sa.userId);
    await expect(startImpersonation(sa, sa.userId, { jar, client })).rejects.toBeInstanceOf(ValidationError);
    await expect(startImpersonation(sa, "5b1f6f0e-0000-4000-8000-000000000000", { jar, client })).rejects.toBeInstanceOf(NotFoundError);
    await expect(startImpersonation(sa, "nobody", { jar, client })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("starts a real session for the person, marked with who is behind it, and keeps the way back", async () => {
    const { uni, admin } = await setupCourse({ name: "Impersonate Start U" });
    const own = await browserFor(sa.userId);
    const now = new Date();

    const started = await startImpersonation(sa, admin.userId, { universityId: uni.id, jar: own.jar, client, now });
    expect(started).toMatchObject({ landing: `/${uni.slug}/admin`, name: "Admin Asha", adminUserId: sa.userId, targetUserId: admin.userId });
    expect(started.expiresAt.getTime() - now.getTime()).toBe(2 * 60 * 60_000);

    const token = own.jar.values.get(sessionCookieName())!;
    expect(token).not.toBe(own.token);
    expect(await resolveSession(token)).toEqual({ sessionId: started.sessionId, userId: admin.userId, impersonatorUserId: sa.userId });
    // Their own session is still alive, parked in a second httpOnly, same-site cookie.
    expect(own.jar.values.get(returnCookieName())).toBe(own.token);
    expect(own.jar.options.get(returnCookieName())).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
    expect(own.jar.options.get(sessionCookieName())).toMatchObject({ httpOnly: true, expires: started.expiresAt });
    expect((await resolveSession(own.token))?.userId).toBe(sa.userId);

    // The person's own "your sessions" list doesn't show it as one of their devices.
    expect(await listSessions(admin.userId)).toEqual([]);

    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "plat.impersonate.start"), eq(auditLog.entityId, admin.userId)));
    expect(log.map((l) => l.universityId).sort()).toEqual([uni.id, null].sort());
    expect(log.every((l) => l.actorUserId === sa.userId)).toBe(true);
    expect(log[0].data).toMatchObject({ name: "Admin Asha", expiresAt: started.expiresAt.toISOString() });
  });

  it("can't be nested", async () => {
    const { admin, student } = await setupCourse({ name: "Impersonate Nest U" });
    const riya = await student("Riya Nested");
    const { jar } = await browserFor(sa.userId);
    await startImpersonation(sa, admin.userId, { jar, client });
    const inside = jar.values.get(sessionCookieName());

    // Even with the Super Admin's own actor in hand, the browser is inside a session already.
    await expect(startImpersonation(sa, riya.userId, { jar, client })).rejects.toBeInstanceOf(ConflictError);
    // And as the request really sees it: the actor is the person, carrying who is behind it.
    const session = await sessionFromCookies(jar);
    const asAdmin = await loadActor(admin.userId, null, { session });
    expect(asAdmin.impersonatedBy).toEqual({ userId: sa.userId, name: "Zara Super" });
    await expect(startImpersonation(asAdmin, riya.userId, { jar, client })).rejects.toBeInstanceOf(ConflictError);
    // Signed in as another Super Admin, you still can't start a second one.
    const otherSuper = await team("Other Super", "super_admin");
    const b = await browserFor(sa.userId);
    await startImpersonation(sa, otherSuper.userId, { jar: b.jar, client });
    const asOther = await loadActor(otherSuper.userId, null, { session: await sessionFromCookies(b.jar) });
    await expect(startImpersonation(asOther, riya.userId, { jar: b.jar, client })).rejects.toBeInstanceOf(ConflictError);

    expect(jar.values.get(sessionCookieName())).toBe(inside);
    expect(await systemDb().select().from(sessions).where(eq(sessions.userId, riya.userId))).toHaveLength(0);
  });

  it("everything done while signed in as someone is logged as them, with the Super Admin alongside", async () => {
    const { uni, admin } = await setupCourse({ name: "Impersonate Audit U" });
    const { jar } = await browserFor(sa.userId);
    await startImpersonation(sa, admin.userId, { universityId: uni.id, jar, client });

    // The request's actor: the Institute Admin, with full power, marked with who it really is.
    const asAdmin = await loadActor(admin.userId, uni.id, { session: await sessionFromCookies(jar) });
    expect(asAdmin).toMatchObject({ userId: admin.userId, name: "Admin Asha", impersonatedBy: { userId: sa.userId, name: "Zara Super" } });
    expect(asAdmin.viewedBy).toBeUndefined();
    const dept = await createDepartment(asAdmin, { code: uniqueCode("M"), name: "Made While Signed In As" });

    const [entry] = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, uni.id), eq(auditLog.entityId, dept.id)));
    expect(entry.actorUserId).toBe(admin.userId);
    expect(entry.data).toMatchObject({ impersonatedBy: { userId: sa.userId, name: "Zara Super" } });
    expect(impersonatorIn(entry.data as Record<string, unknown>)).toEqual({ userId: sa.userId, name: "Zara Super" });
    expect(whoLabel("Admin Asha", entry.data as Record<string, unknown>)).toBe("Admin Asha, by Zara Super (Zinny)");
    expect(whoLabel("Admin Asha", {})).toBe("Admin Asha");

    // The activity log shows it, also when filtered to the Super Admin, and the CSV names them.
    const forUni = await activityLog(sa, { scope: "support", universityId: uni.id });
    expect(forUni.entries.map((e) => e.id)).toContain(entry.id);
    const mine = await activityLog(sa, { scope: "all", universityId: uni.id, personId: sa.userId });
    expect(mine.entries.map((e) => e.action)).toEqual(expect.arrayContaining([entry.action, "plat.impersonate.start"]));
    const { csv } = await activityLogCsv(sa, { scope: "support", universityId: uni.id });
    expect(csv.split("\r\n")[0]).toMatch(/Signed in as them \(Zinny\)$/);
    expect(csv).toContain("Zara Super");

    // An ordinary session of the same person carries nothing.
    const plain = await loadActor(admin.userId, uni.id, { session: { userId: admin.userId, impersonatorUserId: null } });
    expect(plain.impersonatedBy).toBeUndefined();
    // Someone else's "sign in as" session never marks this person's actor.
    const stray = await loadActor(admin.userId, uni.id, { session: { userId: sup.userId, impersonatorUserId: sa.userId } });
    expect(stray.impersonatedBy).toBeUndefined();
  });

  it("\"Return to the Zinny panel\" ends the session and restores the Super Admin's own, logged in both logs", async () => {
    const { uni, admin } = await setupCourse({ name: "Impersonate Stop U" });
    const own = await browserFor(sa.userId);
    await startImpersonation(sa, admin.userId, { jar: own.jar, client });
    const token = own.jar.values.get(sessionCookieName())!;

    const ended = await stopImpersonation({ jar: own.jar });
    expect(ended).toMatchObject({ restored: true, adminUserId: sa.userId, targetUserId: admin.userId, next: `/platform/people/${admin.userId}` });
    expect(own.jar.values.get(sessionCookieName())).toBe(own.token);
    expect(own.jar.values.has(returnCookieName())).toBe(false);
    expect((await sessionFromCookies(own.jar))?.userId).toBe(sa.userId);
    // The session they were using is gone for good.
    expect(await resolveSession(token)).toBeNull();
    expect(await systemDb().select().from(sessions).where(eq(sessions.userId, admin.userId))).toHaveLength(0);

    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "plat.impersonate.stop"), eq(auditLog.entityId, admin.userId)));
    expect(log.map((l) => l.universityId).sort()).toEqual([uni.id, null].sort());
    expect(log.every((l) => l.actorUserId === sa.userId)).toBe(true);
    // Platform entries have no institute; the institute's own log has its copy.
    const inUni = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, uni.id), eq(auditLog.actorUserId, sa.userId)));
    expect(inUni.map((l) => l.action).sort()).toEqual(["plat.impersonate.start", "plat.impersonate.stop"]);
    const platform = await systemDb()
      .select()
      .from(auditLog)
      .where(and(isNull(auditLog.universityId), eq(auditLog.entityId, admin.userId)));
    expect(platform.map((l) => l.action).sort()).toEqual(["plat.impersonate.start", "plat.impersonate.stop"]);
  });
});
