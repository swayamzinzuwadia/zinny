/**
 * identity tables. Prefix: idn_. drizzle.config.ts picks this file up automatically.
 *
 * Two kinds of table:
 *  - University tables (university_id not null): invitations, the university's sign-in
 *    settings, phone sign-in challenges and profile photos. Row-level security applies
 *    automatically, so they are only ever read and written inside withTenant.
 *  - Global tables (no university_id): password-reset and Zinny team invitation tokens,
 *    device details for sessions, and sign-in rate limits. These exist before anyone is
 *    inside a university, so policies.sql keeps them away from the app role; only the
 *    identity auth service reaches them, through the system connection (brief exception).
 *
 * Secrets are never stored: tokens and codes are kept as SHA-256 / HMAC hashes.
 */
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { roleName, sessions, universities, users } from "@/db/schema";

const at = (name: string) => timestamp(name, { withTimezone: true });
const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });

/* ───────────────────────────── University tables ───────────────────────────── */

/**
 * One row per invitation email. A newer invitation for the same person replaces the
 * older one (revoke_reason "replaced"), so at most one link per person works at a time.
 */
export const idnInvites = pgTable(
  "idn_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleName("role").notNull(),
    /** SHA-256 of the whole token ("<universityId>.<secret>"), hex. */
    tokenHash: text("token_hash").notNull(),
    /** The user.invited event this came from (null for a resend or a manual invitation). */
    eventId: uuid("event_id"),
    expiresAt: at("expires_at").notNull(),
    sentAt: at("sent_at").notNull().defaultNow(),
    acceptedAt: at("accepted_at"),
    revokedAt: at("revoked_at"),
    /** "revoked" (by an admin) or "replaced" (a newer invitation was sent). */
    revokeReason: text("revoke_reason"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idn_invites_token_uq").on(t.tokenHash),
    uniqueIndex("idn_invites_event_uq").on(t.eventId),
    index("idn_invites_user_idx").on(t.universityId, t.userId),
  ],
);

/** Sign-in options a university chooses. Missing row = defaults. */
export const idnSettings = pgTable("idn_settings", {
  universityId: uuid("university_id")
    .primaryKey()
    .references(() => universities.id, { onDelete: "cascade" }),
  phoneSignIn: boolean("phone_sign_in").notNull().default(false),
  updatedAt: at("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

/**
 * A phone sign-in in progress. The browser holds "<universityId>.<id>.<nonce>" in an
 * httpOnly cookie; only the nonce's hash is stored. A challenge is created even when the
 * number isn't registered (no SMS is sent), so the screen never reveals who is a member.
 */
export const idnOtpChallenges = pgTable(
  "idn_otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    /** "sign_in" (phone tab on /login) or "verify_phone" (a new number on the profile page). */
    purpose: text("purpose").notNull().default("sign_in"),
    /** For verify_phone: the person changing their number. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** E.164, e.g. "+919820011001". */
    phone: text("phone").notNull(),
    /** HMAC-SHA256 of the 6-digit code, keyed per challenge. */
    codeHash: text("code_hash").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    sends: integer("sends").notNull().default(1),
    sentAt: at("sent_at").notNull().defaultNow(),
    expiresAt: at("expires_at").notNull(),
    /** Set when the right code was entered and more than one account uses the number. */
    verifiedAt: at("verified_at"),
    consumedAt: at("consumed_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idn_otp_challenges_created_idx").on(t.universityId, t.createdAt),
    check("idn_otp_challenges_purpose", sql`${t.purpose} in ('sign_in', 'verify_phone')`),
  ],
);

/** Profile photos live per university, because storage keys are per university. */
export const idnPhotos = pgTable(
  "idn_photos",
  {
    universityId: universityId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.universityId, t.userId] })],
);

/* ───────────────────────────── Global tables (system connection only) ───────────────────────────── */

/** Password-reset links and Zinny team invitations (which belong to no university). */
export const idnTokens = pgTable(
  "idn_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "reset" | "team_invite" */
    purpose: text("purpose").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    eventId: uuid("event_id"),
    /** For team invitations: the role named in the email. */
    role: roleName("role"),
    expiresAt: at("expires_at").notNull(),
    usedAt: at("used_at"),
    revokedAt: at("revoked_at"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idn_tokens_token_uq").on(t.tokenHash),
    uniqueIndex("idn_tokens_event_uq").on(t.eventId),
    index("idn_tokens_user_idx").on(t.userId, t.purpose),
    check("idn_tokens_purpose", sql`${t.purpose} in ('reset', 'team_invite')`),
  ],
);

/** What the core sessions table doesn't record: how and where each session signed in. */
export const idnSessions = pgTable(
  "idn_sessions",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "password" | "phone" | "invite" | "reset" | "demo" */
    method: text("method").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    lastSeenAt: at("last_seen_at").notNull().defaultNow(),
  },
  (t) => [index("idn_sessions_user_idx").on(t.userId)],
);

/**
 * Rate limits and lockouts. `key` is "<kind>:<sha256 of the email, phone or IP>", so no
 * address is stored in clear. `hits` counts inside the window that started at window_start.
 */
export const idnThrottles = pgTable("idn_throttles", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull().default(0),
  windowStart: at("window_start").notNull().defaultNow(),
  lockedUntil: at("locked_until"),
  /** Consecutive lockouts; each one lasts twice as long as the last (capped). */
  lockCount: integer("lock_count").notNull().default(0),
  updatedAt: at("updated_at").notNull().defaultNow(),
});
