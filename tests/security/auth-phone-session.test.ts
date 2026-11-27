/**
 * AUTH-01: a mobile number can be typed in by an institute's admin, so a phone code proves
 * the person only to that institute. Before the fix, an admin of a self-signed-up institute
 * could create an account for someone who wasn't on Zinny yet (a future Zinny team member,
 * or a teacher another institute was about to add) with the admin's own phone number, sign
 * in to it with a code, and keep that session when the account later gained a Zinny team
 * role or a role at another institute.
 *
 * Now a phone-code session is bound to the institute the code was entered at: elsewhere it
 * holds no roles and counts as signed out.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { loadActor } from "@/server/actor";
import { can, canPlatform } from "@/server/authz/engine";
import { beginImpersonation } from "@/server/auth/impersonation";
import { NO_INSTITUTE, createSession, resolveSession, sessionCookieName, sessionFromCookies, startSession } from "@/server/auth/session";
import { grantPlatformRole } from "@/server/services/core-api";
import { addPerson } from "@/server/services/users";
import { ForbiddenError } from "@/server/errors";
import { landingAfterPhoneSignIn, phoneRefUniversity, startPhoneSignIn, verifyPhoneCode } from "@/modules/identity/auth";
import { setPhoneSignIn } from "@/modules/identity/settings";
import { idnSessions } from "@/modules/identity/schema";
import { grant, makeUniversity, makeUser, person } from "../fixtures";
import { codeIn, cookieJar, inlineDefer, resetOutbox, useIdentityOnly } from "../identity/helpers";

beforeAll(() => useIdentityOnly());
beforeEach(() => resetOutbox());
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

const client = { ip: "10.44.0.1", userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/141.0 Mobile" };
let seq = 0;
const freshPhone = () => `+9197${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++seq % 100).padStart(2, "0")}`;

async function superAdmin() {
  const u = await makeUser("Sec Super");
  await grant(u.id, "super_admin");
  return loadActor(u.id, null, { session: null });
}

/** The attacker: Institute Admin of an institute they signed up themselves, phone sign-in on. */
async function attackerInstitute() {
  const uni = await makeUniversity("Mallory Academy");
  const admin = await (await person("Mallory Admin", "institute_admin", { universityId: uni.id })).actor();
  await setPhoneSignIn(admin, true);
  return { uni, admin };
}

/** Signs in with a phone code at `universityId`, the way /login does, into a fresh browser. */
async function phoneSignIn(universityId: string, phone: string) {
  const { defer, flush } = inlineDefer();
  const start = await startPhoneSignIn({ universityId, phone, ip: client.ip, defer });
  await flush();
  const r = await verifyPhoneCode({ ref: start.ref, code: codeIn(phone) });
  if (r.status !== "signed_in") throw new Error("expected one account");
  const jar = cookieJar();
  await startSession(r.userId, "phone", { jar, client, scopeUniversityId: phoneRefUniversity(start.ref) });
  return { userId: r.userId, jar, ref: start.ref };
}

describe("AUTH-01: phone-code sessions are bound to their institute", () => {
  it("an account pre-made by another institute's admin never reaches the Zinny panel or another institute", async () => {
    const { uni: academy, admin } = await attackerInstitute();
    const email = `new.hire.${Date.now()}@zinny-team.test`;
    const attackerPhone = freshPhone();
    // The admin creates the account for someone not on Zinny yet, with the admin's own number.
    const userId = await addPerson(admin, { name: "New Hire", email, phone: attackerPhone, role: "student" });
    const { jar } = await phoneSignIn(academy.id, attackerPhone);

    // Later the real person joins the Zinny team, and another institute makes them its admin.
    await grantPlatformRole(await superAdmin(), { email, name: "New Hire", role: "super_admin" });
    const college = await makeUniversity("Victim College");
    await grant(userId, "institute_admin", { universityId: college.id });

    const session = await sessionFromCookies(jar);
    expect(session).toMatchObject({ userId, scopeUniversityId: academy.id });

    // Deny: none of the account's other roles work through the phone session.
    const panel = await loadActor(userId, null, { session });
    expect(panel.assignments).toEqual([]);
    expect(canPlatform(panel, "platform.manage_universities")).toBe(false);
    expect(canPlatform(panel, "platform.support_mode")).toBe(false);
    const atCollege = await loadActor(userId, college.id, { session });
    expect(atCollege.assignments).toEqual([]);
    expect(can(atCollege, "user.manage_roles", { universityId: college.id })).toBe(false);
    // Deny: it can't start "sign in as" either, though the account is now a Super Admin.
    await expect(beginImpersonation(admin.userId, { jar, client })).rejects.toBeInstanceOf(ForbiddenError);

    // Allow: inside the institute where the code was entered, it is the person's session there.
    const atAcademy = await loadActor(userId, academy.id, { session });
    expect(atAcademy.assignments.map((a) => a.role)).toEqual(["student"]);

    // Allow: the same account signed in with a password is not limited.
    const own = await loadActor(userId, null, { session: { userId, impersonatorUserId: null } });
    expect(canPlatform(own, "platform.manage_universities")).toBe(true);
  });

  it("stores the institute with the session, and lands inside it", async () => {
    const { uni } = await attackerInstitute();
    const phone = freshPhone();
    const student = await person("Phone Student", "student", { universityId: uni.id });
    await systemDb().update(users).set({ phone }).where(eq(users.id, student.user.id));
    const { jar } = await phoneSignIn(uni.id, phone);
    const token = jar.values.get(sessionCookieName())!;
    const s = await resolveSession(token);
    expect(s?.scopeUniversityId).toBe(uni.id);
    const [row] = await systemDb().select().from(idnSessions).where(eq(idnSessions.sessionId, s!.sessionId));
    expect(row).toMatchObject({ method: "phone", scopeUniversityId: uni.id });

    // `next` is followed only inside this institute.
    expect(await landingAfterPhoneSignIn(student.user.id, uni.id, `/${uni.slug}/learn/timetable`)).toEqual({ slug: uni.slug, landing: `/${uni.slug}/learn/timetable` });
    expect(await landingAfterPhoneSignIn(student.user.id, uni.id, "/platform")).toEqual({ slug: uni.slug, landing: `/${uni.slug}/learn` });
    expect(await landingAfterPhoneSignIn(student.user.id, uni.id, "/other-institute/admin")).toEqual({ slug: uni.slug, landing: `/${uni.slug}/learn` });
  });

  it("a phone session that doesn't know its institute (made before the fix) opens nothing", async () => {
    const uni = await makeUniversity("Old Phone U");
    const u = await makeUser("Old Phone Session");
    await grant(u.id, "institute_admin", { universityId: uni.id });
    await grant(u.id, "super_admin");
    const old = await createSession(u.id, "password", client);
    await systemDb().update(idnSessions).set({ method: "phone" }).where(eq(idnSessions.sessionId, old.sessionId));
    const session = await resolveSession(old.token);
    expect(session?.scopeUniversityId).toBe(NO_INSTITUTE);
    expect((await loadActor(u.id, uni.id, { session })).assignments).toEqual([]);
    expect((await loadActor(u.id, null, { session })).assignments).toEqual([]);
    // Made without an institute today, the same.
    const unbound = await createSession(u.id, "phone", client);
    expect((await resolveSession(unbound.token))?.scopeUniversityId).toBe(NO_INSTITUTE);
    expect(await systemDb().select().from(sessions).where(eq(sessions.id, unbound.sessionId))).toHaveLength(1);
  });

  it("signing in with a password right after a phone code makes a new, unbound session", async () => {
    const { uni } = await attackerInstitute();
    const phone = freshPhone();
    const student = await person("Twice Signed", "student", { universityId: uni.id });
    await systemDb().update(users).set({ phone }).where(eq(users.id, student.user.id));
    const { jar } = await phoneSignIn(uni.id, phone);
    const phoneToken = jar.values.get(sessionCookieName())!;

    // "keepFresh" reuses a session from a double click; never a bound one for an unbound sign-in.
    await startSession(student.user.id, "password", { jar, client, keepFresh: true });
    const passwordToken = jar.values.get(sessionCookieName())!;
    expect(passwordToken).not.toBe(phoneToken);
    expect(await resolveSession(phoneToken)).toBeNull();
    expect((await resolveSession(passwordToken))?.scopeUniversityId).toBeUndefined();
  });
});
