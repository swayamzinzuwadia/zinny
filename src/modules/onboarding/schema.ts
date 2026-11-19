/**
 * onboarding tables. Prefix: onb_. drizzle.config.ts picks this file up automatically.
 *
 * Every table holds one university's data, so each has `university_id` and row-level
 * security applies. Money is integer paise; dates are "YYYY-MM-DD".
 */
import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { universities, users } from "@/db/schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const universityId = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });

/* ─────────────────────────── Institute self sign-up ─────────────────────────── */

/**
 * What an institute told us when it signed itself up, beyond what `universities` holds:
 * its type, contact person and city. One row per self-signed university; institutes the
 * Zinny team set up have none.
 */
export const onbSignups = pgTable(
  "onb_signups",
  {
    id: id(),
    universityId: universityId(),
    instituteType: text("institute_type").notNull(),
    contactName: text("contact_name").notNull(),
    contactEmail: text("contact_email").notNull(),
    contactPhone: text("contact_phone").notNull(),
    city: text("city").notNull(),
    /** "book-a-demo" or "signup": the page they started from. */
    source: text("source").notNull().default("signup"),
    createdAt: createdAt(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("onb_signups_university_uq").on(t.universityId)],
);

export const onbDocumentKind = pgEnum("onb_document_kind", ["pan", "partnership_deed", "moa", "aoa", "gst_certificate", "registration"]);

/** "uploading" until every part has arrived; then it waits for the Zinny team. */
export const onbDocumentStatus = pgEnum("onb_document_status", ["uploading", "pending", "approved", "rejected"]);

/**
 * The institute's documents (PAN card, deeds, certificates), reviewed by the Zinny team.
 * Files live in storage() under `<universityId>/<STORAGE_AREA>/documents/<id>.<ext>` (services/documents.ts). Replacing
 * or removing one keeps the old row with `superseded_at` set: nothing is deleted.
 */
export const onbDocuments = pgTable(
  "onb_documents",
  {
    id: id(),
    universityId: universityId(),
    kind: onbDocumentKind("kind").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    status: onbDocumentStatus("status").notNull().default("uploading"),
    reviewerNote: text("reviewer_note"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    /** Set when a newer upload of the same kind replaced it, or the institute removed it. */
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [
    index("onb_documents_university_idx").on(t.universityId, t.kind),
    check("onb_documents_size", sql`${t.sizeBytes} > 0 and ${t.sizeBytes} <= 10485760`),
  ],
);

/* ─────────────────────────── Plan checkout ─────────────────────────── */

export const onbPlanOrderStatus = pgEnum("onb_plan_order_status", ["created", "paid", "failed"]);

/**
 * An institute paying for a plan from /[uni]/admin/choose-plan. The licence and Zinny's
 * invoice are made by the Zinny team panel's services once the payment is confirmed.
 */
export const onbPlanOrders = pgTable(
  "onb_plan_orders",
  {
    id: id(),
    universityId: universityId(),
    planKey: text("plan_key").notNull(),
    planName: text("plan_name").notNull(),
    basePaise: integer("base_paise").notNull(),
    gstPaise: integer("gst_paise").notNull(),
    totalPaise: integer("total_paise").notNull(),
    gateway: text("gateway").notNull(),
    gatewayOrderId: text("gateway_order_id").notNull(),
    gatewayPaymentId: text("gateway_payment_id"),
    status: onbPlanOrderStatus("status").notNull().default("created"),
    licenceId: uuid("licence_id"),
    invoiceNumber: text("invoice_number"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("onb_plan_orders_gateway_uq").on(t.gatewayOrderId),
    check("onb_plan_orders_money", sql`${t.basePaise} >= 0 and ${t.gstPaise} >= 0 and ${t.totalPaise} = ${t.basePaise} + ${t.gstPaise}`),
  ],
);

/* ─────────────────────────── Student KYC ─────────────────────────── */

/**
 * A student's KYC at one institute. The PAN is stored encrypted (AES-256-GCM, key in
 * KYC_ENCRYPTION_KEY) with a masked copy for display; of the Aadhaar only the last 4 digits
 * are ever accepted. Consent is recorded with the time and the version of the notice shown.
 */
export const onbStudentKyc = pgTable(
  "onb_student_kyc",
  {
    id: id(),
    universityId: universityId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    panCipher: text("pan_cipher").notNull(),
    /** "XXXXX1234X": safe to show anywhere. */
    panMasked: text("pan_masked").notNull(),
    aadhaarLast4: text("aadhaar_last4"),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    consentNoticeVersion: text("consent_notice_version").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("onb_student_kyc_user_uq").on(t.universityId, t.userId),
    check("onb_student_kyc_aadhaar", sql`${t.aadhaarLast4} is null or ${t.aadhaarLast4} ~ '^[0-9]{4}$'`),
  ],
);
