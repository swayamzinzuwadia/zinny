import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { storage } from "@/server/core";
import { verifyPassword } from "@/server/auth/passwords";
import { createSession, resolveSession } from "@/server/auth/session";
import { signInWithPassword } from "@/modules/identity/auth";
import {
  cancelPhoneChange,
  changePassword,
  getProfile,
  mySessions,
  removePhone,
  removePhoto,
  signOutEverywhere,
  signOutSession,
  startPhoneChange,
  updateName,
  uploadPhoto,
  verifyPhoneChange,
} from "@/modules/identity/profile";
import { idnPhotos } from "@/modules/identity/schema";
import { makeDepartment, makeUniversity, person } from "../fixtures";
import { codeIn, inlineDefer, mailTo, resetOutbox, setPassword, setPhone, useIdentityOnly } from "./helpers";

const PW = "my old pass phrase";
const client = { ip: "10.3.3.3", userAgent: "Mozilla/5.0 (iPhone) Safari" };

beforeAll(() => useIdentityOnly());
beforeEach(() => resetOutbox());
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

async function setup(name = "Profile U") {
  const uni = await makeUniversity(name);
  const dept = await makeDepartment(uni.id, "CS", "Computer Science");
  const mk = async (who: string, role: "student" | "institute_admin" | "hod" | "parent" | "board_owner", scope: { departmentId?: string } = {}) => {
    const p = await person(who, role, { universityId: uni.id, ...scope });
    await setPassword(p.user.id, PW);
    return { user: p.user, actor: await p.actor() };
  };
  return {
    uni,
    student: await mk("Priya Student", "student"),
    other: await mk("Omar Student", "student"),
    admin: await mk("Anil Admin", "institute_admin"),
    hod: await mk("Hari Hod", "hod", { departmentId: dept.id }),
    parent: await mk("Pooja Parent", "parent"),
  };
}

async function pngBytes(w = 800, h = 600) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 11, g: 94, b: 76 } } })
    .png()
    .withMetadata({ exif: { IFD0: { Copyright: "secret-location-data" } } })
    .toBuffer();
}

let seq = 0;
const freshPhone = () => `+9197${String(Date.now() % 1_000_000).padStart(6, "0")}${String(++seq % 100).padStart(2, "0")}`;

describe("profile (self.profile): allowed for every university role, on your own profile", () => {
  it("students, admins, HODs and parents can read and change their own name", async () => {
    const s = await setup("Own Profile U");
    for (const who of [s.student, s.admin, s.hod, s.parent]) {
      const p = await getProfile(who.actor, who.user.id);
      expect(p).toMatchObject({ id: who.user.id, email: who.user.email, hasPassword: true });
      await updateName(who.actor, who.user.id, `  ${who.user.name}   Renamed `);
      const [u] = await systemDb().select().from(users).where(eq(users.id, who.user.id));
      expect(u.name).toBe(`${who.user.name} Renamed`);
    }
    const [log] = await systemDb().select().from(auditLog).where(eq(auditLog.entityId, s.student.user.id));
    expect(log).toMatchObject({ action: "profile.update_name", universityId: s.uni.id, actorUserId: s.student.user.id });
  });

  it("validates names", async () => {
    const s = await setup("Name Rules U");
    await expect(updateName(s.student.actor, s.student.user.id, " a ")).rejects.toThrow(/at least 2/);
    await expect(updateName(s.student.actor, s.student.user.id, "x".repeat(81))).rejects.toThrow(/too long/);
    await expect(updateName(s.student.actor, s.student.user.id, "<script>")).rejects.toThrow(/ordinary punctuation/);
  });
});

describe("nobody can change another person's profile", () => {
  it("another student, an Institute Admin and a HOD are all denied, for every change", async () => {
    const s = await setup("Others U");
    const target = s.student.user.id;
    await setPhone(target, "+919811111111");
    const png = await pngBytes();
    for (const who of [s.other, s.admin, s.hod, s.parent]) {
      const a = who.actor;
      await expect(getProfile(a, target)).rejects.toThrow(/access/);
      await expect(updateName(a, target, "Hacked Name")).rejects.toThrow(/access/);
      await expect(startPhoneChange(a, target, { phone: freshPhone(), defer: () => {} })).rejects.toThrow(/access/);
      await expect(verifyPhoneChange(a, target, { code: "123456" })).rejects.toThrow(/access/);
      await expect(removePhone(a, target)).rejects.toThrow(/access/);
      await expect(uploadPhoto(a, target, { bytes: png, type: "image/png", size: png.length })).rejects.toThrow(/access/);
      await expect(removePhoto(a, target)).rejects.toThrow(/access/);
      await expect(changePassword(a, target, { current: PW, next: "taken over now", confirm: "taken over now", keepSessionId: null })).rejects.toThrow(/access/);
      await expect(mySessions(a, target)).rejects.toThrow(/access/);
      await expect(signOutEverywhere(a, target)).rejects.toThrow(/access/);
    }
    const [u] = await systemDb().select().from(users).where(eq(users.id, target));
    expect(u.name).toBe("Priya Student");
    expect(u.phone).toBe("+919811111111");
    expect(await verifyPassword(PW, u.passwordHash!)).toBe(true);
  });

  it("someone from another university can't reach this one's profiles, even their own id there", async () => {
    const a = await setup("Profile A");
    const b = await setup("Profile B");
    await expect(getProfile(b.admin.actor, a.student.user.id)).rejects.toThrow(/access/);
    await expect(updateName(b.student.actor, a.student.user.id, "Cross Uni")).rejects.toThrow(/access/);
  });

  it("someone whose role here has ended has no profile here", async () => {
    const uni = await makeUniversity("Ended U");
    const p = await person("Gone Girish", "student", { universityId: uni.id }, new Date(Date.now() - 1000));
    await expect(getProfile(await p.actor(), p.user.id)).rejects.toThrow(/access/);
  });
});

describe("mobile number", () => {
  it("is saved only after the code sent to the new number is entered", async () => {
    const s = await setup("Phone Change U");
    const me = s.student;
    const phone = freshPhone();
    const d = inlineDefer();
    const r = await startPhoneChange(me.actor, me.user.id, { phone: phone.slice(3), defer: d.defer });
    await d.flush();
    expect(r.masked).toMatch(/^\+91 /);
    expect((await getProfile(me.actor, me.user.id)).phone).toBeNull();
    expect((await getProfile(me.actor, me.user.id)).pendingPhone).toMatchObject({ attemptsLeft: 5 });
    const code = codeIn(phone);
    await expect(verifyPhoneChange(me.actor, me.user.id, { code: String((Number(code) + 1) % 1e6).padStart(6, "0") })).rejects.toThrow(/4 tries left/);
    expect(await verifyPhoneChange(me.actor, me.user.id, { code })).toEqual({ phone });
    const p = await getProfile(me.actor, me.user.id);
    expect(p.phone).toBe(phone);
    expect(p.pendingPhone).toBeNull();
    const logs = await systemDb().select().from(auditLog).where(eq(auditLog.entityId, me.user.id));
    expect(logs.find((l) => l.action === "profile.update_phone")?.data).toMatchObject({ to: expect.stringContaining("•••") });
  });

  it("caps attempts at 5 per code, and can be cancelled", async () => {
    const s = await setup("Phone Cap U");
    const me = s.student;
    const phone = freshPhone();
    const d = inlineDefer();
    await startPhoneChange(me.actor, me.user.id, { phone, defer: d.defer });
    await d.flush();
    const code = codeIn(phone);
    const wrong = String((Number(code) + 1) % 1e6).padStart(6, "0");
    for (let i = 0; i < 4; i++) await verifyPhoneChange(me.actor, me.user.id, { code: wrong }).catch(() => undefined);
    await expect(verifyPhoneChange(me.actor, me.user.id, { code: wrong })).rejects.toThrow(/last try/);
    await expect(verifyPhoneChange(me.actor, me.user.id, { code })).rejects.toThrow(/Too many wrong tries/);
    await cancelPhoneChange(me.actor, me.user.id);
    await expect(verifyPhoneChange(me.actor, me.user.id, { code })).rejects.toThrow(/no number waiting/);
    expect((await getProfile(me.actor, me.user.id)).phone).toBeNull();
  });

  it("refuses bad numbers and the number you already have; can be removed", async () => {
    const s = await setup("Phone Rules U");
    const me = s.student;
    await expect(startPhoneChange(me.actor, me.user.id, { phone: "12345", defer: () => {} })).rejects.toThrow(/10-digit/);
    const phone = freshPhone();
    await setPhone(me.user.id, phone);
    await expect(startPhoneChange(me.actor, me.user.id, { phone, defer: () => {} })).rejects.toThrow(/already your/);
    await removePhone(me.actor, me.user.id);
    expect((await getProfile(me.actor, me.user.id)).phone).toBeNull();
  });
});

describe("photo", () => {
  it("is stored through storage() as a 512 px square WebP without metadata, and replaced cleanly", async () => {
    const s = await setup("Photo U");
    const me = s.student;
    const png = await pngBytes(1200, 800);
    await uploadPhoto(me.actor, me.user.id, { bytes: png, type: "image/png", size: png.length });
    const [row] = await systemDb().select().from(idnPhotos).where(eq(idnPhotos.userId, me.user.id));
    expect(row.storageKey).toMatch(new RegExp(`^${s.uni.id}/identity/photos/${me.user.id}/[0-9a-f-]+\\.webp$`));
    const stored = await storage().get(row.storageKey);
    expect(stored?.contentType).toBe("image/webp");
    const meta = await sharp(stored!.body).metadata();
    expect([meta.format, meta.width, meta.height, meta.exif]).toEqual(["webp", 512, 512, undefined]);
    expect((await getProfile(me.actor, me.user.id)).photoUrl).toMatch(/^\/api\/storage\//);

    await uploadPhoto(me.actor, me.user.id, { bytes: png, type: "image/png", size: png.length });
    const [next] = await systemDb().select().from(idnPhotos).where(eq(idnPhotos.userId, me.user.id));
    expect(next.storageKey).not.toBe(row.storageKey);
    expect(await storage().get(row.storageKey)).toBeNull();

    await removePhoto(me.actor, me.user.id);
    expect(await storage().get(next.storageKey)).toBeNull();
    expect((await getProfile(me.actor, me.user.id)).photoUrl).toBeNull();
  });

  it("refuses files that aren't photos, and photos over 5 MB", async () => {
    const s = await setup("Photo Rules U");
    const me = s.student;
    const text = new TextEncoder().encode("not an image at all");
    await expect(uploadPhoto(me.actor, me.user.id, { bytes: text, type: "image/png", size: text.length })).rejects.toThrow(/isn't a photo/);
    await expect(uploadPhoto(me.actor, me.user.id, { bytes: text, type: "application/pdf", size: text.length })).rejects.toThrow(/JPG, PNG or WebP/);
    await expect(uploadPhoto(me.actor, me.user.id, { bytes: text, type: "image/png", size: 6 * 1024 * 1024 })).rejects.toThrow(/5 MB/);
  });
});

describe("change password", () => {
  it("needs the current password, then signs out every other session but keeps this one", async () => {
    const s = await setup("Change PW U");
    const me = s.student;
    const here = await createSession(me.user.id, "password", client);
    const elsewhere = await createSession(me.user.id, "phone", client);
    await expect(changePassword(me.actor, me.user.id, { current: "not my password", next: "brand new phrase", confirm: "brand new phrase", keepSessionId: here.sessionId })).rejects.toThrow(
      /current password is wrong/,
    );
    const r = await changePassword(me.actor, me.user.id, { current: PW, next: "brand new phrase", confirm: "brand new phrase", keepSessionId: here.sessionId });
    expect(r.sessionsEnded).toBe(1);
    expect(await resolveSession(here.token)).not.toBeNull();
    expect(await resolveSession(elsewhere.token)).toBeNull();
    expect(await signInWithPassword({ email: me.user.email, password: "brand new phrase", ip: "10.3.0.1" })).toMatchObject({ ok: true });
    expect(mailTo(me.user.email).map((m) => m.kind)).toEqual(["security.password_changed"]);
  });

  it("refuses the same password again and weak ones, and pauses after 5 wrong current passwords", async () => {
    const s = await setup("Change PW Rules U");
    const me = s.student;
    const base = { keepSessionId: null };
    await expect(changePassword(me.actor, me.user.id, { ...base, current: PW, next: PW, confirm: PW })).rejects.toThrow(/current password. Choose/);
    await expect(changePassword(me.actor, me.user.id, { ...base, current: PW, next: "12345678", confirm: "12345678" })).rejects.toThrow(/too common/);
    for (let i = 0; i < 4; i++) await changePassword(me.actor, me.user.id, { ...base, current: "guess guess", next: "whatever new", confirm: "whatever new" }).catch(() => undefined);
    await expect(changePassword(me.actor, me.user.id, { ...base, current: "guess guess", next: "whatever new", confirm: "whatever new" })).rejects.toThrow(/Try again in 15 minutes/);
    await expect(changePassword(me.actor, me.user.id, { ...base, current: PW, next: "whatever new", confirm: "whatever new" })).rejects.toThrow(/Try again/);
  });
});

describe("sessions on the profile page", () => {
  it("signing out one session signs that device out; you can't sign out someone else's", async () => {
    const s = await setup("Sessions U");
    const me = s.student;
    const phone = await createSession(me.user.id, "phone", client);
    const laptop = await createSession(me.user.id, "password", client);
    const theirs = await createSession(s.other.user.id, "password", client);
    expect((await mySessions(me.actor, me.user.id)).map((x) => x.id).sort()).toEqual([phone.sessionId, laptop.sessionId].sort());
    await signOutSession(me.actor, me.user.id, phone.sessionId);
    expect(await resolveSession(phone.token)).toBeNull();
    expect(await resolveSession(laptop.token)).not.toBeNull();
    await expect(signOutSession(me.actor, me.user.id, theirs.sessionId)).rejects.toThrow(/not found/);
    expect(await resolveSession(theirs.token)).not.toBeNull();
    const logs = await systemDb().select().from(auditLog).where(eq(auditLog.entityId, phone.sessionId));
    expect(logs[0]).toMatchObject({ action: "session.revoke", actorUserId: me.user.id });
  });

  it("sign out everywhere ends every session", async () => {
    const s = await setup("Everywhere U");
    const me = s.student;
    const a = await createSession(me.user.id, "phone", client);
    const b = await createSession(me.user.id, "password", client);
    expect(await signOutEverywhere(me.actor, me.user.id)).toEqual({ sessionsEnded: 2 });
    expect(await resolveSession(a.token)).toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
  });
});
