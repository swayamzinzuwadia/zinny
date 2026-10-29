/**
 * The profile page: your own name, mobile number, photo, password and sessions.
 *
 * Every function takes the actor and the person being changed, and checks
 * `self.profile` with ownerUserId = that person, so nobody can change anyone else's
 * profile (an Institute Admin included). Name, phone and photo are written under row-level
 * security (users is updatable by the app role only for people visible in this university).
 * Password changes and sessions use the auth service's exception.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { users } from "@/db/schema";
import { assertCan, audit, sendSms, storage, withTenant, type Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { AUTH, LIMITS, humanDuration } from "@/server/auth/config";
import { deferAfterResponse, type Defer } from "@/server/auth/defer";
import { checkNewPassword, verifyPassword } from "@/server/auth/passwords";
import { maskPhone, normalizePhone } from "@/server/auth/phone";
import { listSessions, revokeAllSessions, revokeSession, type SessionInfo } from "@/server/auth/session";
import { clearThrottle, consume, lockedUntil, recordFailure, throttleKey } from "@/server/auth/throttle";
import { hmac, sameHex, sixDigitCode } from "@/server/auth/tokens";
import { auditEverywhere } from "@/server/auth/audit";
import { notifyPasswordChanged, passwordRecord, storePassword } from "./auth";
import { verifyPhoneSms } from "./emails";
import { idnOtpChallenges, idnPhotos } from "./schema";

const uni = (actor: Actor) => actor.universityId!;

function assertSelf(actor: Actor, userId: string) {
  assertCan(actor, "self.profile", { universityId: uni(actor), ownerUserId: userId });
}

export type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  photoUrl: string | null;
  hasPassword: boolean;
  /** A new number waiting for its code, if any. */
  pendingPhone: { masked: string; resendAt: Date; expiresAt: Date; attemptsLeft: number } | null;
};

export async function getProfile(actor: Actor, userId: string, now = new Date()): Promise<Profile> {
  assertSelf(actor, userId);
  return withTenant(actor, async (tx) => {
    const [u] = await tx
      .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId));
    if (!u) throw new NotFoundError("Profile");
    const [photo] = await tx.select().from(idnPhotos).where(eq(idnPhotos.userId, userId));
    const [pending] = await tx
      .select()
      .from(idnOtpChallenges)
      .where(
        and(
          eq(idnOtpChallenges.userId, userId),
          eq(idnOtpChallenges.purpose, "verify_phone"),
          sql`${idnOtpChallenges.consumedAt} is null`,
          sql`${idnOtpChallenges.expiresAt} > ${now.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(sql`${idnOtpChallenges.createdAt} desc`)
      .limit(1);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: normalizePhone(u.phone) ?? u.phone,
      photoUrl: photo ? await storage().signedUrl(photo.storageKey, 3600) : null,
      hasPassword: !!u.passwordHash,
      pendingPhone:
        pending && pending.attempts < AUTH.otp.maxAttempts
          ? {
              masked: maskPhone(pending.phone),
              resendAt: new Date(pending.sentAt.getTime() + AUTH.otp.resendAfterMs),
              expiresAt: pending.expiresAt,
              attemptsLeft: AUTH.otp.maxAttempts - pending.attempts,
            }
          : null,
    };
  });
}

/** Signed URLs for the photos of these people in the actor's university (missing = initials). */
export async function photoUrls(actor: Actor, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const rows = await withTenant(actor, (tx) => tx.select().from(idnPhotos).where(sql`${idnPhotos.userId} in ${userIds}`));
  for (const r of rows) out.set(r.userId, await storage().signedUrl(r.storageKey, 3600));
  return out;
}

/* ───────────────────────────── Name ───────────────────────────── */

export async function updateName(actor: Actor, userId: string, name: string) {
  assertSelf(actor, userId);
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length < 2) throw new ValidationError("Enter your name as you'd like it shown, at least 2 characters.");
  if (clean.length > 80) throw new ValidationError("That name is too long. Use 80 characters or fewer.");
  if (/[<>{}\u0000-\u001f]/.test(clean)) throw new ValidationError("Use letters, spaces and ordinary punctuation in your name.");
  return withTenant(actor, async (tx) => {
    const [before] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
    if (!before) throw new NotFoundError("Profile");
    if (before.name === clean) return { name: clean };
    await tx.update(users).set({ name: clean }).where(eq(users.id, userId));
    await audit(tx, actor, "profile.update_name", "user", userId, { from: before.name, to: clean });
    return { name: clean };
  });
}

/* ───────────────────────────── Mobile number ───────────────────────────── */

/**
 * Starts changing your mobile number: sends a 6-digit code to the new number. The number
 * is saved only once the code is entered (verifyPhoneChange), so nobody can point phone
 * sign-in at a number they don't hold.
 */
export async function startPhoneChange(actor: Actor, userId: string, input: { phone: string; ip?: string | null; now?: Date; defer?: Defer }) {
  assertSelf(actor, userId);
  const now = input.now ?? new Date();
  const e164 = normalizePhone(input.phone);
  if (!e164) throw new ValidationError("Enter a 10-digit mobile number, like 98200 11001.");
  const lock = await lockedUntil(throttleKey("otp-verify", e164), now);
  if (lock) throw new ValidationError(`Too many wrong codes for this number. Try again in ${humanDuration(lock.getTime() - now.getTime())}.`);
  const byPhone = await consume(throttleKey("otp-send", e164), LIMITS.codeSendsPerPhone, now);
  if (!byPhone.ok) throw new ValidationError(`We've sent this number several codes already. Try again in ${humanDuration(byPhone.retryAt.getTime() - now.getTime())}.`);

  const id = randomUUID();
  const code = sixDigitCode();
  await withTenant(actor, async (tx) => {
    const [u] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, userId));
    if (!u) throw new NotFoundError("Profile");
    if (normalizePhone(u.phone) === e164) throw new ValidationError("That's already your mobile number.");
    const [recent] = await tx
      .select({ sentAt: idnOtpChallenges.sentAt })
      .from(idnOtpChallenges)
      .where(and(eq(idnOtpChallenges.userId, userId), eq(idnOtpChallenges.purpose, "verify_phone"), sql`${idnOtpChallenges.consumedAt} is null`))
      .orderBy(sql`${idnOtpChallenges.sentAt} desc`)
      .limit(1);
    if (recent && now.getTime() - recent.sentAt.getTime() < AUTH.otp.resendAfterMs) {
      const wait = Math.ceil((recent.sentAt.getTime() + AUTH.otp.resendAfterMs - now.getTime()) / 1000);
      throw new ValidationError(`Wait ${wait} seconds before asking for a new code.`);
    }
    // One pending change at a time: older codes stop working.
    await tx
      .update(idnOtpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(idnOtpChallenges.userId, userId), eq(idnOtpChallenges.purpose, "verify_phone"), sql`${idnOtpChallenges.consumedAt} is null`));
    await tx.insert(idnOtpChallenges).values({
      id,
      universityId: uni(actor),
      purpose: "verify_phone",
      userId,
      phone: e164,
      codeHash: hmac(code, id),
      nonceHash: "",
      sentAt: now,
      expiresAt: new Date(now.getTime() + AUTH.otp.validMs),
      createdAt: now,
    });
  });
  (input.defer ?? deferAfterResponse)(async () => {
    await sendSms({ to: e164, text: verifyPhoneSms({ code, validMinutes: AUTH.otp.validMs / 60_000 }), kind: "security.otp", universityId: uni(actor) });
  });
  return { masked: maskPhone(e164) };
}

/** Saves the new number once its code is right. 5 tries per code, 5 minutes. */
export async function verifyPhoneChange(actor: Actor, userId: string, input: { code: string; now?: Date }) {
  assertSelf(actor, userId);
  const now = input.now ?? new Date();
  const code = input.code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) throw new ValidationError("Enter the 6-digit code from the SMS.");
  const result = await withTenant(actor, async (tx) => {
    const [c] = await tx
      .select()
      .from(idnOtpChallenges)
      .where(and(eq(idnOtpChallenges.userId, userId), eq(idnOtpChallenges.purpose, "verify_phone"), sql`${idnOtpChallenges.consumedAt} is null`))
      .orderBy(sql`${idnOtpChallenges.createdAt} desc`)
      .limit(1)
      .for("update");
    if (!c) return { kind: "none" as const };
    if (c.expiresAt <= now) return { kind: "expired" as const };
    if (c.attempts >= AUTH.otp.maxAttempts) return { kind: "exhausted" as const };
    const attempts = c.attempts + 1;
    await tx.update(idnOtpChallenges).set({ attempts }).where(eq(idnOtpChallenges.id, c.id));
    if (!sameHex(hmac(code, c.id), c.codeHash)) return { kind: "wrong" as const, left: AUTH.otp.maxAttempts - attempts, phone: c.phone };
    await tx.update(idnOtpChallenges).set({ consumedAt: now }).where(eq(idnOtpChallenges.id, c.id));
    const [before] = await tx.select({ phone: users.phone }).from(users).where(eq(users.id, userId));
    await tx.update(users).set({ phone: c.phone }).where(eq(users.id, userId));
    await audit(tx, actor, "profile.update_phone", "user", userId, { from: before?.phone ? maskPhone(normalizePhone(before.phone) ?? before.phone) : null, to: maskPhone(c.phone) });
    return { kind: "ok" as const, phone: c.phone };
  });
  switch (result.kind) {
    case "none":
      throw new ValidationError("There's no number waiting to be confirmed. Enter your new number first.");
    case "expired":
      throw new ValidationError("This code has expired. Send a new code.");
    case "exhausted":
      throw new ValidationError("Too many wrong tries for this code. Send a new code.");
    case "wrong":
      await recordFailure(throttleKey("otp-verify", result.phone), LIMITS.codePerPhone, now);
      if (result.left <= 0) throw new ValidationError("That code is wrong, and that was the last try for it. Send a new code.");
      throw new ValidationError(`That code is wrong. You have ${result.left} ${result.left === 1 ? "try" : "tries"} left.`);
    case "ok":
      return { phone: result.phone };
  }
}

/** A new code for the number waiting to be confirmed (after the 30-second wait). */
export async function resendPhoneChange(actor: Actor, userId: string, input: { ip?: string | null; now?: Date; defer?: Defer } = {}) {
  assertSelf(actor, userId);
  const now = input.now ?? new Date();
  const [pending] = await withTenant(actor, (tx) =>
    tx
      .select({ phone: idnOtpChallenges.phone })
      .from(idnOtpChallenges)
      .where(and(eq(idnOtpChallenges.userId, userId), eq(idnOtpChallenges.purpose, "verify_phone"), sql`${idnOtpChallenges.consumedAt} is null`))
      .orderBy(sql`${idnOtpChallenges.createdAt} desc`)
      .limit(1),
  );
  if (!pending) throw new ValidationError("There's no number waiting to be confirmed. Enter your new number first.");
  return startPhoneChange(actor, userId, { phone: pending.phone, ip: input.ip, now, defer: input.defer });
}

export async function cancelPhoneChange(actor: Actor, userId: string, now = new Date()) {
  assertSelf(actor, userId);
  await withTenant(actor, (tx) =>
    tx
      .update(idnOtpChallenges)
      .set({ consumedAt: now })
      .where(and(eq(idnOtpChallenges.userId, userId), eq(idnOtpChallenges.purpose, "verify_phone"), sql`${idnOtpChallenges.consumedAt} is null`)),
  );
}

export async function removePhone(actor: Actor, userId: string) {
  assertSelf(actor, userId);
  await withTenant(actor, async (tx) => {
    await tx.update(users).set({ phone: null }).where(eq(users.id, userId));
    await audit(tx, actor, "profile.remove_phone", "user", userId);
  });
}

/* ───────────────────────────── Photo ───────────────────────────── */

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/**
 * Saves a profile photo: checked to be a real image, rotated upright, cropped square to
 * 512 px and re-encoded as WebP (which also drops location and camera data).
 */
export async function uploadPhoto(actor: Actor, userId: string, file: { bytes: Uint8Array; type: string; size: number }) {
  assertSelf(actor, userId);
  if (!file.size) throw new ValidationError("Choose a photo to upload.");
  if (file.size > PHOTO_MAX_BYTES) throw new ValidationError("That photo is larger than 5 MB. Choose a smaller one.");
  if (file.type && !PHOTO_TYPES.has(file.type)) throw new ValidationError("Use a JPG, PNG or WebP photo.");
  let body: Buffer;
  try {
    body = await sharp(Buffer.from(file.bytes), { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(512, 512, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new ValidationError("That file isn't a photo we can read. Use a JPG, PNG or WebP image.");
  }
  const key = `${uni(actor)}/identity/photos/${userId}/${randomUUID()}.webp`;
  await storage().put({ key, body, contentType: "image/webp" });
  const old = await withTenant(actor, async (tx) => {
    const [prev] = await tx.select().from(idnPhotos).where(eq(idnPhotos.userId, userId));
    await tx
      .insert(idnPhotos)
      .values({ universityId: uni(actor), userId, storageKey: key, updatedAt: new Date() })
      .onConflictDoUpdate({ target: [idnPhotos.universityId, idnPhotos.userId], set: { storageKey: key, updatedAt: new Date() } });
    await audit(tx, actor, "profile.update_photo", "user", userId);
    return prev?.storageKey ?? null;
  });
  if (old && old !== key) await storage().delete(old).catch(() => undefined);
}

export async function removePhoto(actor: Actor, userId: string) {
  assertSelf(actor, userId);
  const old = await withTenant(actor, async (tx) => {
    const [prev] = await tx.delete(idnPhotos).where(eq(idnPhotos.userId, userId)).returning();
    if (prev) await audit(tx, actor, "profile.remove_photo", "user", userId);
    return prev?.storageKey ?? null;
  });
  if (old) await storage().delete(old).catch(() => undefined);
}

/* ───────────────────────────── Password ───────────────────────────── */

/**
 * Changes your password. The current one is required; wrong guesses are counted and
 * pause changes for a while. Every other session is signed out.
 */
export async function changePassword(
  actor: Actor,
  userId: string,
  input: { current: string; next: string; confirm: string; keepSessionId: string | null; now?: Date },
) {
  assertSelf(actor, userId);
  const now = input.now ?? new Date();
  const key = throttleKey("current-password", userId);
  const lock = await lockedUntil(key, now);
  if (lock) throw new ValidationError(`Too many wrong current passwords. Try again in ${humanDuration(lock.getTime() - now.getTime())}, or reset your password from the sign-in page.`);
  const u = await passwordRecord(userId);
  if (!u) throw new NotFoundError("Profile");
  if (!u.passwordHash || !input.current || !(await verifyPassword(input.current, u.passwordHash))) {
    const f = await recordFailure(key, LIMITS.currentPasswordPerUser, now);
    if (f.lockedUntil) throw new ValidationError(`Too many wrong current passwords. Try again in ${humanDuration(f.lockedUntil.getTime() - now.getTime())}, or reset your password from the sign-in page.`);
    throw new ValidationError("Your current password is wrong. Type it again, or reset your password from the sign-in page.");
  }
  checkNewPassword(input.next, { email: u.email, name: u.name, confirm: input.confirm });
  if (await verifyPassword(input.next, u.passwordHash)) throw new ValidationError("That's your current password. Choose a new one.");
  await clearThrottle(key);
  await storePassword(userId, input.next);
  const ended = await revokeAllSessions(userId, { except: input.keepSessionId });
  await withTenant(actor, (tx) => audit(tx, actor, "password.change", "user", userId, { sessionsEnded: ended }));
  await notifyPasswordChanged(u, "profile", now);
  return { sessionsEnded: ended };
}

/* ───────────────────────────── Sessions ───────────────────────────── */

export async function mySessions(actor: Actor, userId: string): Promise<SessionInfo[]> {
  assertSelf(actor, userId);
  return listSessions(userId);
}

/** Signs one of your devices out. Only your own sessions can be ended. */
export async function signOutSession(actor: Actor, userId: string, sessionId: string) {
  assertSelf(actor, userId);
  if (!(await revokeSession(userId, sessionId))) throw new NotFoundError("Session");
  await withTenant(actor, (tx) => audit(tx, actor, "session.revoke", "session", sessionId));
}

/** Signs out every device, this one included. */
export async function signOutEverywhere(actor: Actor, userId: string) {
  assertSelf(actor, userId);
  const ended = await revokeAllSessions(userId);
  await auditEverywhere(userId, "session.revoke_all", { sessionsEnded: ended });
  return { sessionsEnded: ended };
}
