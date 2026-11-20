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

/**
 * No longer used by any column: plat_licences.plan is now a plat_plans.key. The type stays
 * declared so upgrading an existing database never has to ask whether it was renamed.
 */
export const platPlanLegacy = pgEnum("plat_plan", ["pilot", "standard", "enterprise"]);

/**
 * The plans Zinny sells: Pilot, Standard, Enterprise and any the team adds at /platform/plans.
 * Zinny's own price list, so no university_id. `key` is what licences store and never changes.
 * `price_paise` is before GST, for one billing period of `billing_months`.
 */
export const platPlans = pgTable(
  "plat_plans",
  {
    id: id(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    pricePaise: integer("price_paise").notNull(),
    billingMonths: integer("billing_months").notNull(),
    studentCap: integer("student_cap").notNull(),
    staffCap: integer("staff_cap").notNull(),
    /** Module ids a new licence on this plan starts with. */
    modules: jsonb("modules").$type<string[]>().notNull().default([]),
    gstRateBp: integer("gst_rate_bp").notNull().default(1800),
    /**
     * Seat packs on this plan, when they differ from the billing settings' defaults. Null:
     * the default. Sizes are people per pack; prices are before GST for a year of one pack.
     */
    studentPackSize: integer("student_pack_size"),
    studentPackPricePaise: integer("student_pack_price_paise"),
    staffPackSize: integer("staff_pack_size"),
    staffPackPricePaise: integer("staff_pack_price_paise"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("plat_plans_key_uq").on(t.key),
    check("plat_plan_price", sql`${t.pricePaise} >= 0`),
    check("plat_plan_months", sql`${t.billingMonths} between 1 and 120`),
    check("plat_plan_caps", sql`${t.studentCap} > 0 and ${t.staffCap} > 0`),
    check(
      "plat_plan_packs",
      sql`coalesce(${t.studentPackSize}, 1) > 0 and coalesce(${t.staffPackSize}, 1) > 0 and coalesce(${t.studentPackPricePaise}, 0) >= 0 and coalesce(${t.staffPackPricePaise}, 0) >= 0`,
    ),
  ],
);

/**
 * The current licence of one university: plan, caps, modules switched on and its term.
 * `plan` is a plat_plans.key. The price is copied from the plan when the licence is made
 * or moved to another plan, so a later change to the plan's price doesn't touch it.
 */
export const platLicences = pgTable(
  "plat_licences",
  {
    id: id(),
    universityId: universityId(),
    plan: text("plan").notNull(),
    /** The plan's price when this licence was priced, before GST and before any discount. */
    pricePaise: integer("price_paise").notNull().default(0),
    discountPaise: integer("discount_paise").notNull().default(0),
    discountNote: text("discount_note"),
    studentCap: integer("student_cap").notNull(),
    staffCap: integer("staff_cap").notNull(),
    /** Module ids switched on, e.g. ["assessments", "live-classes"]. */
    modules: jsonb("modules").$type<string[]>().notNull().default([]),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    notes: text("notes"),
    /** Renewed by the daily billing job before it ends: the next term at the plan's price then, invoiced. */
    autoRenew: boolean("auto_renew").notNull().default(true),
    /**
     * Licence-end reminders already emailed to the institute's admins: the end date they were
     * for and the smallest step sent (30, 14, 7 or 1 days before). A new end date starts over.
     */
    endReminderFor: date("end_reminder_for"),
    endReminderDays: integer("end_reminder_days"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("plat_licences_university_uq").on(t.universityId),
    check("plat_licence_caps", sql`${t.studentCap} > 0 and ${t.staffCap} > 0`),
    check("plat_licence_dates", sql`${t.endDate} >= ${t.startDate}`),
    check("plat_licence_price", sql`${t.pricePaise} >= 0 and ${t.discountPaise} >= 0 and ${t.discountPaise} <= ${t.pricePaise}`),
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
 * are copied at issue. While an invoice is unpaid its amount, discount, description, period
 * and dates can be revised (never its number); every revision is in the audit log.
 * `base_paise` is the taxable amount: list price minus discount.
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
    /** Price before the discount. Null on invoices issued before discounts existed (then it equals base_paise). */
    listPricePaise: integer("list_price_paise"),
    discountPaise: integer("discount_paise").notNull().default(0),
    discountNote: text("discount_note"),
    basePaise: integer("base_paise").notNull(),
    /** The licence this invoice was raised for, when it came from one. */
    licenceId: uuid("licence_id").references(() => platLicences.id, { onDelete: "set null" }),
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
    revisedAt: timestamp("revised_at", { withTimezone: true }),
    revisedBy: uuid("revised_by").references(() => users.id, { onDelete: "set null" }),
    /**
     * The last payment reminder sent for the current due date, as a step on the schedule:
     * 0 none, 1 before the due date, 2 on it, 3 and up the first, second… overdue reminder.
     * Each step is sent once; changing the due date starts the schedule again.
     */
    reminderStage: integer("reminder_stage").notNull().default(0),
    lastReminderOn: date("last_reminder_on"),
  },
  (t) => [
    uniqueIndex("plat_invoices_number_uq").on(t.number),
    index("plat_invoices_licence_idx").on(t.licenceId),
    check("plat_invoice_discount", sql`${t.discountPaise} >= 0 and (${t.listPricePaise} is null or ${t.listPricePaise} = ${t.basePaise} + ${t.discountPaise})`),
    index("plat_invoices_university_idx").on(t.universityId, t.issueDate),
    check("plat_invoice_number_len", sql`char_length(${t.number}) <= 16`),
    check("plat_invoice_status", sql`${t.status} in ('unpaid', 'paid')`),
    check("plat_invoice_amounts", sql`${t.basePaise} > 0 and ${t.totalPaise} = ${t.basePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`),
    check("plat_invoice_period", sql`${t.periodEnd} >= ${t.periodStart}`),
    check("plat_invoice_due", sql`${t.dueDate} >= ${t.issueDate}`),
    check("plat_invoice_paid", sql`(${t.status} = 'paid') = (${t.paidOn} is not null)`),
  ],
);

/**
 * How Zinny bills: one row (id "zinny"). Zinny's own settings, so no university_id. Read by
 * the licence form, saveLicence and the daily billing job; changed at /platform/billing/settings.
 */
export const platBillingSettings = pgTable(
  "plat_billing_settings",
  {
    id: text("id").primaryKey().default("zinny"),
    /** Days from the invoice date to the due date. */
    paymentDays: integer("payment_days").notNull().default(15),
    /** A renewal is invoiced this many days before the licence ends. */
    renewalLeadDays: integer("renewal_lead_days").notNull().default(15),
    /** "Renew automatically" starts ticked on a new licence. */
    autoRenewDefault: boolean("auto_renew_default").notNull().default(true),
    /** A licence's discount (and its note) carries over to its renewal. */
    keepDiscountOnRenewal: boolean("keep_discount_on_renewal").notNull().default(true),
    remindersOn: boolean("reminders_on").notNull().default(true),
    /** A reminder this many days before the due date; 0 for none. */
    remindDaysBefore: integer("remind_days_before").notNull().default(3),
    remindOnDueDate: boolean("remind_on_due_date").notNull().default(true),
    /** After the due date, a reminder every this many days… */
    remindEveryDaysAfter: integer("remind_every_days_after").notNull().default(7),
    /** …up to this many. */
    maxOverdueReminders: integer("max_overdue_reminders").notNull().default(3),
    /**
     * Seat packs: users an institute adds mid-term, in packs. Size is people per pack; price
     * is before GST for a year of one pack (a mid-term purchase pays for the days left). A
     * plan can set its own (plat_plans.*_pack_*). Changed only with platform.seat_pricing.
     */
    studentPackSize: integer("student_pack_size").notNull().default(25),
    studentPackPricePaise: integer("student_pack_price_paise").notNull().default(2_500_00),
    staffPackSize: integer("staff_pack_size").notNull().default(5),
    staffPackPricePaise: integer("staff_pack_price_paise").notNull().default(3_000_00),
    packsUpdatedAt: timestamp("packs_updated_at", { withTimezone: true }),
    packsUpdatedBy: uuid("packs_updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    check("plat_billing_settings_one_row", sql`${t.id} = 'zinny'`),
    check("plat_billing_settings_days", sql`${t.paymentDays} between 0 and 180 and ${t.renewalLeadDays} between 1 and 90`),
    check(
      "plat_billing_settings_reminders",
      sql`${t.remindDaysBefore} between 0 and 30 and ${t.remindEveryDaysAfter} between 1 and 60 and ${t.maxOverdueReminders} between 0 and 10`,
    ),
    check(
      "plat_billing_settings_packs",
      sql`${t.studentPackSize} > 0 and ${t.staffPackSize} > 0 and ${t.studentPackPricePaise} >= 0 and ${t.staffPackPricePaise} >= 0`,
    ),
  ],
);

/** Zinny's invoice sequence per financial year: ZNY/26-27/0001. */
export const platInvoiceCounters = pgTable("plat_invoice_counters", {
  financialYear: text("financial_year").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});

/* ─────────────────────────── Seat packs ─────────────────────────── */

/**
 * Users an institute added to its licence mid-term, in packs: one row per purchase. A
 * purchase's seats are added to the licence's cap when it is made (plat_licences.student_cap
 * or staff_cap always holds the total) and taken off again when packs are removed. `packs`
 * is how many of `packs_bought` are still on the licence; those renew with it, at the pack
 * price on the day it renews.
 *
 * `unit_price_paise` is the year price of one pack when bought; `charged_paise` is what the
 * purchase was invoiced before GST (pro-rated for the days left in the term, to the rupee).
 */
export const platSeatPacks = pgTable(
  "plat_seat_packs",
  {
    id: id(),
    universityId: universityId(),
    licenceId: uuid("licence_id")
      .notNull()
      .references(() => platLicences.id, { onDelete: "cascade" }),
    /** "student" | "staff" */
    kind: text("kind").notNull(),
    packsBought: integer("packs_bought").notNull(),
    /** Still on the licence: 0 once every pack of this purchase was removed. */
    packs: integer("packs").notNull(),
    seatsPerPack: integer("seats_per_pack").notNull(),
    unitPricePaise: integer("unit_price_paise").notNull(),
    chargedPaise: integer("charged_paise").notNull().default(0),
    /** The days this purchase paid for: from the day it was made to the licence's end date then. */
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    invoiceId: uuid("invoice_id").references(() => platInvoices.id, { onDelete: "set null" }),
    /** "institute" (bought on the institute's Seats page) | "zinny" (added by the Zinny team) */
    source: text("source").notNull(),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("plat_seat_packs_licence_idx").on(t.licenceId, t.kind),
    index("plat_seat_packs_university_idx").on(t.universityId, t.createdAt),
    check("plat_seat_pack_kind", sql`${t.kind} in ('student', 'staff')`),
    check("plat_seat_pack_source", sql`${t.source} in ('institute', 'zinny')`),
    check("plat_seat_pack_counts", sql`${t.packsBought} > 0 and ${t.packs} >= 0 and ${t.packs} <= ${t.packsBought} and ${t.seatsPerPack} > 0`),
    check("plat_seat_pack_money", sql`${t.unitPricePaise} >= 0 and ${t.chargedPaise} >= 0`),
    check("plat_seat_pack_period", sql`${t.periodEnd} >= ${t.periodStart}`),
  ],
);
