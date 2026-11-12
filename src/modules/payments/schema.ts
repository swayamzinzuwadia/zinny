/**
 * payments tables. Prefix: pay_. drizzle.config.ts picks this file up automatically.
 * Every table but the bundles holds one university's data (`university_id`), so row-level
 * security applies to them. Bundles span institutes and only the system connection reads
 * them. Money is integer paise.
 *
 * Core owns `orders` and `invoices`; payments only reads them and links to them here.
 */
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { invoices, orders, universities, users } from "@/db/schema";

const uniRef = () =>
  uuid("university_id")
    .notNull()
    .references(() => universities.id, { onDelete: "cascade" });

/** GST invoice settings, one row per university. Missing row = defaults (see settings.ts). */
export const paySettings = pgTable(
  "pay_settings",
  {
    universityId: uniRef().primaryKey(),
    /** Services Accounting Code printed on every invoice line: 4 or 6 digits starting 99, e.g. 999293. */
    sacCode: text("sac_code").notNull(),
    /** Printed at the bottom of every invoice (refund policy, contact). */
    invoiceFooter: text("invoice_footer").notNull().default(""),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("pay_settings_sac", sql`${t.sacCode} ~ '^99[0-9]{2}([0-9]{2})?$'`)],
);

/**
 * requested: saved, not yet accepted by the gateway (amount is reserved)
 * pending:   accepted by the gateway, money not yet sent back
 * processed: money sent back to the student
 * failed:    the gateway refused or failed it (amount is free again)
 */
export const payRefundStatus = pgEnum("pay_refund_status", ["requested", "pending", "processed", "failed"]);

/** Every refund, full or partial. An order is refunded in core once processed refunds add up to its total. */
export const payRefunds = pgTable(
  "pay_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uniRef(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    amountPaise: integer("amount_paise").notNull(),
    reason: text("reason").notNull(),
    status: payRefundStatus("status").notNull().default("requested"),
    gateway: text("gateway").notNull(),
    gatewayRefundId: text("gateway_refund_id"),
    failureReason: text("failure_reason"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** Set when payment.refunded was emitted and the student notified (exactly once). */
    announcedAt: timestamp("announced_at", { withTimezone: true }),
  },
  (t) => [
    check("pay_refunds_amount", sql`${t.amountPaise} > 0`),
    index("pay_refunds_order_idx").on(t.orderId),
    uniqueIndex("pay_refunds_gateway_uq").on(t.gatewayRefundId),
  ],
);

/** processing → processed | ignored | rejected, or failed (Razorpay retries, and the retry processes it again). */
export const payWebhookStatus = pgEnum("pay_webhook_status", ["processing", "processed", "ignored", "rejected", "failed"]);

/**
 * Every Razorpay webhook with a valid signature, so a replay changes nothing. A webhook
 * counts as seen when either its event id or the exact body was seen before: the
 * x-razorpay-event-id header isn't covered by the signature, the body is.
 */
export const payWebhookEvents = pgTable(
  "pay_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uniRef(),
    /** Razorpay's x-razorpay-event-id (or a hash of the body when the header is missing). */
    eventId: text("event_id").notNull(),
    /** sha256 of the raw body. Razorpay's retries of one event send the same body. */
    bodySha256: text("body_sha256").notNull(),
    eventType: text("event_type").notNull(),
    status: payWebhookStatus("status").notNull().default("processing"),
    /** What happened: "enrolled", "already_paid", "refund_due", "amount_mismatch", … */
    outcome: text("outcome"),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
    gatewayOrderId: text("gateway_order_id"),
    gatewayPaymentId: text("gateway_payment_id"),
    gatewayRefundId: text("gateway_refund_id"),
    amountPaise: integer("amount_paise"),
    /** A small summary of the payload (ids, amount, status, error) — never card or bank details. */
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    attempts: integer("attempts").notNull().default(1),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the current attempt started; a claim older than a few minutes is treated as crashed. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("pay_webhook_events_event_uq").on(t.eventId),
    uniqueIndex("pay_webhook_events_body_uq").on(t.bodySha256),
    index("pay_webhook_events_order_idx").on(t.orderId),
  ],
);

/**
 * The invoice PDF as first rendered. Later downloads return the stored file, so an
 * issued invoice never changes when settings change.
 */
export const payInvoiceDocuments = pgTable(
  "pay_invoice_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uniRef(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    /** The settings the PDF was rendered with, so a re-render (e.g. after storage loss) is identical. */
    sacCode: text("sac_code").notNull(),
    footer: text("footer").notNull().default(""),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    renderedAt: timestamp("rendered_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the "your invoice is ready" email went to the student (sent once). */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("pay_invoice_documents_invoice_uq").on(t.invoiceId)],
);

export type BundleStatus = "pending" | "paid" | "failed" | "expired";

/**
 * One payment for several orders: a marketplace cart can hold courses from different
 * institutes, and the learner pays once. Each order still belongs to its own institute and
 * gets its own GST invoice; the bundle only carries the shared Razorpay order and payment.
 * It spans institutes, so it has no university_id and only the system connection reads it.
 */
export const payBundles = pgTable(
  "pay_bundles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    totalPaise: integer("total_paise").notNull(),
    gateway: text("gateway").notNull(),
    gatewayOrderId: text("gateway_order_id").notNull(),
    gatewayPaymentId: text("gateway_payment_id"),
    status: text("status").$type<BundleStatus>().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("pay_bundles_gateway_order_uq").on(t.gatewayOrderId),
    index("pay_bundles_user_idx").on(t.userId, t.createdAt),
    check("pay_bundle_status", sql`${t.status} in ('pending', 'paid', 'failed', 'expired')`),
    check("pay_bundle_total", sql`${t.totalPaise} > 0`),
  ],
);

/** The orders a bundle pays for. An order belongs to one bundle at most. */
export const payBundleOrders = pgTable(
  "pay_bundle_orders",
  {
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => payBundles.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("pay_bundle_orders_order_uq").on(t.orderId), index("pay_bundle_orders_bundle_idx").on(t.bundleId)],
);

/**
 * Invoice categories an institute makes for itself (Exam fees, Hostel, Library…). Each
 * carries the GST rate and SAC code new invoices in it start with. "Course fees" is built
 * in and has no row: order invoices, and manual invoices with no category, belong to it.
 * Archived categories stay on the invoices that used them but can't be picked again.
 */
export const payInvoiceCategories = pgTable(
  "pay_invoice_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uniRef(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** GST rate new invoices in this category start with, in basis points (1800 = 18%). */
    defaultGstRateBp: integer("default_gst_rate_bp").notNull().default(1800),
    /** Optional SAC code; without one, invoices use the institute's code from invoice settings. */
    sacCode: text("sac_code"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One live category per name in an institute, whatever the capitals. Archived names are free again.
    uniqueIndex("pay_invoice_categories_name_uq")
      .on(t.universityId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    check("pay_invoice_categories_rate", sql`${t.defaultGstRateBp} in (0, 500, 1200, 1800, 2800)`),
    check("pay_invoice_categories_sac", sql`${t.sacCode} is null or ${t.sacCode} ~ '^99[0-9]{2}([0-9]{2})?$'`),
    check("pay_invoice_categories_name", sql`char_length(btrim(${t.name})) between 2 and 60`),
  ],
);

/** unpaid → paid (payment recorded) or cancelled (with a reason); paid → unpaid when a payment is taken back. */
export const payManualInvoiceStatus = pgEnum("pay_manual_invoice_status", ["unpaid", "paid", "cancelled"]);

export const PAYMENT_MODES = ["cash", "upi", "bank_transfer", "cheque", "card", "other"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/**
 * Invoices the institute raises itself (exam fees, hostel, a workshop), outside checkout.
 * Numbers come from the same counter as order invoices (core invoice_counters), so the
 * two never collide. Seller details, the GST choice, rate and SAC code are copied in when
 * the invoice is issued, so later changes to settings never alter it.
 */
export const payManualInvoices = pgTable(
  "pay_manual_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uniRef(),
    number: text("number").notNull(),
    financialYear: text("financial_year").notNull(),
    /** Null = the built-in "Course fees" category. */
    categoryId: uuid("category_id").references(() => payInvoiceCategories.id),
    /** Set when the invoice is billed to someone with an account here; they see it under Invoices. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    buyerName: text("buyer_name").notNull(),
    buyerEmail: text("buyer_email"),
    buyerPhone: text("buyer_phone"),
    buyerAddress: text("buyer_address"),
    buyerGstin: text("buyer_gstin"),
    /** GST state code of the place of supply (the buyer's state). */
    placeOfSupply: text("place_of_supply").notNull(),
    sellerName: text("seller_name").notNull(),
    sellerGstin: text("seller_gstin"),
    sellerAddress: text("seller_address"),
    sellerStateCode: text("seller_state_code").notNull(),
    /** Whether the institute charged GST when this was issued. False = a plain invoice with no tax rows. */
    gstApplied: boolean("gst_applied").notNull(),
    gstRateBp: integer("gst_rate_bp").notNull().default(0),
    sacCode: text("sac_code"),
    /** Sum of the lines. */
    subtotalPaise: integer("subtotal_paise").notNull(),
    discountPaise: integer("discount_paise").notNull().default(0),
    discountNote: text("discount_note").notNull().default(""),
    /** Subtotal minus discount: what GST is worked out on. */
    taxablePaise: integer("taxable_paise").notNull(),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    notes: text("notes").notNull().default(""),
    status: payManualInvoiceStatus("status").notNull().default("unpaid"),
    paidOn: date("paid_on"),
    paymentMode: text("payment_mode").$type<PaymentMode>(),
    paymentReference: text("payment_reference"),
    paymentRecordedBy: uuid("payment_recorded_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    cancelledBy: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pay_manual_invoices_number_uq").on(t.universityId, t.number),
    index("pay_manual_invoices_list_idx").on(t.universityId, t.issueDate),
    index("pay_manual_invoices_user_idx").on(t.userId),
    check("pay_manual_invoices_number_len", sql`char_length(${t.number}) <= 16`),
    check("pay_manual_invoices_amounts", sql`${t.subtotalPaise} > 0 and ${t.discountPaise} >= 0 and ${t.discountPaise} <= ${t.subtotalPaise}`),
    check("pay_manual_invoices_taxable", sql`${t.taxablePaise} = ${t.subtotalPaise} - ${t.discountPaise}`),
    check("pay_manual_invoices_total", sql`${t.totalPaise} = ${t.taxablePaise} + ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise}`),
    check("pay_manual_invoices_no_gst", sql`${t.gstApplied} or (${t.gstRateBp} = 0 and ${t.cgstPaise} + ${t.sgstPaise} + ${t.igstPaise} = 0)`),
    check("pay_manual_invoices_due", sql`${t.dueDate} is null or ${t.dueDate} >= ${t.issueDate}`),
    check("pay_manual_invoices_mode", sql`${t.paymentMode} is null or ${t.paymentMode} in ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other')`),
    check("pay_manual_invoices_paid", sql`(${t.status} = 'paid') = (${t.paidOn} is not null and ${t.paymentMode} is not null)`),
    check("pay_manual_invoices_cancelled", sql`(${t.status} = 'cancelled') = (${t.cancelReason} is not null)`),
  ],
);

/** The lines of a manual invoice, in the order they print. */
export const payManualInvoiceLines = pgTable(
  "pay_manual_invoice_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    universityId: uniRef(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => payManualInvoices.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitPricePaise: integer("unit_price_paise").notNull(),
    /** quantity × unit price. */
    amountPaise: integer("amount_paise").notNull(),
  },
  (t) => [
    index("pay_manual_invoice_lines_invoice_idx").on(t.invoiceId, t.position),
    check("pay_manual_invoice_lines_qty", sql`${t.quantity} > 0`),
    check("pay_manual_invoice_lines_price", sql`${t.unitPricePaise} >= 0`),
    check("pay_manual_invoice_lines_amount", sql`${t.amountPaise} = ${t.quantity} * ${t.unitPricePaise}`),
  ],
);
