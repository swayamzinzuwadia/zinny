/**
 * "Sign in as" at the session layer: the two-hour limit, the return cookie, signing out,
 * and what happens when a session ends in any way other than "Return to the Zinny panel".
 * The rule under all of it: the browser ends up signed out or as the Super Admin, never
 * as the person they were signed in as.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { roleAssignments, sessions } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { AUTH } from "@/server/auth/config";
import { IMPERSONATION_MS, beginImpersonation, endImpersonation, isActiveSuperAdmin, returnCookieName } from "@/server/auth/impersonation";
import { createSession, listSessions, pruneSessions, resolveSession, revokeAllSessions, sessionCookieName, sessionFromCookies, signOut, startSession } from "@/server/auth/session";
import { ConflictError, ForbiddenError } from "@/server/errors";
import { mySessions } from "@/modules/identity/profile";
import { idnSessions } from "@/modules/identity/schema";
import { grant, makeUniversity, makeUser, person } from "../fixtures";
import { cookieJar, later, minutes } from "./helpers";

afterAll(closeDb);

const client = { ip: "10.0.0.7", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0" };
const MAIN = sessionCookieName();
const BACK = returnCookieName();

async function superAdmin(name = "Zara Super") {
  const u = await makeUser(name);
  await grant(u.id, "super_admin");
  return u;
}

/** A Super Admin's browser, and someone at an institute to sign in as. */
async function scene(now = new Date()) {
  const admin = await superAdmin();
  const uni = await makeUniversity("Impersonation Sessions U");
  const target = await person("Asha Rao", "institute_admin", { universityId: uni.id });
  const own = await createSession(admin.id, "password", client, now);
  const jar = cookieJar({ [MAIN]: own.token });
  return { admin, uni, target: target.user, own, jar };
}

describe("who counts as a Super Admin", () => {
  it("an active platform super_admin role only", async () => {
    const yes = await superAdmin("Active Super");
    const support = await makeUser("Only Support");
    await grant(support.id, "support_agent");
    const uni = await makeUniversity("Not Platform U");
    const instituteAdmin = await person("Institute Only", "institute_admin", { universityId: uni.id });
    const ended = await makeUser("Ended Super");
    await grant(ended.id, "super_admin", {}, new Date(Date.now() - 1000));
    const revoked = await superAdmin("Revoked Super");
    await systemDb().update(roleAssignments).set({ revokedAt: new Date() }).where(eq(roleAssignments.userId, revoked.id));

    expect(await isActiveSuperAdmin(yes.id)).toBe(true);
    for (const id of [support.id, instituteAdmin.user.id, ended.id, revoked.id]) expect(await isActiveSuperAdmin(id)).toBe(false);
  });
});

describe("a \"sign in as\" session", () => {
  it("lasts two hours from the start and is never extended by use", async () => {
    const t0 = new Date();
    const { admin, target, jar } = await scene(t0);
    const started = await beginImpersonation(target.id, { jar, client, now: t0 });
    const token = jar.values.get(MAIN)!;
    expect(started.expiresAt).toEqual(later(t0, IMPERSONATION_MS));

    // Busy for an hour and fifty-nine minutes: still theirs, and the expiry hasn't moved.
    for (const m of [1, 45, 90, 119]) expect(await resolveSession(token, later(t0, minutes(m)))).toMatchObject({ userId: target.id, impersonatorUserId: admin.id });
    const [row] = await systemDb().select().from(sessions).where(eq(sessions.id, started.sessionId));
    expect(row.expiresAt).toEqual(later(t0, IMPERSONATION_MS));
    expect(row.impersonatorUserId).toBe(admin.id);

    expect(await resolveSession(token, later(t0, IMPERSONATION_MS))).toBeNull();
    expect(await resolveSession(token, later(t0, IMPERSONATION_MS + minutes(1)))).toBeNull();
  });

  it("once expired, the browser is the Super Admin again, never the person", async () => {
    const t0 = new Date();
    const { admin, target, jar } = await scene(t0);
    await beginImpersonation(target.id, { jar, client, now: t0 });
    expect((await sessionFromCookies(jar, later(t0, minutes(5))))?.userId).toBe(target.id);

    const after = later(t0, IMPERSONATION_MS + minutes(1));
    const who = await sessionFromCookies(jar, after);
    expect(who).toMatchObject({ userId: admin.id, impersonatorUserId: null });
    // The actor built for that request is the Super Admin, with nothing impersonated.
    const actor = await loadActor(who!.userId, null, { session: who });
    expect(actor.userId).toBe(admin.id);
    expect(actor.impersonatedBy).toBeUndefined();

    // If their own session has ended too, they are simply signed out.
    await revokeAllSessions(admin.id);
    expect(await sessionFromCookies(jar, after)).toBeNull();
  });

  it("stops working the moment the Super Admin behind it stops being one", async () => {
    const { admin, target, jar } = await scene();
    await beginImpersonation(target.id, { jar, client });
    const token = jar.values.get(MAIN)!;
    expect((await resolveSession(token))?.userId).toBe(target.id);

    await systemDb().update(roleAssignments).set({ revokedAt: new Date() }).where(eq(roleAssignments.userId, admin.id));
    expect(await resolveSession(token)).toBeNull();
    // The session is deleted, so getting the role back doesn't revive it.
    expect(await systemDb().select().from(sessions).where(eq(sessions.userId, target.id))).toHaveLength(0);
  });

  it("never turns into an ordinary session of the person if the Super Admin's account is deleted", async () => {
    const { target, jar } = await scene();
    const started = await beginImpersonation(target.id, { jar, client });
    const token = jar.values.get(MAIN)!;

    // Deleting the account clears impersonator_user_id (the column is "on delete set null"),
    // which would leave a row that looks like the person's own session.
    await systemDb().update(sessions).set({ impersonatorUserId: null }).where(eq(sessions.id, started.sessionId));
    const [row] = await systemDb().select().from(sessions).where(eq(sessions.id, started.sessionId));
    expect(row).toMatchObject({ userId: target.id, impersonatorUserId: null });

    // Its method still marks it, so it is refused, deleted, and never listed as a device.
    expect(await listSessions(target.id)).toEqual([]);
    expect(await resolveSession(token)).toBeNull();
    expect(await sessionFromCookies(cookieJar({ [MAIN]: token }))).toBeNull();
    expect(await systemDb().select().from(sessions).where(eq(sessions.id, started.sessionId))).toHaveLength(0);
  });

  it("is not listed among the person's own sessions", async () => {
    const { uni, target, jar } = await scene();
    const theirs = await createSession(target.id, "password", client);
    await beginImpersonation(target.id, { jar, client });

    expect((await listSessions(target.id)).map((s) => s.id)).toEqual([theirs.sessionId]);
    const actor = await loadActor(target.id, uni.id, { session: null });
    expect((await mySessions(actor, target.id)).map((s) => s.id)).toEqual([theirs.sessionId]);
    // It is recorded with its own method, so it can always be told apart.
    const methods = await systemDb().select({ method: idnSessions.method }).from(idnSessions).where(eq(idnSessions.userId, target.id));
    expect(methods.map((m) => m.method).sort()).toEqual(["impersonation", "password"]);
  });

  it("ends when the person signs out everywhere, and the Super Admin falls back to themselves", async () => {
    const { admin, target, jar } = await scene();
    await beginImpersonation(target.id, { jar, client });
    await revokeAllSessions(target.id);
    expect(await sessionFromCookies(jar)).toMatchObject({ userId: admin.id, impersonatorUserId: null });
  });

  it("is cleaned up with other expired sessions", async () => {
    const t0 = new Date();
    const { target, jar } = await scene(t0);
    const started = await beginImpersonation(target.id, { jar, client, now: t0 });
    await pruneSessions(later(t0, IMPERSONATION_MS + minutes(1)));
    expect(await systemDb().select().from(sessions).where(eq(sessions.id, started.sessionId))).toHaveLength(0);
  });
});

describe("starting", () => {
  it("is refused without a session, for someone who isn't a Super Admin, and from inside one", async () => {
    const { target, jar } = await scene();
    await expect(beginImpersonation(target.id, { jar: cookieJar(), client })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(beginImpersonation(target.id, { jar: cookieJar({ [MAIN]: "made-up-token" }), client })).rejects.toBeInstanceOf(ForbiddenError);

    const support = await makeUser("Support Person");
    await grant(support.id, "support_agent");
    const theirs = await createSession(support.id, "password", client);
    const supportJar = cookieJar({ [MAIN]: theirs.token });
    await expect(beginImpersonation(target.id, { jar: supportJar, client })).rejects.toBeInstanceOf(ForbiddenError);
    expect(supportJar.values.get(MAIN)).toBe(theirs.token);
    expect(supportJar.values.has(BACK)).toBe(false);

    await beginImpersonation(target.id, { jar, client });
    const other = await makeUser("Second Target");
    await expect(beginImpersonation(other.id, { jar, client })).rejects.toBeInstanceOf(ConflictError);
    expect(await systemDb().select().from(sessions).where(eq(sessions.userId, other.id))).toHaveLength(0);
  });

  it("after an earlier one ran out, starts again from the Super Admin's own session", async () => {
    const t0 = new Date();
    const { admin, target, own, jar } = await scene(t0);
    await beginImpersonation(target.id, { jar, client, now: t0 });
    const later3h = later(t0, minutes(180));
    const again = await beginImpersonation(target.id, { jar, client, now: later3h });
    expect(again.adminUserId).toBe(admin.id);
    expect(jar.values.get(BACK)).toBe(own.token);
    expect((await sessionFromCookies(jar, later(later3h, minutes(1))))?.userId).toBe(target.id);
  });
});

describe("the return cookie", () => {
  it("restores the Super Admin's own session, and only theirs", async () => {
    const { admin, own, target, jar } = await scene();
    await beginImpersonation(target.id, { jar, client });
    const ended = await endImpersonation({ jar });
    expect(ended).toEqual({ restored: true, adminUserId: admin.id, targetUserId: target.id });
    expect(jar.values.get(MAIN)).toBe(own.token);
    expect(jar.values.has(BACK)).toBe(false);
    expect(jar.options.get(MAIN)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });

  it("can't be used to become anyone else: a made-up value signs the browser out", async () => {
    const { target, jar } = await scene();
    await beginImpersonation(target.id, { jar, client });
    jar.values.set(BACK, "not-a-real-session-token");

    const ended = await endImpersonation({ jar });
    expect(ended.restored).toBe(false);
    expect(jar.values.has(MAIN)).toBe(false);
    expect(jar.values.has(BACK)).toBe(false);
    expect(await sessionFromCookies(jar)).toBeNull();
    // And the session they were using is gone: they are not left as the person either.
    expect(await systemDb().select().from(sessions).where(eq(sessions.userId, target.id))).toHaveLength(0);
  });

  it("can't be used to become anyone else: another person's session token isn't accepted", async () => {
    const { target, jar } = await scene();
    await beginImpersonation(target.id, { jar, client });
    // Somebody else's live session, even another Super Admin's, is not "theirs".
    const victim = await superAdmin("Another Super");
    const victimSession = await createSession(victim.id, "password", client);
    jar.values.set(BACK, victimSession.token);

    const ended = await endImpersonation({ jar });
    expect(ended.restored).toBe(false);
    expect(jar.values.has(MAIN)).toBe(false);
    expect(await sessionFromCookies(jar)).toBeNull();
  });

  it("can't be used to become anyone else: a \"sign in as\" session's token is never a way back", async () => {
    // Two Super Admins, each signed in as someone. One plants the other's impersonation token as their return cookie.
    const a = await scene();
    const b = await scene();
    await beginImpersonation(a.target.id, { jar: a.jar, client });
    await beginImpersonation(b.target.id, { jar: b.jar, client });
    a.jar.values.set(BACK, b.jar.values.get(MAIN)!);

    expect((await endImpersonation({ jar: a.jar })).restored).toBe(false);
    expect(await sessionFromCookies(a.jar)).toBeNull();
    // Nor does it work as a fallback when the main cookie is empty.
    const planted = cookieJar({ [BACK]: b.jar.values.get(MAIN)! });
    expect(await sessionFromCookies(planted)).toBeNull();
  });

  it("on its own it is only what it is: the holder's own ordinary session", async () => {
    const { admin, own } = await scene();
    // Without a main cookie, a valid own token in the return cookie means "signed in as yourself".
    expect(await sessionFromCookies(cookieJar({ [BACK]: own.token }))).toMatchObject({ userId: admin.id, impersonatorUserId: null });
    expect(await sessionFromCookies(cookieJar({ [BACK]: "junk" }))).toBeNull();
  });

  it("returning after the two hours still lands on the Super Admin's own session", async () => {
    const t0 = new Date();
    const { admin, own, target, jar } = await scene(t0);
    await beginImpersonation(target.id, { jar, client, now: t0 });
    const ended = await endImpersonation({ jar, now: later(t0, IMPERSONATION_MS + minutes(10)) });
    expect(ended).toMatchObject({ restored: true, adminUserId: admin.id });
    expect(jar.values.get(MAIN)).toBe(own.token);
  });

  it("if the Super Admin's own session has ended meanwhile, returning signs them out", async () => {
    const { admin, target, jar } = await scene();
    await beginImpersonation(target.id, { jar, client });
    await revokeAllSessions(admin.id);
    const ended = await endImpersonation({ jar });
    expect(ended.restored).toBe(false);
    expect(jar.values.has(MAIN)).toBe(false);
    expect(await sessionFromCookies(jar)).toBeNull();
  });
});

describe("signing out and signing in", () => {
  it("signing out while signed in as someone returns to the Super Admin's own session", async () => {
    const { admin, own, target, jar } = await scene();
    await beginImpersonation(target.id, { jar, client });
    await signOut({ jar });
    expect(jar.values.get(MAIN)).toBe(own.token);
    expect(jar.values.has(BACK)).toBe(false);
    expect((await sessionFromCookies(jar))?.userId).toBe(admin.id);
    expect(await systemDb().select().from(sessions).where(eq(sessions.userId, target.id))).toHaveLength(0);

    // Signing out again is an ordinary sign-out.
    await signOut({ jar });
    expect(jar.values.has(MAIN)).toBe(false);
    expect(await resolveSession(own.token)).toBeNull();
  });

  it("signing out after it expired signs out completely, their own session included", async () => {
    const { admin, own, target, jar } = await scene();
    const started = await beginImpersonation(target.id, { jar, client });
    // As if it had started more than two hours ago.
    const t0 = new Date(Date.now() - IMPERSONATION_MS - minutes(5));
    await systemDb().update(sessions).set({ createdAt: t0, expiresAt: later(t0, IMPERSONATION_MS) }).where(eq(sessions.id, started.sessionId));
    expect((await sessionFromCookies(jar))?.userId).toBe(admin.id);

    await signOut({ jar });
    expect(jar.values.has(MAIN)).toBe(false);
    expect(jar.values.has(BACK)).toBe(false);
    expect(await resolveSession(own.token)).toBeNull();
    expect(await sessionFromCookies(jar)).toBeNull();
  });

  it("a fresh sign-in replaces everything the browser held, the way back included", async () => {
    const { own, target, jar } = await scene();
    await beginImpersonation(target.id, { jar, client });
    const impersonated = jar.values.get(MAIN)!;
    const someone = await makeUser("Signs In Fresh");

    await startSession(someone.id, "password", { jar, client });
    expect(jar.values.has(BACK)).toBe(false);
    expect((await sessionFromCookies(jar))?.userId).toBe(someone.id);
    expect(await resolveSession(impersonated)).toBeNull();
    expect(await resolveSession(own.token)).toBeNull();
  });

  it("an ordinary session is untouched by all of this", async () => {
    const u = await makeUser("Ordinary Person");
    const s = await createSession(u.id, "password", client);
    const jar = cookieJar({ [MAIN]: s.token });
    expect(await sessionFromCookies(jar)).toEqual({ sessionId: s.sessionId, userId: u.id, impersonatorUserId: null });
    // Returning with nothing to return from changes nothing.
    expect(await endImpersonation({ jar })).toEqual({ restored: false, adminUserId: null, targetUserId: null });
    expect(jar.values.get(MAIN)).toBe(s.token);
    expect((await resolveSession(s.token))?.userId).toBe(u.id);
    // Still slides like any session.
    const soon = later(new Date(), AUTH.session.touchEveryMs + minutes(1));
    await resolveSession(s.token, soon);
    const [row] = await systemDb().select().from(sessions).where(eq(sessions.id, s.sessionId));
    expect(row.expiresAt.getTime()).toBeGreaterThan(s.expiresAt.getTime());
  });
});
