import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { setTestModules } from "@/server/registry";
import { AUTH, LIMITS } from "@/server/auth/config";
import { maskPhone, normalizePhone } from "@/server/auth/phone";
import { choosePhoneAccount, phoneSignInEnabled, phoneSignInView, resendPhoneCode, startPhoneSignIn, verifyPhoneCode } from "@/modules/identity/auth";
import { setPhoneSignIn } from "@/modules/identity/settings";
import { idnOtpChallenges } from "@/modules/identity/schema";
import { makeUniversity, person } from "../fixtures";
import { codeIn, inlineDefer, later, resetOutbox, setPhone, sms, smsTo, useIdentityOnly } from "./helpers";

beforeAll(() => useIdentityOnly());
beforeEach(() => resetOutbox());
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

let seq = 0;
/** A unique, valid Indian mobile number per call. */
const freshPhone = () => `+9198${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++seq % 100).padStart(2, "0")}`;

async function phoneUni(name = "Phone U") {
  const uni = await makeUniversity(name);
  const admin = await (await person("Admin Phone", "institute_admin", { universityId: uni.id })).actor();
  await setPhoneSignIn(admin, true);
  return { uni, admin };
}

async function member(universityId: string, name: string, phone: string, role: "student" | "parent" = "student") {
  const p = await person(name, role, { universityId });
  await setPhone(p.user.id, phone);
  return p.user;
}

const wrongCode = (right: string) => String((Number(right) + 1) % 1_000_000).padStart(6, "0");

describe("phone numbers", () => {
  it("normalizes the ways people type Indian mobile numbers", () => {
    for (const v of ["98200 11001", "+91 98200 11001", "+91-98200-11001", "09820011001", "919820011001", "(982) 001-1001"]) {
      expect([v, normalizePhone(v)]).toEqual([v, "+919820011001"]);
    }
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("5820011001")).toBeNull(); // Indian mobiles start with 6–9
    expect(normalizePhone("call me")).toBeNull();
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123");
    expect(maskPhone("+919820011001")).toBe("+91 98••• ••001");
  });
});

describe("phone sign-in", () => {
  it("is off until the university turns it on (settings.manage only)", async () => {
    const uni = await makeUniversity("Off U");
    const admin = await (await person("Admin Off", "institute_admin", { universityId: uni.id })).actor();
    const hod = await (await person("Not Admin", "board_owner", { universityId: uni.id })).actor();
    expect(await phoneSignInEnabled(uni.id)).toBe(false);
    await expect(startPhoneSignIn({ universityId: uni.id, phone: freshPhone(), ip: "10.0.0.1", defer: () => {} })).rejects.toThrow(/isn't turned on/);
    await expect(setPhoneSignIn(hod, true)).rejects.toThrow(/access/);
    await setPhoneSignIn(admin, true);
    expect(await phoneSignInEnabled(uni.id)).toBe(true);
  });

  it("sends a 6-digit code by SMS that signs the person in, valid once", async () => {
    const { uni } = await phoneUni("Code U");
    const phone = freshPhone();
    const riya = await member(uni.id, "Riya Phone", phone);
    const d = inlineDefer();
    const start = await startPhoneSignIn({ universityId: uni.id, phone: phone.slice(3), ip: "10.0.0.2", defer: d.defer });
    await d.flush();
    expect(start.masked).toBe(maskPhone(phone));
    expect(start.expiresAt.getTime() - Date.now()).toBeGreaterThan(AUTH.otp.validMs - 5000);
    const [msg] = smsTo(phone);
    expect(msg.kind).toBe("security.otp");
    expect(msg.universityId).toBe(uni.id);
    expect(msg.text).toMatch(/^\d{6} is your Zinny sign-in code for Code U/);
    const code = codeIn(phone);

    // Stored hashed, never in clear.
    const [row] = await systemDb().select().from(idnOtpChallenges).where(eq(idnOtpChallenges.universityId, uni.id));
    expect(JSON.stringify(row)).not.toContain(code);

    expect(await verifyPhoneCode({ ref: start.ref, code: `${code.slice(0, 3)} ${code.slice(3)}` })).toEqual({ status: "signed_in", userId: riya.id });
    await expect(verifyPhoneCode({ ref: start.ref, code })).rejects.toThrow(/timed out/);
  });

  it("matches numbers stored in other formats (e.g. from CSV import)", async () => {
    const { uni } = await phoneUni("Format U");
    const phone = freshPhone();
    const u = await member(uni.id, "Csv Chetan", `0${phone.slice(3, 8)} ${phone.slice(8)}`);
    const d = inlineDefer();
    const start = await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.3", defer: d.defer });
    await d.flush();
    expect(await verifyPhoneCode({ ref: start.ref, code: codeIn(phone) })).toEqual({ status: "signed_in", userId: u.id });
  });

  it("expires after 5 minutes", async () => {
    const { uni } = await phoneUni("Expire U");
    const phone = freshPhone();
    await member(uni.id, "Slow Sam", phone);
    const d = inlineDefer();
    const t0 = new Date();
    const start = await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.4", defer: d.defer, now: t0 });
    await d.flush();
    await expect(verifyPhoneCode({ ref: start.ref, code: codeIn(phone), now: later(t0, AUTH.otp.validMs + 1000) })).rejects.toThrow(/expired/);
  });

  it("caps attempts at 5 per code; then even the right code is refused until a new one is sent", async () => {
    const { uni } = await phoneUni("Attempts U");
    const phone = freshPhone();
    const u = await member(uni.id, "Guess Gita", phone);
    const d = inlineDefer();
    const t0 = new Date();
    const start = await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.5", defer: d.defer, now: t0 });
    await d.flush();
    const code = codeIn(phone);
    for (let i = 1; i <= 4; i++) {
      await expect(verifyPhoneCode({ ref: start.ref, code: wrongCode(code), now: later(t0, i * 1000) })).rejects.toThrow(`${5 - i} ${5 - i === 1 ? "try" : "tries"} left`);
    }
    await expect(verifyPhoneCode({ ref: start.ref, code: wrongCode(code), now: later(t0, 5000) })).rejects.toThrow(/last try/);
    await expect(verifyPhoneCode({ ref: start.ref, code, now: later(t0, 6000) })).rejects.toThrow(/Too many wrong tries/);
    expect(await phoneSignInView(start.ref, later(t0, 6000))).toMatchObject({ step: "code", attemptsLeft: 0 });

    // A new code resets the count (after the 30-second wait).
    await expect(resendPhoneCode({ ref: start.ref, ip: "10.0.0.5", defer: d.defer, now: later(t0, 10_000) })).rejects.toThrow(/Wait 20 seconds/);
    await resendPhoneCode({ ref: start.ref, ip: "10.0.0.5", defer: d.defer, now: later(t0, AUTH.otp.resendAfterMs) });
    await d.flush();
    const fresh = codeIn(phone);
    // The old code no longer works.
    if (fresh !== code) await expect(verifyPhoneCode({ ref: start.ref, code, now: later(t0, 40_000) })).rejects.toThrow(/wrong/);
    expect(await verifyPhoneCode({ ref: start.ref, code: fresh, now: later(t0, 41_000) })).toEqual({ status: "signed_in", userId: u.id });
  });

  it("locks the number after 10 wrong codes in an hour, across codes", async () => {
    const { uni } = await phoneUni("Phone Lock U");
    const phone = freshPhone();
    await member(uni.id, "Brute Force Target", phone);
    const d = inlineDefer();
    const t0 = new Date();
    const first = await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.6", defer: d.defer, now: t0 });
    await d.flush();
    const c1 = codeIn(phone);
    for (let i = 0; i < 5; i++) await verifyPhoneCode({ ref: first.ref, code: wrongCode(c1), now: later(t0, i) }).catch(() => undefined);
    const second = await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.6", defer: d.defer, now: later(t0, 10) });
    await d.flush();
    const c2 = codeIn(phone);
    for (let i = 0; i < 4; i++) await verifyPhoneCode({ ref: second.ref, code: wrongCode(c2), now: later(t0, 20 + i) }).catch(() => undefined);
    await expect(verifyPhoneCode({ ref: second.ref, code: wrongCode(c2), now: later(t0, 30) })).rejects.toThrow(/paused for 30 minutes/);
    // Locked: no new codes, and the right code doesn't work.
    await expect(startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.6", defer: d.defer, now: later(t0, 40) })).rejects.toThrow(/paused/);
    // When the lock ends, it clears.
    const t1 = later(t0, LIMITS.codePerPhone.lockMs + 1000);
    const third = await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.6", defer: d.defer, now: t1 });
    await d.flush();
    expect(await verifyPhoneCode({ ref: third.ref, code: codeIn(phone), now: later(t1, 1000) })).toMatchObject({ status: "signed_in" });
  });

  it("resend waits 30 seconds and is capped per sign-in", async () => {
    const { uni } = await phoneUni("Resend U");
    const phone = freshPhone();
    await member(uni.id, "Resend Rekha", phone);
    const d = inlineDefer();
    const t0 = new Date();
    const start = await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.7", defer: d.defer, now: t0 });
    await expect(resendPhoneCode({ ref: start.ref, ip: "10.0.0.7", defer: d.defer, now: later(t0, 29_000) })).rejects.toThrow("Wait 1 second before");
    let t = t0;
    for (let i = 0; i < AUTH.otp.maxSendsPerChallenge - 1; i++) {
      t = later(t, AUTH.otp.resendAfterMs);
      await resendPhoneCode({ ref: start.ref, ip: "10.0.0.7", defer: d.defer, now: t });
    }
    await d.flush();
    expect(smsTo(phone)).toHaveLength(AUTH.otp.maxSendsPerChallenge);
    await expect(resendPhoneCode({ ref: start.ref, ip: "10.0.0.7", defer: d.defer, now: later(t, AUTH.otp.resendAfterMs) })).rejects.toThrow();
  });

  it("caps codes sent to one number per hour", async () => {
    const { uni } = await phoneUni("Send Cap U");
    const phone = freshPhone();
    await member(uni.id, "Popular Number", phone);
    const t0 = new Date();
    for (let i = 0; i < LIMITS.codeSendsPerPhone.limit; i++) {
      await startPhoneSignIn({ universityId: uni.id, phone, ip: `10.1.0.${i}`, defer: () => {}, now: later(t0, i) });
    }
    await expect(startPhoneSignIn({ universityId: uni.id, phone, ip: "10.1.0.99", defer: () => {}, now: later(t0, 100) })).rejects.toThrow(/several codes/);
  });

  it("an unknown number looks the same on screen, but no SMS is sent and no code works", async () => {
    const { uni } = await phoneUni("Unknown U");
    const phone = freshPhone();
    const d = inlineDefer();
    const start = await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.8", defer: d.defer });
    await d.flush();
    expect(start.masked).toBe(maskPhone(phone));
    expect(sms).toHaveLength(0);
    await expect(verifyPhoneCode({ ref: start.ref, code: "123456" })).rejects.toThrow(/wrong/);
  });

  it("a number from university A can't sign in to university B", async () => {
    const a = await phoneUni("Phone A");
    const b = await phoneUni("Phone B");
    const phone = freshPhone();
    await member(a.uni.id, "Only In A", phone);
    const d = inlineDefer();
    await startPhoneSignIn({ universityId: b.uni.id, phone, ip: "10.0.0.9", defer: d.defer });
    await d.flush();
    expect(smsTo(phone)).toHaveLength(0);

    // A real sign-in at A: its reference can't be replayed against B.
    const atA = await startPhoneSignIn({ universityId: a.uni.id, phone, ip: "10.0.0.9", defer: d.defer });
    await d.flush();
    const { compactUuid } = await import("@/server/auth/tokens");
    const [, challenge, nonce] = atA.ref.split(".");
    const forged = `${compactUuid(b.uni.id)}.${challenge}.${nonce}`;
    await expect(verifyPhoneCode({ ref: forged, code: codeIn(phone) })).rejects.toThrow(/timed out/);
  });

  it("people who left (revoked role) can't sign in with their number", async () => {
    const { uni } = await phoneUni("Left U");
    const phone = freshPhone();
    const u = await member(uni.id, "Left Lalit", phone);
    const { roleAssignments } = await import("@/db/schema");
    await systemDb().update(roleAssignments).set({ revokedAt: new Date() }).where(eq(roleAssignments.userId, u.id));
    const d = inlineDefer();
    await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.10", defer: d.defer });
    await d.flush();
    expect(smsTo(phone)).toHaveLength(0);
  });

  it("a shared family phone asks which account is signing in", async () => {
    const { uni } = await phoneUni("Family U");
    const phone = freshPhone();
    const kid = await member(uni.id, "Kid Kavya", phone);
    const mum = await member(uni.id, "Mum Meena", phone, "parent");
    const d = inlineDefer();
    const start = await startPhoneSignIn({ universityId: uni.id, phone, ip: "10.0.0.11", defer: d.defer });
    await d.flush();
    expect(smsTo(phone)).toHaveLength(1);
    expect(await verifyPhoneCode({ ref: start.ref, code: codeIn(phone) })).toEqual({ status: "choose" });
    const view = await phoneSignInView(start.ref);
    expect(view?.step === "choose" && view.accounts.map((a) => a.name)).toEqual(["Kid Kavya", "Mum Meena"]);
    expect(view?.step === "choose" && view.accounts[0].email).toMatch(/^.•••@/);
    const stranger = await member(uni.id, "Stranger", freshPhone());
    await expect(choosePhoneAccount({ ref: start.ref, userId: stranger.id })).rejects.toThrow(/Choose one/);
    expect(await choosePhoneAccount({ ref: start.ref, userId: mum.id })).toEqual({ userId: mum.id });
    await expect(choosePhoneAccount({ ref: start.ref, userId: kid.id })).rejects.toThrow(/timed out/);
  });

  it("rejects malformed references and codes", async () => {
    await expect(verifyPhoneCode({ ref: "junk", code: "123456" })).rejects.toThrow(/timed out/);
    await expect(verifyPhoneCode({ ref: null, code: "123456" })).rejects.toThrow(/timed out/);
    const { uni } = await phoneUni("Malformed U");
    const start = await startPhoneSignIn({ universityId: uni.id, phone: freshPhone(), ip: "10.0.0.12", defer: () => {} });
    await expect(verifyPhoneCode({ ref: start.ref, code: "12ab56" })).rejects.toThrow(/6-digit/);
    await expect(startPhoneSignIn({ universityId: uni.id, phone: "12345", ip: "10.0.0.12", defer: () => {} })).rejects.toThrow(/10-digit/);
  });
});
