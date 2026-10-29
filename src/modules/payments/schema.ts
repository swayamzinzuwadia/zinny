/**
 * payments tables. Prefix: pay_. drizzle.config.ts picks this file up automatically.
 * Every table holds one university's data (`university_id`), so row-level security
 * applies to all of them. Money is integer paise.
 *
 * Core owns `orders` and `invoices`; payments only reads them and links to them here.
 */
import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
