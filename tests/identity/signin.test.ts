import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, sessions, users } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { AUTH, LIMITS, demoEnabled } from "@/server/auth/config";
import { verifyPassword } from "@/server/auth/passwords";
import { checkNewPassword } from "@/server/auth/passwords";
import {
  createSession,
  cookieOptions,
  listSessions,
  resolveSession,
  revokeAllSessions,
  revokeSession,
  sessionCookieName,
  signOut,
  startSession,
} from "@/server/auth/session";
import { sha256 } from "@/server/auth/tokens";
import { clearThrottle, throttleKey } from "@/server/auth/throttle";
import {
  completePasswordReset,
  demoSignIn,
  inspectResetToken,
  requestPasswordReset,
  safeNext,
  signInMessage,
  signInWithPassword,
  slugFromNext,
} from "@/modules/identity/auth";
import { idnSessions, idnTokens } from "@/modules/identity/schema";
import { makeUniversity, makeUser, person } from "../fixtures";
import { cookieJar, inlineDefer, later, linkIn, mailTo, minutes, resetOutbox, setPassword, useIdentityOnly } from "./helpers";

const PW = "correct horse battery";
const client = { ip: "10.0.0.1", userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/141.0 Mobile" };

beforeAll(() => useIdentityOnly());
beforeEach(() => resetOutbox());
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

/** A person with a password, an email unique to this test, and a fresh IP so limits don't mix. */
async function account(name = "Signin Sita") {
  const u = await makeUser(name);
  await setPassword(u.id, PW);
  return { ...u, ip: `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
}

describe("password sign-in", () => {
  it("accepts the right password, case-insensitive email", async () => {
    const u = await account();
    const r = await signInWithPassword({ email: u.email.toUpperCase(), password: PW, ip: u.ip });
    expect(r).toEqual({ ok: true, userId: u.id });
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const u = await account();
    const wrong = await signInWithPassword({ email: u.email, password: "not it at all", ip: u.ip });
    const unknown = await signInWithPassword({ email: `nobody.${u.id}@nowhere.test`, password: "not it at all", ip: u.ip });
    expect(wrong).toEqual({ ok: false, reason: "wrong", remaining: 4 });
    expect(unknown).toEqual({ ok: false, reason: "wrong", remaining: 4 });
    if (!wrong.ok && !unknown.ok) expect(signInMessage(wrong)).toBe(signInMessage(unknown));
  });

  it("refuses accounts without a password (invited, not joined yet)", async () => {
    const u = await makeUser("No Password");
    expect(await signInWithPassword({ email: u.email, password: "anything at all", ip: "10.9.9.9" })).toMatchObject({ ok: false, reason: "wrong" });
  });
});

describe("lockout after repeated failures", () => {
  it("locks after 5 wrong passwords, refuses even the right one, then clears when the time is up", async () => {
    const u = await account("Lock Lata");
    const t0 = new Date();
    for (let i = 1; i <= 4; i++) {
      const r = await signInWithPassword({ email: u.email, password: "wrong guess", ip: u.ip, now: later(t0, i * 1000) });
      expect(r).toMatchObject({ ok: false, reason: "wrong", remaining: 5 - i });
    }
    const fifth = await signInWithPassword({ email: u.email, password: "wrong guess", ip: u.ip, now: later(t0, 5000) });
    expect(fifth).toMatchObject({ ok: false, reason: "locked" });
    if (!fifth.ok && fifth.reason === "locked") {
      expect(fifth.until.getTime() - later(t0, 5000).getTime()).toBe(LIMITS.passwordPerEmail.lockMs);
      // The message is generic: it says the email is paused, not whether the password was close.
      expect(signInMessage(fifth, later(t0, 5000))).toMatch(/paused for 15 minutes/);
    }

    // Locked: even the right password is refused.
    expect(await signInWithPassword({ email: u.email, password: PW, ip: u.ip, now: later(t0, minutes(10)) })).toMatchObject({ ok: false, reason: "locked" });
    // Unknown emails lock the same way, so a lock reveals nothing.
    const ghost = `ghost.${u.id}@nowhere.test`;
    for (let i = 0; i < 5; i++) await signInWithPassword({ email: ghost, password: "x y z w", ip: u.ip, now: later(t0, i * 1000) });
    expect(await signInWithPassword({ email: ghost, password: "x y z w", ip: u.ip, now: later(t0, 6000) })).toMatchObject({ reason: "locked" });

    // After the lock ends, the right password works and the counter starts again.
    expect(await signInWithPassword({ email: u.email, password: PW, ip: u.ip, now: later(t0, minutes(16)) })).toEqual({ ok: true, userId: u.id });
    expect(await signInWithPassword({ email: u.email, password: "nope nope", ip: u.ip, now: later(t0, minutes(17)) })).toMatchObject({ remaining: 4 });
  });

  it("a second lock within a day lasts twice as long", async () => {
    const u = await account("Double Lock");
    const t0 = new Date();
    for (let i = 0; i < 5; i++) await signInWithPassword({ email: u.email, password: "wrong one", ip: u.ip, now: later(t0, i) });
    const t1 = later(t0, minutes(20));
    let last;
    for (let i = 0; i < 5; i++) last = await signInWithPassword({ email: u.email, password: "wrong one", ip: u.ip, now: later(t1, i) });
    expect(last).toMatchObject({ reason: "locked" });
    if (last && !last.ok && last.reason === "locked") expect(last.until.getTime() - later(t1, 4).getTime()).toBe(2 * LIMITS.passwordPerEmail.lockMs);
  });

  it("failures spread over more than the window don't add up", async () => {
    const u = await account("Slow Typist");
    const t0 = new Date();
    for (let i = 0; i < 4; i++) await signInWithPassword({ email: u.email, password: "wrong one", ip: u.ip, now: later(t0, i) });
    const r = await signInWithPassword({ email: u.email, password: "wrong one", ip: u.ip, now: later(t0, LIMITS.passwordPerEmail.windowMs + 1000) });
    expect(r).toMatchObject({ reason: "wrong", remaining: 4 });
  });

  it("limits one network, across many emails", async () => {
    const ip = `10.250.${Math.floor(Math.random() * 250)}.1`;
    const t0 = new Date();
    let r;
    for (let i = 0; i < LIMITS.passwordPerIp.limit; i++) {
      r = await signInWithPassword({ email: `spray${i}.${ip}@nowhere.test`, password: "guess guess", ip, now: later(t0, i) });
    }
    expect(r).toMatchObject({ ok: false, reason: "network_locked" });
    const u = await account("Same Network");
    expect(await signInWithPassword({ email: u.email, password: PW, ip, now: later(t0, 100) })).toMatchObject({ reason: "network_locked" });
    expect(await signInWithPassword({ email: u.email, password: PW, ip: "10.1.2.3", now: later(t0, 100) })).toEqual({ ok: true, userId: u.id });
  });

  it("writes the lock to the audit log of each university the person belongs to", async () => {
    const uni = await makeUniversity("Lock Audit U");
    const p = await person("Audited Anu", "student", { universityId: uni.id });
    await setPassword(p.user.id, PW);
    for (let i = 0; i < 5; i++) await signInWithPassword({ email: p.user.email, password: "bad guess", ip: "10.77.0.1" });
    const rows = await systemDb().select().from(auditLog).where(eq(auditLog.entityId, p.user.id));
    expect(rows.find((r) => r.action === "auth.locked")).toMatchObject({ universityId: uni.id, actorUserId: p.user.id });
    await clearThrottle(throttleKey("signin-email", p.user.email));
  });
});

describe("password reset", () => {
  it("answers the same for known and unknown emails, and only emails the real account", async () => {
    const u = await account("Reset Ritu");
    const known = inlineDefer();
    const unknown = inlineDefer();
    const a = await requestPasswordReset({ email: u.email, ip: u.ip, defer: known.defer });
    const b = await requestPasswordReset({ email: `nobody.${u.id}@nowhere.test`, ip: u.ip, defer: unknown.defer });
    expect(a).toEqual({ status: "sent" });
    expect(b).toEqual(a);
    await Promise.all([known.flush(), unknown.flush()]);
    expect(mailTo(u.email)).toHaveLength(1);
    expect(mailTo(`nobody.${u.id}@nowhere.test`)).toHaveLength(0);
    expect(mailTo(u.email)[0]).toMatchObject({ subject: "Reset your Zinny password", kind: "security.reset" });
  });

  it("takes about as long for known and unknown emails (all lookups happen after the response)", async () => {
    const u = await account("Timing Tara");
    const time = async (email: string) => {
      const start = performance.now();
      await requestPasswordReset({ email, ip: u.ip, defer: () => {} });
      return performance.now() - start;
    };
    // Warm up, then compare medians of several runs.
    await time(u.email);
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 7; i++) {
      known.push(await time(u.email));
      unknown.push(await time(`ghost${i}.${u.id}@nowhere.test`));
    }
    const median = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
    expect(Math.abs(median(known) - median(unknown))).toBeLessThan(25);
  });

  it("the link is single-use, stored hashed, and setting a password signs out every session", async () => {
    const u = await account("Reset Rohan");
    const s1 = await createSession(u.id, "password", client);
    const s2 = await createSession(u.id, "phone", client);
    const d = inlineDefer();
    await requestPasswordReset({ email: u.email, ip: u.ip, defer: d.defer });
    await d.flush();
    const token = linkIn(u.email, "reset");
    const [row] = await systemDb().select().from(idnTokens).where(eq(idnTokens.userId, u.id));
    expect(row.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await inspectResetToken(token)).toMatchObject({ state: "valid" });

    const NEW = "a brand new passphrase";
    await completePasswordReset({ token, password: NEW, confirm: NEW });
    const [after] = await systemDb().select().from(users).where(eq(users.id, u.id));
    expect(await verifyPassword(NEW, after.passwordHash!)).toBe(true);
    expect(await resolveSession(s1.token)).toBeNull();
    expect(await resolveSession(s2.token)).toBeNull();
    expect((await inspectResetToken(token)).state).toBe("used");
    await expect(completePasswordReset({ token, password: "yet another phrase", confirm: "yet another phrase" })).rejects.toThrow(/already used/);
    expect(mailTo(u.email).map((m) => m.kind)).toEqual(["security.reset", "security.password_changed"]);
  });

  it("expires after 30 minutes", async () => {
    const u = await account("Late Reset");
    const d = inlineDefer();
    const t0 = new Date();
    await requestPasswordReset({ email: u.email, ip: u.ip, defer: d.defer, now: t0 });
    await d.flush();
    const token = linkIn(u.email, "reset");
    expect((await inspectResetToken(token, later(t0, minutes(29)))).state).toBe("valid");
    expect((await inspectResetToken(token, later(t0, AUTH.reset.validMs + 1000))).state).toBe("expired");
    await expect(completePasswordReset({ token, password: "fine new phrase", confirm: "fine new phrase", now: later(t0, minutes(31)) })).rejects.toThrow(
      /expired/,
    );
  });

  it("using one link cancels the person's other reset links", async () => {
    const u = await account("Many Links");
    const d = inlineDefer();
    await requestPasswordReset({ email: u.email, ip: u.ip, defer: d.defer });
    await d.flush();
    const first = linkIn(u.email, "reset");
    await requestPasswordReset({ email: u.email, ip: u.ip, defer: d.defer });
    await d.flush();
    const second = linkIn(u.email, "reset");
    expect(second).not.toBe(first);
    await completePasswordReset({ token: second, password: "the second link", confirm: "the second link" });
    expect((await inspectResetToken(first)).state).toBe("used");
  });

  it("caps reset emails per address without telling the screen", async () => {
    const u = await account("Spammed Sam");
    const d = inlineDefer();
    for (let i = 0; i < LIMITS.resetPerEmail.limit + 2; i++) {
      expect(await requestPasswordReset({ email: u.email, ip: u.ip, defer: d.defer })).toEqual({ status: "sent" });
    }
    await d.flush();
    expect(mailTo(u.email)).toHaveLength(LIMITS.resetPerEmail.limit);
  });

  it("a reset lifts a lock from wrong passwords", async () => {
    const u = await account("Locked Then Reset");
    for (let i = 0; i < 5; i++) await signInWithPassword({ email: u.email, password: "bad bad bad", ip: u.ip });
    expect(await signInWithPassword({ email: u.email, password: PW, ip: u.ip })).toMatchObject({ reason: "locked" });
    const d = inlineDefer();
    await requestPasswordReset({ email: u.email, ip: u.ip, defer: d.defer });
    await d.flush();
    const NEW = "fresh start phrase";
    await completePasswordReset({ token: linkIn(u.email, "reset"), password: NEW, confirm: NEW });
    expect(await signInWithPassword({ email: u.email, password: NEW, ip: u.ip })).toEqual({ ok: true, userId: u.id });
  });

  it("rejects malformed and unknown tokens", async () => {
    expect((await inspectResetToken("short")).state).toBe("invalid");
    expect((await inspectResetToken("A".repeat(43))).state).toBe("invalid");
    await expect(completePasswordReset({ token: "A".repeat(43), password: "whatever works", confirm: "whatever works" })).rejects.toThrow(/isn't valid/);
  });

  it("checks the email looks like one", async () => {
    await expect(requestPasswordReset({ email: "not an email", ip: "10.1.1.1", defer: () => {} })).rejects.toThrow(/email address/);
  });
});

describe("sessions", () => {
  it("every sign-in gets a new session id, and the browser's previous session ends", async () => {
    const u = await account("Fixation Faisal");
    const jar = cookieJar();
    const first = await startSession(u.id, "password", { jar, client });
    const firstToken = jar.values.get(sessionCookieName())!;
    const second = await startSession(u.id, "password", { jar, client });
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(jar.values.get(sessionCookieName())).not.toBe(firstToken);
    expect(await resolveSession(firstToken)).toBeNull();
    expect(await resolveSession(jar.values.get(sessionCookieName())!)).toMatchObject({ userId: u.id, sessionId: second.sessionId });

    // Only the hash of the token is stored.
    const [row] = await systemDb().select().from(sessions).where(eq(sessions.id, second.sessionId));
    expect(row.tokenHash).toBe(sha256(second.token));
  });

  it("sets httpOnly, SameSite=Lax cookies; Secure and __Host- in production", async () => {
    const u = await account("Cookie Kim");
    const jar = cookieJar();
    await startSession(u.id, "password", { jar, client });
    const opts = jar.options.get(sessionCookieName())!;
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const env = process.env as Record<string, string | undefined>;
    const was = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(sessionCookieName()).toBe("__Host-zinny_session");
      expect(cookieOptions().secure).toBe(true);
    } finally {
      env.NODE_ENV = was;
    }
    expect(cookieOptions().secure).toBe(false);
  });

  it("sliding expiry: use extends the session; 14 idle days end it; 30 days end it regardless", async () => {
    const u = await account("Sliding Sid");
    const t0 = new Date();
    const s = await createSession(u.id, "password", client, t0);
    const day = 86_400_000;
    // Used on day 10: extended to day 24.
    expect(await resolveSession(s.token, later(t0, 10 * day))).toMatchObject({ userId: u.id });
    const [row] = await systemDb().select().from(sessions).where(eq(sessions.id, s.sessionId));
    expect(row.expiresAt.getTime()).toBe(later(t0, 24 * day).getTime());
    // Used again on day 23 and day 29: still in, but never past day 30.
    expect(await resolveSession(s.token, later(t0, 23 * day))).not.toBeNull();
    expect(await resolveSession(s.token, later(t0, 29 * day))).not.toBeNull();
    const [capped] = await systemDb().select().from(sessions).where(eq(sessions.id, s.sessionId));
    expect(capped.expiresAt.getTime()).toBe(later(t0, AUTH.session.absoluteMs).getTime());
    expect(await resolveSession(s.token, later(t0, 30 * day + 1000))).toBeNull();

    // Unused for 14 days: ended.
    const idle = await createSession(u.id, "password", client, t0);
    expect(await resolveSession(idle.token, later(t0, 14 * day + 1000))).toBeNull();
  });

  it("doesn't write on every request (extends at most every 10 minutes)", async () => {
    const u = await account("Quiet Writes");
    const t0 = new Date();
    const s = await createSession(u.id, "password", client, t0);
    await resolveSession(s.token, later(t0, minutes(5)));
    const [row] = await systemDb().select().from(sessions).where(eq(sessions.id, s.sessionId));
    expect(row.expiresAt.getTime()).toBe(s.expiresAt.getTime());
  });

  it("revoking a session signs that device out, and nobody else's", async () => {
    const u = await account("Revoke Ravi");
    const other = await account("Other Olga");
    const phone = await createSession(u.id, "phone", client);
    const laptop = await createSession(u.id, "password", client);
    const theirs = await createSession(other.id, "password", client);

    expect(await revokeSession(other.id, phone.sessionId)).toBe(false); // not theirs to end
    expect(await resolveSession(phone.token)).not.toBeNull();
    expect(await revokeSession(u.id, phone.sessionId)).toBe(true);
    expect(await resolveSession(phone.token)).toBeNull();
    expect(await resolveSession(laptop.token)).not.toBeNull();

    expect(await revokeAllSessions(u.id, { except: laptop.sessionId })).toBe(0);
    expect(await revokeAllSessions(u.id)).toBe(1);
    expect(await resolveSession(laptop.token)).toBeNull();
    expect(await resolveSession(theirs.token)).not.toBeNull();
  });

  it("lists live sessions with how they signed in, newest use first", async () => {
    const u = await account("List Leela");
    const t0 = new Date(Date.now() - 60_000);
    const a = await createSession(u.id, "password", { ip: "1.2.3.4", userAgent: "UA-A" }, t0);
    const b = await createSession(u.id, "phone", { ip: "5.6.7.8", userAgent: "UA-B" }, later(t0, 30_000));
    const list = await listSessions(u.id);
    expect(list.map((s) => [s.id, s.method, s.ip])).toEqual([
      [b.sessionId, "phone", "5.6.7.8"],
      [a.sessionId, "password", "1.2.3.4"],
    ]);
    const [extra] = await systemDb().select().from(idnSessions).where(eq(idnSessions.sessionId, a.sessionId));
    expect(extra.userAgent).toBe("UA-A");
  });

  it("signing out ends the session and clears the cookie", async () => {
    const u = await account("Bye Bina");
    const jar = cookieJar();
    const s = await startSession(u.id, "password", { jar, client });
    await signOut({ jar });
    expect(jar.values.has(sessionCookieName())).toBe(false);
    expect(await resolveSession(s.token)).toBeNull();
  });
});

describe("demo accounts and redirects", () => {
  it("demo sign-in only for the listed demo accounts, and only when demo mode is on", async () => {
    expect(demoEnabled()).toBe(true); // tests don't run in production
    const env = process.env as Record<string, string | undefined>;
    const was = { node: env.NODE_ENV, demo: env.ZINNY_DEMO };
    try {
      env.NODE_ENV = "production";
      delete env.ZINNY_DEMO;
      expect(demoEnabled()).toBe(false);
      await expect(demoSignIn("asha@demo.edu")).rejects.toThrow(/turned off/);
      env.ZINNY_DEMO = "1";
      expect(demoEnabled()).toBe(true);
    } finally {
      env.NODE_ENV = was.node;
      if (was.demo === undefined) delete env.ZINNY_DEMO;
      else env.ZINNY_DEMO = was.demo;
    }
    const u = await account("Not A Demo");
    await expect(demoSignIn(u.email)).rejects.toThrow(/isn't a demo account/);
  });

  it("only follows `next` to paths on this site", () => {
    expect(safeNext("/demo/learn/my")).toBe("/demo/learn/my");
    expect(safeNext("https://evil.test")).toBeNull();
    expect(safeNext("//evil.test/x")).toBeNull();
    expect(safeNext("/\\evil.test")).toBeNull();
    expect(safeNext("/login?next=/x")).toBe("/");
    expect(safeNext("/demo")).toBe("/");
    expect(slugFromNext("/demo/learn")).toBe("demo");
    expect(slugFromNext("/platform")).toBeNull();
    expect(slugFromNext("//evil.test")).toBeNull();
  });
});

describe("password rules", () => {
  it("needs 8+ characters, not common, not the email or name, at most 72 bytes", () => {
    expect(() => checkNewPassword("short")).toThrow(/at least 8/);
    expect(() => checkNewPassword("password123")).toThrow(/too common/);
    expect(() => checkNewPassword("aaaaaaaaaa")).toThrow(/repeats/);
    expect(() => checkNewPassword("riyasharma", { email: "riyasharma@demo.edu" })).toThrow(/email/);
    expect(() => checkNewPassword("Riya Sharma", { name: "Riya Sharma" })).toThrow(/name/);
    expect(() => checkNewPassword("x".repeat(30) + "é".repeat(30))).toThrow(/too long/);
    expect(() => checkNewPassword("a fine phrase", { confirm: "a fine phrase!" })).toThrow(/don't match/);
    expect(checkNewPassword("chai at four pm")).toBe("chai at four pm");
  });
});
