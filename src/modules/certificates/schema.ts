/**
 * certificates tables. Prefix: cert_. drizzle.config.ts picks this file up automatically.
 * Row-level security applies to every table here because each has university_id.
 *
 *   cert_templates     the university's certificate designs (three to start, more can be added)
 *   cert_rules         per course: which template, automatic issue, validity and reminders
 *   cert_certificates  every certificate issued, with a frozen copy of what it says
 *
 * Certificates keep the ids of the enrolment, course, batch and department they came from
 * as plain columns, not foreign keys: a certificate is a permanent record and must survive
 * a course being deleted, and it must never block core from deleting one.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { courses, universities } from "@/db/schema";

export const certDesign = pgEnum("cert_design", ["classic", "modern", "minimal"]);
/** "expired" is set by the daily job; the verify page also works it out from valid_until, so it is right before the job runs. */
export const certStatus = pgEnum("cert_status", ["valid", "expired", "revoked"]);
export const certSource = pgEnum("cert_source", ["automatic", "manual"]);

export type CertDesign = (typeof certDesign.enumValues)[number];
export type CertStatus = (typeof certStatus.enumValues)[number];

/** Up to two people who sign the certificate. `imageKey` is a PNG or JPEG in storage. */
export type Signatory = { name: string; title: string; imageKey: string | null };

/** What a certificate says, frozen when it is issued, so later template edits never change it. */
export type TemplateSnapshot = {
  design: CertDesign;
  heading: string;
  intro: string;
  body: string;
  signatories: Signatory[];
  accentColor: string;
};

const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });

export const certTemplates = pgTable(
  "cert_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    /** Staff-facing name, e.g. "Classic". */
    name: text("name").notNull(),
    design: certDesign("design").notNull(),
    heading: text("heading").notNull().default("Certificate of completion"),
    intro: text("intro").notNull().default("This is to certify that"),
    body: text("body").notNull().default("has successfully completed the course"),
    signatories: jsonb("signatories").$type<Signatory[]>().notNull().default([]),
    /** Used for courses without a rule of their own. One per university. */
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cert_templates_one_default").on(t.universityId).where(sql`${t.isDefault} and ${t.archivedAt} is null`),
    index("cert_templates_uni_idx").on(t.universityId),
    check("cert_templates_signatories", sql`jsonb_typeof(${t.signatories}) = 'array' and jsonb_array_length(${t.signatories}) <= 2`),
  ],
);

export const certRules = pgTable(
  "cert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => certTemplates.id),
    /** Issue on enrolment.completed. Only ever happens when the course's certificateEnabled is on too. */
    autoIssue: boolean("auto_issue").notNull().default(true),
    /** Null: the certificate never expires. */
    validityMonths: integer("validity_months"),
    /** Null: no reminder. */
    reminderDays: integer("reminder_days"),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cert_rules_course_uq").on(t.courseId),
    check("cert_rules_validity", sql`${t.validityMonths} is null or ${t.validityMonths} between 1 and 600`),
    check("cert_rules_reminder", sql`${t.reminderDays} is null or ${t.reminderDays} between 1 and 365`),
  ],
);

export const certCertificates = pgTable(
  "cert_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: universityId(),
    /** 12 characters of Crockford base32, unique across every university (the verify page finds it by code alone). */
    code: text("code").notNull(),
    userId: uuid("user_id").notNull(),
    enrolmentId: uuid("enrolment_id").notNull(),
    courseId: uuid("course_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    /** The course's department when issued, so scoped staff lists need no join. */
    departmentId: uuid("department_id").notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => certTemplates.id),
    /** A renewal, or a new certificate after a revoked one, points at the certificate it follows. */
    replacesId: uuid("replaces_id").references((): AnyPgColumn => certCertificates.id),
    source: certSource("source").notNull(),
    status: certStatus("status").notNull().default("valid"),

    // What the certificate says, frozen at issue.
    studentName: text("student_name").notNull(),
    courseTitle: text("course_title").notNull(),
    universityName: text("university_name").notNull(),
    template: jsonb("template").$type<TemplateSnapshot>().notNull(),
    completedOn: date("completed_on").notNull(),
    issuedOn: date("issued_on").notNull(),
    /** Last day it is valid. Null: never expires. */
    validUntil: date("valid_until"),

    // The PDF, generated once and never changed.
    pdfKey: text("pdf_key").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    pdfBytes: integer("pdf_bytes").notNull(),

    /** The enrolment.completed event an automatic certificate came from. */
    sourceEventId: uuid("source_event_id"),
    /** Who issued it by hand, and why. Null for automatic certificates. */
    issuedBy: uuid("issued_by"),
    issueReason: text("issue_reason"),

    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by"),
    revokeReason: text("revoke_reason"),

    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cert_certificates_code_uq").on(t.code),
    // At most one certificate per enrolment; renewals and re-issues hang off it as a chain.
    uniqueIndex("cert_certificates_one_per_enrolment").on(t.enrolmentId).where(sql`${t.replacesId} is null`),
    uniqueIndex("cert_certificates_replaced_once").on(t.replacesId).where(sql`${t.replacesId} is not null`),
    uniqueIndex("cert_certificates_source_event_uq").on(t.sourceEventId).where(sql`${t.sourceEventId} is not null`),
    index("cert_certificates_uni_issued_idx").on(t.universityId, t.issuedOn),
    index("cert_certificates_user_idx").on(t.userId),
    index("cert_certificates_course_idx").on(t.courseId),
    index("cert_certificates_expiry_idx").on(t.status, t.validUntil),
    check("cert_certificates_code_format", sql`${t.code} ~ '^[0-9A-HJKMNP-TV-Z]{12}$'`),
    check("cert_certificates_revoked", sql`(${t.status} = 'revoked') = (${t.revokedAt} is not null)`),
    check("cert_certificates_manual_reason", sql`${t.source} = 'automatic' or ${t.issueReason} is not null`),
    check("cert_certificates_dates", sql`${t.validUntil} is null or ${t.validUntil} >= ${t.issuedOn}`),
  ],
);
