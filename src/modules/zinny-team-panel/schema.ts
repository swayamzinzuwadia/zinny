/**
 * zinny-team-panel tables. Prefix: plat_. drizzle.config.ts picks this file up automatically.
 *
 * Tables about one university carry `university_id` (row-level security then applies to
 * the app role). The Zinny team panel itself reads and writes them on the system
 * connection, always after `assertPlatform`. Tables that are Zinny's own business
 * (partners, invoice counters) have no university_id, so the app role can't see them.
 *
 * Money is integer paise; dates are "YYYY-MM-DD".
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { courses, universities, users } from "@/db/schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });

/* ─────────────────────────── Licences ─────────────────────────── */

export const platPlan = pgEnum("plat_plan", ["pilot", "standard", "enterprise"]);

/** The current licence of one university: plan, caps, modules switched on and its term. */
export const platLicences = pgTable(
  "plat_licences",
  {
    id: id(),
    universityId: universityId(),
    plan: platPlan("plan").notNull(),
    studentCap: integer("student_cap").notNull(),
    staffCap: integer("staff_cap").notNull(),
    /** Module ids switched on, e.g. ["assessments", "live-classes"]. */
    modules: jsonb("modules").$type<string[]>().notNull().default([]),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("plat_licences_university_uq").on(t.universityId),
    check("plat_licence_caps", sql`${t.studentCap} > 0 and ${t.staffCap} > 0`),
    check("plat_licence_dates", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

/**
 * Licence warnings for the platform home: 90% of a cap, 30 days before the end date.
 * At most one live (unresolved) alert per university and kind. Resolved automatically
 * when the condition clears; someone with platform.licences can mark it handled.
 */
export const platAlerts = pgTable(
  "plat_alerts",
  {
    id: id(),
    universityId: universityId(),
    /** "student_cap" | "staff_cap" | "licence_end" */
    kind: text("kind").notNull(),
    /** "warning" | "critical" */
    level: text("level").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("plat_alerts_one_live_uq").on(t.universityId, t.kind).where(sql`${t.resolvedAt} is null`),
    index("plat_alerts_open_idx").on(t.resolvedAt, t.createdAt),
  ],
);

/* ─────────────────────────── Content review ─────────────────────────── */

/** Content QA has looked at a course. Whether it is flagged comes from its open flags. */
export const platCourseReviews = pgTable(
  "plat_course_reviews",
  {
    id: id(),
    universityId: universityId(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [uniqueIndex("plat_course_reviews_course_uq").on(t.courseId)],
);

/** An issue Content QA found in a course. Notes only: nobody on the Zinny team edits university content. */
export const platContentFlags = pgTable(
  "plat_content_flags",
  {
    id: id(),
    universityId: universityId(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    note: text("note").notNull(),
    /** "open" | "resolved" */
    status: text("status").notNull().default("open"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
  },
  (t) => [
    index("plat_content_flags_course_idx").on(t.courseId, t.status),
    check("plat_flag_status", sql`${t.status} in ('open', 'resolved')`),
  ],
);

/* ─────────────────────────── Partners (no university) ─────────────────────────── */

export const platPartnerKind = pgEnum("plat_partner_kind", ["sponsor", "corporate_partner"]);
export const platPartnerStatus = pgEnum("plat_partner_status", ["prospect", "in_talks", "active", "paused", "ended"]);

/** Sponsors and corporate partners for the future marketplace. Zinny's own records. */
export const platPartners = pgTable("plat_partners", {
  id: id(),
  name: text("name").notNull(),
  kind: platPartnerKind("kind").notNull(),
  status: platPartnerStatus("status").notNull().default("prospect"),
  website: text("website"),
  industry: text("industry"),
  city: text("city"),
  /** A short summary of the relationship. Running notes live in plat_partner_notes. */
  summary: text("summary"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const platPartnerContacts = pgTable(
  "plat_partner_contacts",
  {
    id: id(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => platPartners.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("plat_partner_contacts_partner_idx").on(t.partnerId),
    uniqueIndex("plat_partner_contacts_one_primary_uq").on(t.partnerId).where(sql`${t.isPrimary}`),
  ],
);

export const platPartnerNotes = pgTable(
  "plat_partner_notes",
  {
    id: id(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => platPartners.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("plat_partner_notes_partner_idx").on(t.partnerId, t.createdAt)],
);

/* ─────────────────────────── Zinny billing ─────────────────────────── */

/**
 * Zinny's own GST invoices to universities for their licences. Separate from the
 * universities' invoices to their students (core `invoices`). Seller and buyer details
 * are copied at issue, so an invoice never changes after it is issued.
 */
export const platInvoices = pgTable(
  "plat_invoices",
  {
    id: id(),
    universityId: universityId(),
    number: text("number").notNull(),
    financialYear: text("financial_year").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    description: text("description").notNull(),
    basePaise: integer("base_paise").notNull(),
    gstRateBp: integer("gst_rate_bp").notNull(),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date").notNull(),
    /** "unpaid" | "paid". Overdue is an unpaid invoice past its due date. */
    status: text("status").notNull().default("unpaid"),
    paidOn: date("paid_on"),
    paymentReference: text("payment_reference"),
    sellerName: text("seller_name").notNull(),
    sellerGstin: text("seller_gstin"),
    sellerStateCode: text("seller_state_code").notNull(),
    buyerName: text("buyer_name").notNull(),
    buyerGstin: text("buyer_gstin"),
    buyerStateCode: text("buyer_state_code").notNull(),
    buyerAddress: text("buyer_address"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("plat_invoices_number_uq").on(t.number),
    index("plat_invoices_university_idx").on(t.universityId, t.issueDate),
    check("plat_invoice_number_len", sql`char_length(${t.number}) <= 16`),
    check("plat_invoice_status", sql`${t.status} in ('unpaid', 'paid')`),
    check("plat_invoice_amounts", sql`${t.basePaise} > 0 and ${t.totalPaise} = ${t.basePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`),
    check("plat_invoice_period", sql`${t.periodEnd} >= ${t.periodStart}`),
    check("plat_invoice_due", sql`${t.dueDate} >= ${t.issueDate}`),
    check("plat_invoice_paid", sql`(${t.status} = 'paid') = (${t.paidOn} is not null)`),
  ],
);

/** Zinny's invoice sequence per financial year: ZNY/26-27/0001. */
export const platInvoiceCounters = pgTable("plat_invoice_counters", {
  financialYear: text("financial_year").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});
