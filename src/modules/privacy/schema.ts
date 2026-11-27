/**
 * privacy tables (DPDP Act 2023 and DPDP Rules 2025). Prefix: dpdp_. drizzle.config.ts picks
 * this file up automatically.
 *
 * Two kinds of record live here:
 *  - An institute's own records (it is the Data Fiduciary for its students): `university_id`
 *    is set and row-level security keeps them inside that institute.
 *  - Zinny's own records (Zinny is the Fiduciary for marketplace learners and for the people
 *    who sign institutes up): `university_id` is null. Row-level security hides those rows
 *    from every tenant; only services/system.ts reads or writes them, limited to the signed-in
 *    person's own rows or to the Zinny team after a platform permission check.
 * The breach register is Zinny's alone and has no university column at all.
 *
 * Nothing here is ever deleted when a person is erased: consents and requests are the
 * processing log the Rules require us to keep for at least a year (Rule 8(3)).
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { universities, users } from "@/db/schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
/** Null = Zinny is the Data Fiduciary (marketplace learners, institute sign-ups). */
const fiduciary = () => uuid("university_id").references(() => universities.id, { onDelete: "cascade" });
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ─────────────────────────── Consent (Act s.6, Rule 3) ─────────────────────────── */

export const dpdpPurpose = pgEnum("dpdp_purpose", ["account", "service", "kyc", "marketing", "analytics", "guardian"]);

/**
 * One consent for one purpose, as given. Withdrawing sets `withdrawn_at`; giving it again adds
 * a new row, so the history stays whole. `ip_hash` is a salted SHA-256 of the address, never
 * the address itself.
 */
export const dpdpConsents = pgTable(
  "dpdp_consents",
  {
    id: id(),
    universityId: fiduciary(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: dpdpPurpose("purpose").notNull(),
    noticeVersion: text("notice_version").notNull(),
    grantedAt: ts("granted_at").notNull().defaultNow(),
    withdrawnAt: ts("withdrawn_at"),
    /** Where it was given: "institute_signup", "student_signup", "kyc", "profile", "guardian", "seed". */
    source: text("source").notNull(),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    index("dpdp_consents_user_idx").on(t.userId, t.purpose),
    index("dpdp_consents_uni_idx").on(t.universityId),
    // At most one live consent per person, purpose and fiduciary.
    uniqueIndex("dpdp_consents_live_uq")
      .on(t.userId, t.purpose, sql`coalesce(${t.universityId}, '00000000-0000-0000-0000-000000000000'::uuid)`)
      .where(sql`${t.withdrawnAt} is null`),
  ],
);

/* ─────────────────────────── Rights requests (Act s.11 to 14, Rule 14) ─────────────────────────── */

export const dpdpRequestKind = pgEnum("dpdp_request_kind", ["access", "correction", "erasure", "nomination", "grievance"]);
export const dpdpRequestStatus = pgEnum("dpdp_request_status", ["open", "in_progress", "completed", "refused"]);

/**
 * A data principal's request: to correct, erase, nominate someone, or a grievance. Downloads
 * are logged as completed "access" requests. `due_on` is the date we promise an answer by,
 * in the fiduciary's time zone ("YYYY-MM-DD").
 */
export const dpdpRequests = pgTable(
  "dpdp_requests",
  {
    id: id(),
    universityId: fiduciary(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: dpdpRequestKind("kind").notNull(),
    status: dpdpRequestStatus("status").notNull().default("open"),
    /** What the person wrote. */
    details: text("details").notNull().default(""),
    /** Kind-specific fields: a nominee's name and contact, the field to correct. */
    data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
    dueOn: date("due_on", { mode: "string" }).notNull(),
    /** What we told the person when it was closed. */
    response: text("response"),
    handledBy: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: ts("closed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("dpdp_requests_uni_idx").on(t.universityId, t.status), index("dpdp_requests_user_idx").on(t.userId)],
);

/* ─────────────────────────── Children (Act s.9, Rule 10) ─────────────────────────── */

export const dpdpGuardianStatus = pgEnum("dpdp_guardian_status", ["pending", "verified", "refused"]);

/**
 * A learner who said they are under 18 (or whose date of birth says so), and their parent or
 * guardian's verifiable consent. Until `status` is "verified", no tracking, behavioural
 * monitoring or optional purposes apply to them. The link sent to the guardian is stored as a
 * hash only.
 */
export const dpdpGuardianConsents = pgTable(
  "dpdp_guardian_consents",
  {
    id: id(),
    universityId: fiduciary(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "YYYY-MM-DD" when given; a plain "I'm under 18" leaves it empty. */
    birthDate: date("birth_date", { mode: "string" }),
    guardianName: text("guardian_name").notNull(),
    guardianEmail: text("guardian_email"),
    guardianPhone: text("guardian_phone"),
    /** How the guardian was relied on: "link" (email or SMS link they opened and confirmed). */
    method: text("method").notNull().default("link"),
    tokenHash: text("token_hash").notNull(),
    status: dpdpGuardianStatus("status").notNull().default("pending"),
    sentAt: ts("sent_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    verifiedAt: ts("verified_at"),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("dpdp_guardian_token_uq").on(t.tokenHash),
    index("dpdp_guardian_user_idx").on(t.userId),
    check("dpdp_guardian_contact", sql`${t.guardianEmail} is not null or ${t.guardianPhone} is not null`),
  ],
);

/* ─────────────────────────── Retention (Act s.8(7), Rule 8) ─────────────────────────── */

export const dpdpRetentionAction = pgEnum("dpdp_retention_action", ["flag", "anonymise"]);

/** One row per institute: how long an inactive learner's account is kept, and what happens then. */
export const dpdpSettings = pgTable(
  "dpdp_settings",
  {
    id: id(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    inactiveDays: integer("inactive_days").notNull().default(1095),
    retentionAction: dpdpRetentionAction("retention_action").notNull().default("flag"),
    /** The institute's own grievance contact, shown to its learners. Empty = Zinny's officer. */
    grievanceName: text("grievance_name"),
    grievanceEmail: text("grievance_email"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dpdp_settings_uni_uq").on(t.universityId), check("dpdp_settings_days", sql`${t.inactiveDays} between 180 and 3650`)],
);

/**
 * A learner the retention job found inactive past the institute's period. They are told first
 * (Rule 8(2): at least 48 hours before erasure); `resolved_at` is set when they come back, an
 * admin keeps the account, or it is anonymised.
 */
export const dpdpRetentionFlags = pgTable(
  "dpdp_retention_flags",
  {
    id: id(),
    universityId: uuid("university_id")
      .notNull()
      .references(() => universities.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastActiveAt: ts("last_active_at").notNull(),
    flaggedAt: ts("flagged_at").notNull().defaultNow(),
    /** "kept" (an admin kept it, or they came back) or "anonymised". */
    outcome: text("outcome"),
    resolvedAt: ts("resolved_at"),
  },
  (t) => [uniqueIndex("dpdp_retention_open_uq").on(t.universityId, t.userId).where(sql`${t.resolvedAt} is null`)],
);

/* ─────────────────────────── Breach register (Act s.8(6), Rule 7) ─────────────────────────── */

export const dpdpBreachStatus = pgEnum("dpdp_breach_status", ["open", "contained", "closed"]);

/** Zinny's register of personal data breaches. Zinny team only (no university column). */
export const dpdpBreaches = pgTable("dpdp_breaches", {
  id: id(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  /** When Zinny became aware of it: the 72-hour clock starts here. */
  detectedAt: ts("detected_at").notNull(),
  occurredAt: ts("occurred_at"),
  /** Institutes whose people are affected (their names are copied at the time). */
  affectedInstitutes: jsonb("affected_institutes").$type<{ id: string; name: string }[]>().notNull().default([]),
  dataCategories: text("data_categories").notNull().default(""),
  principalsAffected: integer("principals_affected"),
  status: dpdpBreachStatus("status").notNull().default("open"),
  /** First intimation to the Data Protection Board, "without delay". */
  boardIntimatedAt: ts("board_intimated_at"),
  /** The detailed report to the Board, within 72 hours (Rule 7(2)(b)). */
  boardReportAt: ts("board_report_at"),
  /** Every affected person told, with what happened and what to do (Rule 7(1)). */
  principalsNotifiedAt: ts("principals_notified_at"),
  measures: text("measures").notNull().default(""),
  /** The Board allowed more time for the report, in writing. */
  extensionGranted: boolean("extension_granted").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  closedAt: ts("closed_at"),
  createdAt: createdAt(),
});
