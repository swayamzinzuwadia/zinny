import "server-only";
/**
 * identity's auth service: everything that happens before someone is inside a university
 * (signing in, invitation links, password reset, phone codes).
 *
 * Brief exception: this file and src/server/auth/ may use systemDb(), and the only core
 * data they write is users.password_hash, the sessions table, and the new user, student
 * role and audit entry of a sign-up (signUpStudent). Other university tables
 * (invitations, phone challenges, settings) are still read and written under row-level
 * security with withTenant(systemActorFor(universityId)), so an invitation for one
 * university can never be found, or used, from another.
 */
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { systemDb, type Tx } from "@/db/client";
import { roleAssignments, sessions, universities, users, type RoleName } from "@/db/schema";
import type { DomainEvent } from "@/contracts/events";
import { audit, sendEmail, sendSms, systemActorFor, universityLite, withTenant } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { auditEverywhere, personActor } from "@/server/auth/audit";
import { AUTH, LIMITS, appUrl, demoEnabled, humanDuration } from "@/server/auth/config";
import { deferAfterResponse, type Defer } from "@/server/auth/defer";
import { checkNewPassword, hashPassword, verifyAgainstNothing, verifyPassword } from "@/server/auth/passwords";
import { maskEmail, maskPhone, normalizePhone, phoneTail } from "@/server/auth/phone";
import { clearThrottle, consume, lockedUntil, pruneThrottles, recordFailure, throttleKey } from "@/server/auth/throttle";
import { pruneSessions, spacesFor } from "@/server/auth/session";
import { compactUuid, expandUuid, hmac, randomToken, sameHex, sha256, sixDigitCode } from "@/server/auth/tokens";
import { passwordChangedEmail, resetEmail, signInCodeSms } from "./emails";
import { ADMIN_PANEL, landingFor, roleTitle } from "./labels";
import { idnInvites, idnOtpChallenges, idnSettings, idnTokens } from "./schema";

const normEmail = (e: string) => e.trim().toLowerCase();
const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const resetUrl = () => `${appUrl()}/reset`;

/* ───────────────────────────── Universities on the sign-in screens ───────────────────────────── */

export type LoginUniversity = { id: string; slug: string; name: string; phoneSignIn: boolean; signupOpen: boolean };

/** Paths that are app routes, not university slugs. */
const RESERVED = new Set(["login", "signup", "invite", "reset", "platform", "api", "verify", "site", "_next", "brand", "favicon.ico"]);

/** The university slug at the start of a `next` path ("/demo/learn" → "demo"), if any. */
export function slugFromNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  const first = next.split(/[/?#]/)[1]?.toLowerCase();
  return first && /^[a-z0-9-]{2,40}$/.test(first) && !RESERVED.has(first) ? first : null;
}

/** The university a sign-in screen is for, by slug. Null for unknown or reserved slugs. */
export async function loginUniversity(slug: string | null | undefined): Promise<LoginUniversity | null> {
  const s = (slug ?? "").toLowerCase();
  if (!s || RESERVED.has(s) || !/^[a-z0-9-]{2,40}$/.test(s)) return null;
  const [u] = await systemDb()
    .select({ id: universities.id, slug: universities.slug, name: universities.name, status: universities.status })
    .from(universities)
    .where(eq(universities.slug, s));
  if (!u) return null;
  const [settings] = await withTenant(systemActorFor(u.id), (tx) =>
    tx.select({ phoneSignIn: idnSettings.phoneSignIn, selfSignup: idnSettings.selfSignup }).from(idnSettings).where(eq(idnSettings.universityId, u.id)),
  );
  return {
    id: u.id,
    slug: u.slug,
    name: u.name,
    phoneSignIn: settings?.phoneSignIn ?? false,
    signupOpen: u.status === "active" && (settings?.selfSignup ?? true),
  };
}

export async function phoneSignInEnabled(universityId: string): Promise<boolean> {
  const [s] = await withTenant(systemActorFor(universityId), (tx) =>
    tx.select({ on: idnSettings.phoneSignIn }).from(idnSettings).where(eq(idnSettings.universityId, universityId)),
  );
  return s?.on ?? false;
}

/**
 * A path on this site to go to after signing in, or null. Refuses "//host" and "/\host"
 * (browsers treat both as another site) and anything that isn't a path.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(next) || next.length > 500) return null;
  // "/demo" alone has no page: the space picker at "/" sends people to the right app.
  if (/^\/[a-z0-9-]+\/?$/i.test(next.split(/[?#]/)[0])) return "/";
  if (/^\/(login|reset|invite)(\/|$|\?)/.test(next)) return "/";
  return next;
}

/**
 * Where to go after signing in: `next` when it's a real page; otherwise straight to the
 * person's app when they belong to one institute (or to the one `next` names), so the
 * browser doesn't bounce through the space picker. Zinny team members go to the picker.
 */
export async function landingAfterSignIn(userId: string, next: string | null | undefined): Promise<string> {
  const safe = safeNext(next) ?? "/";
  if (safe !== "/") return safe;
  if (await activePlatformRole(userId, new Date())) return "/";
  const spaces = await spacesFor(userId);
  const wanted = slugFromNext(next);
  const space = spaces.find((s) => s.slug === wanted) ?? (spaces.length === 1 ? spaces[0] : null);
  if (!space) return "/";
  return `/${space.slug}/${space.roles.some((r) => ADMIN_PANEL.has(r as RoleName)) ? "admin" : "learn"}`;
}

/* ───────────────────────────── Student sign-up ───────────────────────────── */

export type SignUpResult = { status: "created"; userId: string; landing: string } | { status: "network_limited"; retryAt: Date };

/**
 * Creates a student account at one institute, for /signup. It only ever creates a new
 * person: an email already in Zinny is refused, so nobody can take over an account or a
 * pending invitation by signing up with its address. The caller starts the session.
 * The answer does show that an email is taken, so attempts are capped per network.
 */
export async function signUpStudent(input: {
  slug: string;
  name: string;
  email: string;
  password: string;
  confirm: string;
  ip: string | null;
  now?: Date;
}): Promise<SignUpResult> {
  const now = input.now ?? new Date();
  const university = await loginUniversity(input.slug);
  if (!university) throw new ValidationError("We can't find that institute. Check the code and try again.", "unknown_institute");
  if (!university.signupOpen) throw new ValidationError(`${university.name} isn't taking new students here. Please contact the institute.`, "signup_closed");

  const name = input.name.trim().replace(/\s+/g, " ");
  const email = normEmail(input.email);
  if (name.length < 2 || name.length > 100) throw new ValidationError("Enter your full name.");
  if (!emailLike.test(email)) throw new ValidationError("Enter a valid email address, like name@example.com.");
  checkNewPassword(input.password, { email, name, confirm: input.confirm });

  const byIp = await consume(throttleKey("signup-ip", input.ip ?? "unknown"), LIMITS.signupPerIp, now);
  if (!byIp.ok) return { status: "network_limited", retryAt: byIp.retryAt };

  const passwordHash = await hashPassword(input.password);
  // The owner connection: the app role can't insert users, and zinny_upsert_user would reuse an existing one.
  return systemDb().transaction(async (tx) => {
    // The unique index on the email settles two sign-ups racing for the same address.
    const [created] = await tx.insert(users).values({ email, name, passwordHash }).onConflictDoNothing().returning({ id: users.id });
    if (!created) throw new ValidationError("This email already has a Zinny account. Sign in, or reset your password if you've forgotten it.", "email_taken");
    await tx.insert(roleAssignments).values({
      userId: created.id,
      role: "student",
      scopeType: "university",
      universityId: university.id,
      createdBy: created.id,
    });
    await audit(tx, personActor(university.id, created.id), "user.self_signup", "user", created.id, { role: "student" });
    return { status: "created" as const, userId: created.id, landing: landingFor(university.slug, "student") };
  });
}

/* ───────────────────────────── Password sign-in ───────────────────────────── */

export type SignInResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "wrong"; remaining: number }
  | { ok: false; reason: "locked"; until: Date }
  | { ok: false; reason: "network_locked"; until: Date };

/**
 * Checks an email and password. Wrong passwords are counted per email (whether or not
 * the account exists, so the answer never reveals who has one) and per network; too many
 * lock sign-in for a while. A locked email is refused even with the right password.
 * Unknown emails take as long as wrong passwords.
 */
export async function signInWithPassword(input: { email: string; password: string; ip: string | null; now?: Date }): Promise<SignInResult> {
  const now = input.now ?? new Date();
  const email = normEmail(input.email);
  if (!email) throw new ValidationError("Enter the email address you sign in with.");
  if (!input.password) throw new ValidationError("Enter your password.");
  const emailKey = throttleKey("signin-email", email);
  const ipKey = throttleKey("signin-ip", input.ip ?? "unknown");

  const ipLock = await lockedUntil(ipKey, now);
  if (ipLock) return { ok: false, reason: "network_locked", until: ipLock };
  const emailLock = await lockedUntil(emailKey, now);
  if (emailLock) return { ok: false, reason: "locked", until: emailLock };

  const [user] = await systemDb()
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`);
  const ok = user?.passwordHash ? await verifyPassword(input.password, user.passwordHash) : await verifyAgainstNothing(input.password);

  if (!ok) {
    const byEmail = await recordFailure(emailKey, LIMITS.passwordPerEmail, now);
    const byIp = await recordFailure(ipKey, LIMITS.passwordPerIp, now);
    if (byEmail.lockedUntil) {
      if (user) await auditEverywhere(user.id, "auth.locked", { until: byEmail.lockedUntil.toISOString(), by: "password" });
      return { ok: false, reason: "locked", until: byEmail.lockedUntil };
    }
    if (byIp.lockedUntil) return { ok: false, reason: "network_locked", until: byIp.lockedUntil };
    return { ok: false, reason: "wrong", remaining: byEmail.remaining };
  }

  await clearThrottle(emailKey);
  // Older, cheaper hashes are upgraded the moment the password is known.
  if (bcrypt.getRounds(user!.passwordHash!) < (process.env.NODE_ENV === "production" ? 12 : 10)) {
    await systemDb().update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, user!.id));
  }
  return { ok: true, userId: user!.id };
}

/** The message a sign-in screen shows for a failed attempt. */
export function signInMessage(r: Exclude<SignInResult, { ok: true }>, now = new Date()): string {
  if (r.reason === "locked") {
    return `Too many wrong passwords for this email. For your security, signing in with it is paused for ${humanDuration(r.until.getTime() - now.getTime())}. Reset your password to get back in now.`;
  }
  if (r.reason === "network_locked") {
    return `Too many sign-in attempts from your network. Try again in ${humanDuration(r.until.getTime() - now.getTime())}.`;
  }
  const left = r.remaining;
  if (left <= 2) {
    return `Email or password is wrong. ${left === 1 ? "One more wrong try pauses" : `${left} more wrong tries pause`} signing in with this email for ${humanDuration(LIMITS.passwordPerEmail.lockMs)}.`;
  }
  return "Email or password is wrong. Check both and try again.";
}

/* ───────────────────────────── Demo accounts ───────────────────────────── */

/** One-click demo accounts on /login (development, or production with ZINNY_DEMO=1). */
export const DEMO_ACCOUNTS = [
  ["Zinny team", "zara@zinny.demo", "Super Admin"],
  ["Zinny team", "sid@zinny.demo", "Support Agent"],
  ["Administration", "asha@demo.edu", "Institute Admin"],
  ["Administration", "bharat@demo.edu", "Board / Owner"],
  ["Administration", "arun@demo.edu", "Accounts & Fees"],
  ["Teaching", "hema@demo.edu", "HOD, Computer Science"],
  ["Teaching", "farah@demo.edu", "Permanent Faculty"],
  ["Teaching", "vikram@demo.edu", "Visiting Faculty"],
  ["Students", "riya@demo.edu", "Student (PRD example week)"],
  ["Students", "kabir@demo.edu", "Student (switch pending)"],
  ["Parents", "pallavi@demo.edu", "Parent of Riya"],
] as const;

/** Only the listed demo accounts, and only when demo mode is on. */
export async function demoSignIn(email: string): Promise<string> {
  if (!demoEnabled()) throw new ForbiddenError("Demo accounts are turned off.");
  const e = normEmail(email);
  if (!DEMO_ACCOUNTS.some(([, x]) => x === e)) throw new ForbiddenError("That isn't a demo account.");
  const [u] = await systemDb().select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${e}`);
  if (!u) throw new NotFoundError("Demo account");
  return u.id;
}

/* ───────────────────────────── Password reset ───────────────────────────── */

export type ResetRequest = { status: "sent" } | { status: "network_limited"; retryAt: Date };

/**
 * Starts a password reset. The answer is the same whether or not the account exists:
 * finding the person, creating the link and sending the email all happen after the
 * response (`defer`), so neither the words nor the response time give anything away.
 * Emails to one address are capped per hour (silently: the screen still says "sent").
 */
export async function requestPasswordReset(input: { email: string; ip: string | null; now?: Date; defer?: Defer }): Promise<ResetRequest> {
  const now = input.now ?? new Date();
  const email = normEmail(input.email);
  if (!emailLike.test(email)) throw new ValidationError("Enter the email address you sign in with, like name@institute.edu.");
  const byIp = await consume(throttleKey("reset-ip", input.ip ?? "unknown"), LIMITS.resetPerIp, now);
  if (!byIp.ok) return { status: "network_limited", retryAt: byIp.retryAt };
  (input.defer ?? deferAfterResponse)(() => issueResetLink(email, now));
  return { status: "sent" };
}

async function issueResetLink(email: string, now: Date) {
  const perEmail = await consume(throttleKey("reset-email", email), LIMITS.resetPerEmail, now);
  if (!perEmail.ok) return;
  const [user] = await systemDb()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`);
  if (!user) return;
  const token = randomToken();
  await systemDb().insert(idnTokens).values({
    purpose: "reset",
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + AUTH.reset.validMs),
    createdAt: now,
  });
  const mail = resetEmail({ name: user.name, url: `${appUrl()}/reset/${token}`, validMinutes: AUTH.reset.validMs / 60_000 });
  await sendEmail({ to: user.email, ...mail, kind: "security.reset" });
}

export type ResetLink =
  | { state: "valid"; name: string; email: string; expiresAt: Date }
  | { state: "expired" | "used" | "invalid" };

/** What /reset/[token] shows. Looks up only the hash; never changes anything. */
export async function inspectResetToken(token: string, now = new Date()): Promise<ResetLink> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { state: "invalid" };
  const [row] = await systemDb()
    .select({ usedAt: idnTokens.usedAt, revokedAt: idnTokens.revokedAt, expiresAt: idnTokens.expiresAt, name: users.name, email: users.email })
    .from(idnTokens)
    .innerJoin(users, eq(users.id, idnTokens.userId))
    .where(and(eq(idnTokens.tokenHash, sha256(token)), eq(idnTokens.purpose, "reset")));
  if (!row) return { state: "invalid" };
  if (row.usedAt || row.revokedAt) return { state: "used" };
  if (row.expiresAt <= now) return { state: "expired" };
  return { state: "valid", name: row.name, email: maskEmail(row.email), expiresAt: row.expiresAt };
}

/**
 * Sets a new password from a reset link. The link works once; every reset link the
 * person has is cancelled, every session they have is ended (the caller then signs this
 * browser in), and a lock from wrong passwords is lifted, since the link proves who they are.
 */
export async function completePasswordReset(input: { token: string; password: string; confirm: string; now?: Date }): Promise<{ userId: string }> {
  const now = input.now ?? new Date();
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) throw new ValidationError("This link isn't valid. Ask for a new one.", "invalid_link");
  const result = await systemDb().transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(idnTokens)
      .where(and(eq(idnTokens.tokenHash, sha256(input.token)), eq(idnTokens.purpose, "reset")))
      .for("update");
    if (!t) throw new ValidationError("This link isn't valid. Ask for a new one.", "invalid_link");
    if (t.usedAt || t.revokedAt) throw new ValidationError("This link was already used. Ask for a new one.", "used_link");
    if (t.expiresAt <= now) throw new ValidationError("This link has expired. Ask for a new one.", "expired_link");
    const [u] = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, t.userId));
    if (!u) throw new ValidationError("This link isn't valid. Ask for a new one.", "invalid_link");
    checkNewPassword(input.password, { email: u.email, name: u.name, confirm: input.confirm });
    await tx.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, u.id));
    await tx.update(idnTokens).set({ usedAt: now }).where(eq(idnTokens.id, t.id));
    await tx
      .update(idnTokens)
      .set({ revokedAt: now })
      .where(and(eq(idnTokens.userId, u.id), eq(idnTokens.purpose, "reset"), isNull(idnTokens.usedAt), isNull(idnTokens.revokedAt)));
    const ended = await tx.delete(sessions).where(eq(sessions.userId, u.id)).returning({ id: sessions.id });
    return { user: u, ended: ended.length };
  });
  await clearThrottle(throttleKey("signin-email", result.user.email));
  await auditEverywhere(result.user.id, "password.reset", { sessionsEnded: result.ended });
  await notifyPasswordChanged(result.user, "reset", now);
  return { userId: result.user.id };
}

/** For the profile page's password change: the stored hash and who it belongs to. */
export async function passwordRecord(userId: string) {
  const [u] = await systemDb()
    .select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  return u ?? null;
}

/** Writes users.password_hash (the brief's exception). */
export async function storePassword(userId: string, password: string) {
  await systemDb().update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
}

export async function notifyPasswordChanged(u: { name: string; email: string }, how: "reset" | "profile", now = new Date()) {
  try {
    await sendEmail({ to: u.email, ...passwordChangedEmail({ name: u.name, when: now, how, resetUrl: resetUrl() }), kind: "security.password_changed" });
  } catch (e) {
    console.error("[identity] couldn't send the password-changed email:", e);
  }
}

/* ───────────────────────────── Invitation links ───────────────────────────── */

/**
 * University invitation tokens are "<university id, 22 chars>.<secret>": the first part
 * says which university to look in (under its row-level security), and the hash covers
 * the whole token, so changing the university part can only make it invalid.
 * Zinny team invitations (no university) are "team.<secret>".
 */
export function makeInviteToken(universityId: string | null): string {
  return `${universityId ? compactUuid(universityId) : "team"}.${randomToken()}`;
}

function parseInviteToken(token: string): { universityId: string | null } | null {
  const m = /^([A-Za-z0-9_-]{22}|team)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  if (m[1] === "team") return { universityId: null };
  const universityId = expandUuid(m[1]);
  return universityId ? { universityId } : null;
}

export type InviteLink =
  | {
      state: "valid";
      institute: string;
      slug: string | null;
      userId: string;
      name: string;
      email: string;
      roleLabel: string;
      expiresAt: Date;
    }
  | { state: "expired" | "revoked" | "replaced" | "no_access"; institute: string }
  | { state: "accepted" | "has_password"; institute: string; email: string }
  | { state: "invalid" };

const ZINNY_TEAM = "the Zinny team";

/** Active university roles of a person, under the tenant transaction. */
async function activeRoleInTenant(tx: Tx, userId: string, now: Date) {
  const [r] = await tx
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        sql`${roleAssignments.universityId} = zinny_current_university()`,
        isNull(roleAssignments.revokedAt),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
      ),
    )
    .limit(1);
  return !!r;
}

/** What /invite/[token] shows. Never changes anything. */
export async function inspectInvite(token: string, now = new Date()): Promise<InviteLink> {
  const parsed = parseInviteToken(token);
  if (!parsed) return { state: "invalid" };
  if (!parsed.universityId) return inspectTeamInvite(token, now);

  const uniId = parsed.universityId;
  const [exists] = await systemDb().select({ id: universities.id }).from(universities).where(eq(universities.id, uniId));
  if (!exists) return { state: "invalid" };
  return withTenant(systemActorFor(uniId), async (tx) => {
    const [row] = await tx
      .select({ invite: idnInvites, name: users.name, email: users.email, passwordHash: users.passwordHash })
      .from(idnInvites)
      .innerJoin(users, eq(users.id, idnInvites.userId))
      .where(eq(idnInvites.tokenHash, sha256(token)));
    if (!row) return { state: "invalid" } as const;
    const uni = await universityLite(tx);
    const institute = uni.name;
    if (row.invite.acceptedAt) return { state: "accepted", institute, email: row.email } as const;
    if (row.invite.revokedAt) return { state: row.invite.revokeReason === "replaced" ? "replaced" : "revoked", institute } as const;
    if (row.passwordHash) return { state: "has_password", institute, email: row.email } as const;
    if (row.invite.expiresAt <= now) return { state: "expired", institute } as const;
    if (!(await activeRoleInTenant(tx, row.invite.userId, now))) return { state: "no_access", institute } as const;
    return {
      state: "valid",
      institute,
      slug: uni.slug,
      userId: row.invite.userId,
      name: row.name,
      email: row.email,
      roleLabel: roleTitle(row.invite.role),
      expiresAt: row.invite.expiresAt,
    } as const;
  });
}

async function inspectTeamInvite(token: string, now: Date): Promise<InviteLink> {
  const [row] = await systemDb()
    .select({ t: idnTokens, name: users.name, email: users.email, passwordHash: users.passwordHash })
    .from(idnTokens)
    .innerJoin(users, eq(users.id, idnTokens.userId))
    .where(and(eq(idnTokens.tokenHash, sha256(token)), eq(idnTokens.purpose, "team_invite")));
  if (!row) return { state: "invalid" };
  const institute = ZINNY_TEAM;
  if (row.t.usedAt) return { state: "accepted", institute, email: row.email };
  if (row.t.revokedAt) return { state: "replaced", institute };
  if (row.passwordHash) return { state: "has_password", institute, email: row.email };
  if (row.t.expiresAt <= now) return { state: "expired", institute };
  if (!(await activePlatformRole(row.t.userId, now))) return { state: "no_access", institute };
  return {
    state: "valid",
    institute,
    slug: null,
    userId: row.t.userId,
    name: row.name,
    email: row.email,
    roleLabel: row.t.role ? roleTitle(row.t.role) : "Zinny team",
    expiresAt: row.t.expiresAt,
  };
}

async function activePlatformRole(userId: string, now: Date) {
  const [r] = await systemDb()
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.scopeType, "platform"),
        isNull(roleAssignments.revokedAt),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
      ),
    )
    .limit(1);
  return !!r;
}

const INVITE_ERRORS: Record<Exclude<InviteLink["state"], "valid">, [string, string]> = {
  invalid: ["This invitation link isn't valid. Check you copied the whole link from the email.", "invalid_link"],
  expired: ["This invitation has expired. Ask your institute to send a new one.", "expired_link"],
  revoked: ["This invitation was cancelled by your institute.", "revoked_link"],
  replaced: ["A newer invitation was sent to you. Use the link in the latest email.", "replaced_link"],
  no_access: ["You no longer have a role at this institute, so this invitation can't be used.", "no_access"],
  accepted: ["You've already used this invitation. Sign in with your email and password.", "used_link"],
  has_password: ["Your account already has a password. Sign in with it, or reset it if you've forgotten it.", "has_password"],
};

/**
 * Accepts an invitation: sets the person's first password and marks the link used.
 * Returns where to send them; the caller starts the session.
 */
export async function acceptInvite(input: { token: string; password: string; confirm: string; now?: Date }): Promise<{ userId: string; landing: string }> {
  const now = input.now ?? new Date();
  const parsed = parseInviteToken(input.token);
  const fail = (state: Exclude<InviteLink["state"], "valid">) => new ValidationError(...INVITE_ERRORS[state]);
  if (!parsed) throw fail("invalid");
  if (!parsed.universityId) return acceptTeamInvite(input.token, input, now);

  const uniId = parsed.universityId;
  const [exists] = await systemDb().select({ id: universities.id }).from(universities).where(eq(universities.id, uniId));
  if (!exists) throw fail("invalid");
  return withTenant(systemActorFor(uniId), async (tx) => {
    const [invite] = await tx.select().from(idnInvites).where(eq(idnInvites.tokenHash, sha256(input.token))).for("update");
    if (!invite) throw fail("invalid");
    const [u] = await tx
      .select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, invite.userId))
      .for("update");
    if (!u) throw fail("invalid");
    if (invite.acceptedAt) throw fail("accepted");
    if (invite.revokedAt) throw fail(invite.revokeReason === "replaced" ? "replaced" : "revoked");
    if (u.passwordHash) throw fail("has_password");
    if (invite.expiresAt <= now) throw fail("expired");
    if (!(await activeRoleInTenant(tx, u.id, now))) throw fail("no_access");
    checkNewPassword(input.password, { email: u.email, name: u.name, confirm: input.confirm });

    await tx.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, u.id));
    await tx.update(idnInvites).set({ acceptedAt: now }).where(eq(idnInvites.id, invite.id));
    const uni = await universityLite(tx);
    await audit(tx, personActor(uniId, u.id), "invite.accept", "idn_invite", invite.id, { role: invite.role });
    return { userId: u.id, landing: landingFor(uni.slug, invite.role) };
  });
}

async function acceptTeamInvite(token: string, input: { password: string; confirm: string }, now: Date) {
  const fail = (state: Exclude<InviteLink["state"], "valid">) => new ValidationError(...INVITE_ERRORS[state]);
  return systemDb().transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(idnTokens)
      .where(and(eq(idnTokens.tokenHash, sha256(token)), eq(idnTokens.purpose, "team_invite")))
      .for("update");
    if (!t) throw fail("invalid");
    const [u] = await tx
      .select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, t.userId))
      .for("update");
    if (!u) throw fail("invalid");
    if (t.usedAt) throw fail("accepted");
    if (t.revokedAt) throw fail("replaced");
    if (u.passwordHash) throw fail("has_password");
    if (t.expiresAt <= now) throw fail("expired");
    if (!(await activePlatformRole(u.id, now))) throw fail("no_access");
    checkNewPassword(input.password, { email: u.email, name: u.name, confirm: input.confirm });
    await tx.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, u.id));
    await tx.update(idnTokens).set({ usedAt: now }).where(eq(idnTokens.id, t.id));
    return { userId: u.id, landing: "/platform" };
  });
}

/**
 * Handler work for a Zinny team member's user.invited (no university). `tx` is the
 * system transaction the event runner gives platform events. Idempotent per event.
 */
export async function sendTeamInvite(tx: Tx, event: DomainEvent<"user.invited">, now = new Date()) {
  const [done] = await tx.select({ id: idnTokens.id }).from(idnTokens).where(eq(idnTokens.eventId, event.id));
  if (done) return;
  const [u] = await tx.select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.id, event.payload.userId));
  if (!u || u.passwordHash) return;
  await tx
    .update(idnTokens)
    .set({ revokedAt: now })
    .where(and(eq(idnTokens.userId, u.id), eq(idnTokens.purpose, "team_invite"), isNull(idnTokens.usedAt), isNull(idnTokens.revokedAt)));
  const token = makeInviteToken(null);
  await tx.insert(idnTokens).values({
    purpose: "team_invite",
    userId: u.id,
    tokenHash: sha256(token),
    eventId: event.id,
    role: event.payload.role,
    expiresAt: new Date(now.getTime() + AUTH.invite.validMs),
    createdAt: now,
  });
  const { inviteEmail } = await import("./emails");
  const mail = inviteEmail({
    name: u.name,
    institute: "the Zinny team",
    roleLabel: roleTitle(event.payload.role),
    url: `${appUrl()}/invite/${token}`,
    expiresAt: new Date(now.getTime() + AUTH.invite.validMs),
    timeZone: "Asia/Kolkata",
  });
  await sendEmail({ to: u.email, ...mail, subject: "Join the Zinny team", kind: "identity.invite" });
}

/* ───────────────────────────── Phone sign-in ───────────────────────────── */

/**
 * The browser keeps "<university>.<challenge>.<secret>" in an httpOnly cookie while a
 * phone sign-in is in progress. Only the secret's hash is stored.
 */
type Ref = { universityId: string; challengeId: string; nonce: string };

function parseRef(ref: string | null | undefined): Ref | null {
  const m = ref ? /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(ref) : null;
  if (!m) return null;
  const universityId = expandUuid(m[1]);
  const challengeId = expandUuid(m[2]);
  return universityId && challengeId ? { universityId, challengeId, nonce: m[3] } : null;
}

export type PhoneAccount = { id: string; name: string; email: string };

/** Active members of the current university whose mobile number is `e164`. */
async function membersByPhone(tx: Tx, e164: string, now: Date): Promise<PhoneAccount[]> {
  const rows = await tx
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
    .from(users)
    .where(
      and(
        sql`right(regexp_replace(coalesce(${users.phone}, ''), '\\D', '', 'g'), 10) = ${phoneTail(e164)}`,
        sql`exists (
          select 1 from ${roleAssignments} ra
          where ra.user_id = ${users.id} and ra.university_id = zinny_current_university()
            and ra.revoked_at is null
            and (ra.ends_at is null or ra.ends_at > ${now.toISOString()}::timestamptz))`,
      ),
    )
    .orderBy(users.name);
  return rows.filter((r) => normalizePhone(r.phone) === e164).map(({ id, name, email }) => ({ id, name, email }));
}

const phoneLockKey = (e164: string) => throttleKey("otp-verify", e164);

function lockedMessage(until: Date, now: Date) {
  return `Too many wrong codes for this number. For your security, phone sign-in is paused for ${humanDuration(until.getTime() - now.getTime())}. You can still sign in with your email and password.`;
}

async function assertSendAllowed(e164: string, ip: string | null, now: Date) {
  const lock = await lockedUntil(phoneLockKey(e164), now);
  if (lock) throw new ValidationError(lockedMessage(lock, now), "locked");
  const byPhone = await consume(throttleKey("otp-send", e164), LIMITS.codeSendsPerPhone, now);
  if (!byPhone.ok) {
    throw new ValidationError(
      `We've sent this number several codes already. Try again in ${humanDuration(byPhone.retryAt.getTime() - now.getTime())}, or sign in with your email.`,
      "rate_limited",
    );
  }
  const byIp = await consume(throttleKey("otp-send-ip", ip ?? "unknown"), LIMITS.codeSendsPerIp, now);
  if (!byIp.ok) throw new ValidationError(`Too many codes were asked for from your network. Try again in ${humanDuration(byIp.retryAt.getTime() - now.getTime())}.`, "rate_limited");
}

export type PhoneStart = { ref: string; masked: string; resendAt: Date; expiresAt: Date };

/**
 * Sends a 6-digit code to a mobile number. A challenge is created whether or not the
 * number belongs to anyone (no SMS goes out then), and the SMS is sent after the
 * response, so the screen and its timing never reveal who is a member.
 */
export async function startPhoneSignIn(input: { universityId: string; phone: string; ip: string | null; now?: Date; defer?: Defer }): Promise<PhoneStart> {
  const now = input.now ?? new Date();
  if (!(await phoneSignInEnabled(input.universityId))) {
    throw new ValidationError("Signing in with a mobile number isn't turned on for this institute. Use your email and password.", "disabled");
  }
  const e164 = normalizePhone(input.phone);
  if (!e164) throw new ValidationError("Enter a 10-digit mobile number, like 98200 11001.", "invalid_phone");
  await assertSendAllowed(e164, input.ip, now);

  const id = randomUUID();
  const nonce = randomToken();
  const code = sixDigitCode();
  const expiresAt = new Date(now.getTime() + AUTH.otp.validMs);
  const { matches, institute } = await withTenant(systemActorFor(input.universityId), async (tx) => {
    await tx.insert(idnOtpChallenges).values({
      id,
      universityId: input.universityId,
      purpose: "sign_in",
      phone: e164,
      codeHash: hmac(code, id),
      nonceHash: sha256(nonce),
      sentAt: now,
      expiresAt,
      createdAt: now,
    });
    return { matches: await membersByPhone(tx, e164, now), institute: (await universityLite(tx)).name };
  });
  if (matches.length > 0) {
    (input.defer ?? deferAfterResponse)(async () => {
      await sendSms({ to: e164, text: signInCodeSms({ code, institute, validMinutes: AUTH.otp.validMs / 60_000 }), kind: "security.otp", universityId: input.universityId });
    });
  }
  return {
    ref: `${compactUuid(input.universityId)}.${compactUuid(id)}.${nonce}`,
    masked: maskPhone(e164),
    resendAt: new Date(now.getTime() + AUTH.otp.resendAfterMs),
    expiresAt,
  };
}

type Challenge = typeof idnOtpChallenges.$inferSelect;

async function loadChallenge(tx: Tx, r: Ref, lock: boolean): Promise<Challenge | null> {
  const q = tx.select().from(idnOtpChallenges).where(and(eq(idnOtpChallenges.id, r.challengeId), eq(idnOtpChallenges.purpose, "sign_in")));
  const [c] = lock ? await q.for("update") : await q;
  if (!c || !sameHex(c.nonceHash, sha256(r.nonce))) return null;
  return c;
}

const stale = (c: Challenge, now: Date) => !!c.consumedAt || c.createdAt.getTime() + AUTH.otp.challengeMs <= now.getTime();

export type PhoneView = { universityId: string } & (
  | { step: "code"; masked: string; resendAt: Date; expiresAt: Date; attemptsLeft: number; sendsLeft: number }
  | { step: "choose"; masked: string; accounts: { id: string; name: string; email: string }[] }
);

/** What the phone tab shows for a sign-in in progress, or null to start again. */
export async function phoneSignInView(ref: string | null | undefined, now = new Date()): Promise<PhoneView | null> {
  const r = parseRef(ref);
  if (!r) return null;
  return withTenant(systemActorFor(r.universityId), async (tx) => {
    const c = await loadChallenge(tx, r, false);
    if (!c || stale(c, now)) return null;
    if (c.verifiedAt) {
      const accounts = (await membersByPhone(tx, c.phone, now)).map((a) => ({ ...a, email: maskEmail(a.email) }));
      return { universityId: r.universityId, step: "choose", masked: maskPhone(c.phone), accounts };
    }
    return {
      universityId: r.universityId,
      step: "code",
      masked: maskPhone(c.phone),
      resendAt: new Date(c.sentAt.getTime() + AUTH.otp.resendAfterMs),
      expiresAt: c.expiresAt,
      attemptsLeft: Math.max(0, AUTH.otp.maxAttempts - c.attempts),
      sendsLeft: Math.max(0, AUTH.otp.maxSendsPerChallenge - c.sends),
    };
  });
}

export type PhoneVerify = { status: "signed_in"; userId: string } | { status: "choose" };

/**
 * Checks a code. Each code allows AUTH.otp.maxAttempts tries and lasts AUTH.otp.validMs;
 * wrong codes also count against the number (LIMITS.codePerPhone), which pauses phone
 * sign-in for it. With the right code: one account signs in; several (a family sharing
 * a phone) are offered to choose from.
 */
export async function verifyPhoneCode(input: { ref: string | null | undefined; code: string; now?: Date }): Promise<PhoneVerify> {
  const now = input.now ?? new Date();
  const r = parseRef(input.ref);
  const restart = () => new ValidationError("This sign-in has timed out. Enter your mobile number again to get a new code.", "restart");
  if (!r) throw restart();
  const code = input.code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) throw new ValidationError("Enter the 6-digit code from the SMS.", "invalid_code");

  type Outcome =
    | { kind: "restart" | "expired" | "exhausted" }
    | { kind: "locked"; until: Date }
    | { kind: "wrong"; phone: string; left: number }
    | { kind: "no_account" }
    | { kind: "ok"; phone: string; matches: PhoneAccount[] };
  const outcome: Outcome = await withTenant(systemActorFor(r.universityId), async (tx): Promise<Outcome> => {
    const c = await loadChallenge(tx, r, true);
    if (!c || stale(c, now)) return { kind: "restart" };
    if (c.verifiedAt) return { kind: "ok", phone: c.phone, matches: await membersByPhone(tx, c.phone, now) };
    const lock = await lockedUntil(phoneLockKey(c.phone), now);
    if (lock) return { kind: "locked", until: lock };
    if (c.expiresAt <= now) return { kind: "expired" };
    if (c.attempts >= AUTH.otp.maxAttempts) return { kind: "exhausted" };
    const attempts = c.attempts + 1;
    await tx.update(idnOtpChallenges).set({ attempts }).where(eq(idnOtpChallenges.id, c.id));
    if (!sameHex(hmac(code, c.id), c.codeHash)) return { kind: "wrong", phone: c.phone, left: AUTH.otp.maxAttempts - attempts };
    const matches = await membersByPhone(tx, c.phone, now);
    if (matches.length === 0) return { kind: "no_account" };
    if (matches.length === 1) await tx.update(idnOtpChallenges).set({ consumedAt: now }).where(eq(idnOtpChallenges.id, c.id));
    else await tx.update(idnOtpChallenges).set({ verifiedAt: now }).where(eq(idnOtpChallenges.id, c.id));
    return { kind: "ok", phone: c.phone, matches };
  });

  switch (outcome.kind) {
    case "restart":
      throw restart();
    case "locked":
      throw new ValidationError(lockedMessage(outcome.until, now), "locked");
    case "expired":
      throw new ValidationError("This code has expired. Ask for a new code.", "code_expired");
    case "exhausted":
      throw new ValidationError("Too many wrong tries for this code. Ask for a new code.", "too_many_attempts");
    case "no_account":
      throw new ValidationError("There's no account with this number at this institute any more. Sign in with your email instead.", "no_account");
    case "wrong": {
      const f = await recordFailure(phoneLockKey(outcome.phone), LIMITS.codePerPhone, now);
      if (f.lockedUntil) throw new ValidationError(lockedMessage(f.lockedUntil, now), "locked");
      if (outcome.left <= 0) throw new ValidationError("That code is wrong, and that was the last try for it. Ask for a new code.", "too_many_attempts");
      throw new ValidationError(`That code is wrong. You have ${outcome.left} ${outcome.left === 1 ? "try" : "tries"} left.`, "wrong_code");
    }
    case "ok":
      await clearThrottle(phoneLockKey(outcome.phone));
      return outcome.matches.length === 1 ? { status: "signed_in", userId: outcome.matches[0].id } : { status: "choose" };
  }
}

/** After the right code, when several accounts share the number: sign in as one of them. */
export async function choosePhoneAccount(input: { ref: string | null | undefined; userId: string; now?: Date }): Promise<{ userId: string }> {
  const now = input.now ?? new Date();
  const r = parseRef(input.ref);
  const restart = () => new ValidationError("This sign-in has timed out. Enter your mobile number again to get a new code.", "restart");
  if (!r) throw restart();
  return withTenant(systemActorFor(r.universityId), async (tx) => {
    const c = await loadChallenge(tx, r, true);
    if (!c || stale(c, now) || !c.verifiedAt) throw restart();
    const matches = await membersByPhone(tx, c.phone, now);
    if (!matches.some((m) => m.id === input.userId)) throw new ValidationError("Choose one of the accounts listed.", "invalid_choice");
    await tx.update(idnOtpChallenges).set({ consumedAt: now }).where(eq(idnOtpChallenges.id, c.id));
    return { userId: input.userId };
  });
}

/** A new code for the same sign-in, at most every AUTH.otp.resendAfterMs. */
export async function resendPhoneCode(input: { ref: string | null | undefined; ip: string | null; now?: Date; defer?: Defer }): Promise<{ resendAt: Date; expiresAt: Date }> {
  const now = input.now ?? new Date();
  const r = parseRef(input.ref);
  const restart = () => new ValidationError("This sign-in has timed out. Enter your mobile number again to get a new code.", "restart");
  if (!r) throw restart();

  const step = await withTenant(systemActorFor(r.universityId), async (tx) => {
    const c = await loadChallenge(tx, r, true);
    if (!c || stale(c, now) || c.verifiedAt) return { kind: "restart" as const };
    const wait = c.sentAt.getTime() + AUTH.otp.resendAfterMs - now.getTime();
    if (wait > 0) return { kind: "wait" as const, seconds: Math.ceil(wait / 1000) };
    if (c.sends >= AUTH.otp.maxSendsPerChallenge) return { kind: "too_many" as const };
    return { kind: "go" as const, phone: c.phone };
  });
  if (step.kind === "restart") throw restart();
  if (step.kind === "wait") {
    throw new ValidationError(`Wait ${step.seconds} second${step.seconds === 1 ? "" : "s"} before asking for a new code.`, "too_soon");
  }
  if (step.kind === "too_many") throw new ValidationError("That's the most codes we can send for one sign-in. Enter your number again to start over.", "too_many_sends");
  await assertSendAllowed(step.phone, input.ip, now);

  const code = sixDigitCode();
  const expiresAt = new Date(now.getTime() + AUTH.otp.validMs);
  const { matches, institute } = await withTenant(systemActorFor(r.universityId), async (tx) => {
    await tx
      .update(idnOtpChallenges)
      .set({ codeHash: hmac(code, r.challengeId), attempts: 0, sends: sql`${idnOtpChallenges.sends} + 1`, sentAt: now, expiresAt })
      .where(eq(idnOtpChallenges.id, r.challengeId));
    return { matches: await membersByPhone(tx, step.phone, now), institute: (await universityLite(tx)).name };
  });
  if (matches.length > 0) {
    (input.defer ?? deferAfterResponse)(async () => {
      await sendSms({ to: step.phone, text: signInCodeSms({ code, institute, validMinutes: AUTH.otp.validMs / 60_000 }), kind: "security.otp", universityId: r.universityId });
    });
  }
  return { resendAt: new Date(now.getTime() + AUTH.otp.resendAfterMs), expiresAt };
}

/** The phone cookie's lifetime: the whole sign-in, resends included. */
export const PHONE_COOKIE_MS = AUTH.otp.challengeMs;

/* ───────────────────────────── Housekeeping ───────────────────────────── */

/**
 * Deletes what has ended: sessions, throttles, and tokens a week after they expired.
 * Runs from the daily job once a day across all universities (the first university's run
 * claims it), since these tables belong to no university.
 */
export async function pruneGlobal(now = new Date()): Promise<{ sessions: number; throttles: number; tokens: number } | null> {
  const claim = await consume("housekeeping:identity-global", { limit: 1, windowMs: 20 * 3_600_000 }, now);
  if (!claim.ok) return null;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const tokens = await systemDb()
    .delete(idnTokens)
    .where(sql`${idnTokens.expiresAt} < ${weekAgo.toISOString()}::timestamptz`)
    .returning({ id: idnTokens.id });
  return { sessions: await pruneSessions(now), throttles: await pruneThrottles(now), tokens: tokens.length };
}

/* ───────────────────────────── Demo data (seed only) ───────────────────────────── */

/** Seed only: a demo person's mobile number (users.phone, within the brief's exception). */
export async function seedSetPhone(userId: string, phone: string) {
  const e164 = normalizePhone(phone);
  if (!e164) throw new Error(`Not a mobile number: ${phone}`);
  await systemDb().update(users).set({ phone: e164 }).where(eq(users.id, userId));
}

/** Seed only: a person who hasn't accepted their invitation yet has no password. */
export async function seedWithoutPassword(userId: string) {
  await systemDb().update(users).set({ passwordHash: null }).where(eq(users.id, userId));
  await systemDb().delete(sessions).where(eq(sessions.userId, userId));
}

/** Seed only: forget a demo person's earlier sessions, so re-seeding doesn't pile them up. */
export async function seedClearSessions(userId: string) {
  await systemDb().delete(sessions).where(eq(sessions.userId, userId));
}

/** Seed only: a past sign-in on another device, so the sessions list looks lived in. */
export async function seedSession(userId: string, o: { method: "password" | "phone"; ip: string; userAgent: string; createdAt: Date; lastSeenAt: Date }) {
  const { idnSessions } = await import("./schema");
  const expiresAt = new Date(o.lastSeenAt.getTime() + AUTH.session.idleMs);
  await systemDb().transaction(async (tx) => {
    const [s] = await tx.insert(sessions).values({ tokenHash: sha256(randomToken()), userId, expiresAt, createdAt: o.createdAt }).returning({ id: sessions.id });
    await tx.insert(idnSessions).values({ sessionId: s.id, userId, method: o.method, ip: o.ip, userAgent: o.userAgent, lastSeenAt: o.lastSeenAt });
  });
}
