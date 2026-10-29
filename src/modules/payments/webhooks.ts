/**
 * Razorpay webhooks, POSTed to /api/payments/razorpay (brief "Webhook").
 *
 *  1. The signature (x-razorpay-signature, HMAC-SHA256 of the raw body with the webhook
 *     secret) must match, or the request is refused with 400 and nothing is stored.
 *  2. The university comes from core `orderUniversity(order_id)`; every later step runs
 *     inside that university only (withTenant as its system actor).
 *  3. Each webhook is stored in pay_webhook_events by event id and by body hash. A
 *     webhook seen before is answered 200 and changes nothing.
 *  4. Handled: payment.captured and order.paid (core confirmPayment), payment.failed
 *     (core failPayment), refund.processed and refund.failed (pay_refunds, then core
 *     markOrderRefunded when the whole order is refunded). Other events are recorded as
 *     ignored.
 *
 * Answers: 200 when handled, ignored or a duplicate; 400 for a bad signature or body;
 * 409 while the same event is being handled by another request; 500 when handling
 * failed (Razorpay retries, and the retry handles it again).
 */
import { createHash } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit, confirmPayment, failPayment, gateway, notify, orderUniversity, systemActorFor, withTenant, type Actor } from "@/server/core";
import { courseTitle, financeUserIds, loadOrder, lockOrder, orderByGatewayId, UUID_RE, type OrderRow } from "./internal";
import { inr } from "./money";
import { isRazorpay, type RazorpayPayment, type RazorpayRefund } from "./razorpay";
import { applyGatewayStatus, announceRefund, settleOrder } from "./refunds";
import { payRefunds, payWebhookEvents } from "./schema";

export const MAX_WEBHOOK_BYTES = 256 * 1024;
const STALE_CLAIM_MS = 3 * 60_000;

export type WebhookResult = { status: number; body: Record<string, unknown> };

type Envelope = {
  entity?: string;
  event?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: RazorpayPayment };
    refund?: { entity?: RazorpayRefund };
    order?: { entity?: { id?: string; amount?: number; status?: string } };
  };
};

type Outcome = { status: "processed" | "ignored" | "rejected"; outcome: string; orderId?: string | null; settle?: string | null };

const notesOf = (n: unknown): Record<string, string> => (n && typeof n === "object" && !Array.isArray(n) ? (n as Record<string, string>) : {});

export async function handleRazorpayWebhook(rawBody: string, headers: { signature: string | null; eventId: string | null }): Promise<WebhookResult> {
  const g = gateway();
  if (!isRazorpay(g)) return { status: 400, body: { error: "razorpay_not_configured" } };
  if (Buffer.byteLength(rawBody) > MAX_WEBHOOK_BYTES) return { status: 413, body: { error: "too_large" } };
  if (!headers.signature || !g.verifyWebhook(rawBody, headers.signature)) return { status: 400, body: { error: "invalid_signature" } };

  let env: Envelope;
  try {
    env = JSON.parse(rawBody) as Envelope;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const type = typeof env.event === "string" ? env.event : "";
  if (!type) return { status: 400, body: { error: "missing_event" } };

  const payment = env.payload?.payment?.entity;
  const refund = env.payload?.refund?.entity;
  const refundNotes = notesOf(refund?.notes);
  const gatewayOrderId = payment?.order_id || env.payload?.order?.entity?.id || null;

  // Which university: from the gateway order id through core; for a refund webhook without
  // a payment entity, from the notes we put on the refund (checked against the order below).
  let universityId = gatewayOrderId ? await orderUniversity(gatewayOrderId) : null;
  if (!universityId && refund && UUID_RE.test(refundNotes.universityId ?? "") && UUID_RE.test(refundNotes.orderId ?? "")) {
    universityId = refundNotes.universityId;
  }
  if (!universityId) return { status: 200, body: { ignored: "unknown_order" } };

  const sys = systemActorFor(universityId);
  const bodySha256 = createHash("sha256").update(rawBody).digest("hex");
  const eventId = (headers.eventId ?? "").trim().slice(0, 100) || `body:${bodySha256}`;
  const summary = {
    event: type,
    created_at: env.created_at ?? null,
    payment: payment
      ? { id: payment.id, order_id: payment.order_id, amount: payment.amount, currency: payment.currency, status: payment.status, method: payment.method ?? null, error_code: payment.error_code ?? null, error_description: payment.error_description ?? null }
      : null,
    refund: refund ? { id: refund.id, payment_id: refund.payment_id, amount: refund.amount, status: refund.status } : null,
  };

  // Claim the event. A replay (same event id, or the same signed body) changes nothing.
  const claim = await withTenant(sys, async (tx) => {
    const [row] = await tx
      .insert(payWebhookEvents)
      .values({
        universityId,
        eventId,
        bodySha256,
        eventType: type.slice(0, 64),
        gatewayOrderId,
        gatewayPaymentId: payment?.id ?? refund?.payment_id ?? null,
        gatewayRefundId: refund?.id ?? null,
        amountPaise: Number.isSafeInteger(refund?.amount ?? payment?.amount) ? (refund?.amount ?? payment?.amount)! : null,
        summary,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return { kind: "claimed" as const, id: row.id };
    const [seen] = await tx
      .select()
      .from(payWebhookEvents)
      .where(or(eq(payWebhookEvents.eventId, eventId), eq(payWebhookEvents.bodySha256, bodySha256)))
      .for("update");
    if (!seen) return { kind: "duplicate" as const, status: "unknown" };
    const stale = seen.status === "processing" && seen.claimedAt.getTime() < Date.now() - STALE_CLAIM_MS;
    if (seen.status === "failed" || stale) {
      await tx
        .update(payWebhookEvents)
        .set({ status: "processing", attempts: sql`${payWebhookEvents.attempts} + 1`, claimedAt: new Date(), error: null })
        .where(eq(payWebhookEvents.id, seen.id));
      return { kind: "claimed" as const, id: seen.id };
    }
    if (seen.status === "processing") return { kind: "busy" as const };
    return { kind: "duplicate" as const, status: seen.status };
  });
  if (claim.kind === "duplicate") return { status: 200, body: { duplicate: true, status: claim.status } };
  if (claim.kind === "busy") return { status: 409, body: { error: "in_progress" } };

  let result: Outcome;
  try {
    if (type === "payment.captured" || type === "order.paid") result = await onCaptured(sys, payment);
    else if (type === "payment.failed") result = await onFailed(sys, payment);
    else if (type === "refund.processed" || type === "refund.failed") result = await onRefund(sys, type, refund, payment);
    else result = { status: "ignored", outcome: "not_handled" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[payments] webhook ${type} ${eventId} failed:`, e);
    await withTenant(sys, (tx) =>
      tx.update(payWebhookEvents).set({ status: "failed", error: message.slice(0, 1000) }).where(eq(payWebhookEvents.id, claim.id)),
    );
    return { status: 500, body: { error: "processing_failed" } };
  }

  await withTenant(sys, async (tx) => {
    await tx
      .update(payWebhookEvents)
      .set({ status: result.status, outcome: result.outcome, orderId: result.orderId ?? null, processedAt: new Date() })
      .where(eq(payWebhookEvents.id, claim.id));
    await audit(tx, sys, "payment.webhook", "order", result.orderId ?? null, { event: type, eventId, outcome: result.outcome, status: result.status });
  });
  if (result.settle) await settleOrder(sys, result.settle);
  return { status: 200, body: { status: result.status, outcome: result.outcome } };
}

/** payment.captured / order.paid: check the amount, then let core enrol the student. */
async function onCaptured(sys: Actor, payment: RazorpayPayment | undefined): Promise<Outcome> {
  if (!payment?.id || !payment.order_id) return { status: "ignored", outcome: "no_payment" };
  const order = await withTenant(sys, (tx) => orderByGatewayId(tx, payment.order_id!));
  if (!order) return { status: "ignored", outcome: "unknown_order" };
  const notes = notesOf(payment.notes);
  if (notes.universityId && notes.universityId !== order.universityId) {
    await tellFinance(sys, order, "finance.payment_rejected", "A payment was refused", `Payment ${payment.id} names a different university than its order. Nothing was changed.`);
    return { status: "rejected", outcome: "university_mismatch", orderId: order.id };
  }
  if (payment.amount !== order.totalPaise || payment.currency !== "INR") {
    await tellFinance(
      sys,
      order,
      "finance.payment_rejected",
      "A payment didn't match its order",
      `Payment ${payment.id} was ${payment.currency} ${(payment.amount / 100).toFixed(2)}, but the order is ${inr(order.totalPaise)}. The student wasn't enrolled; refund it from the Razorpay dashboard.`,
    );
    return { status: "rejected", outcome: "amount_mismatch", orderId: order.id };
  }
  if (order.gatewayPaymentId && order.gatewayPaymentId !== payment.id && ["paid", "refund_due", "refunded"].includes(order.status)) {
    // The student paid twice for one order (it happens with UPI retries).
    await tellFinance(
      sys,
      order,
      "finance.duplicate_payment",
      "A student paid twice",
      `Payment ${payment.id} of ${inr(payment.amount)} is a second payment for an order that was already paid with ${order.gatewayPaymentId}. Refund it from the Razorpay dashboard.`,
    );
    return { status: "processed", outcome: "duplicate_payment", orderId: order.id };
  }
  const out = await confirmPayment(order.universityId, { orderId: order.id, gatewayPaymentId: payment.id });
  return { status: "processed", outcome: out.status, orderId: order.id };
}

/** payment.failed: free the seat (core only changes a pending order). */
async function onFailed(sys: Actor, payment: RazorpayPayment | undefined): Promise<Outcome> {
  if (!payment?.order_id) return { status: "ignored", outcome: "no_payment" };
  const order = await withTenant(sys, (tx) => orderByGatewayId(tx, payment.order_id!));
  if (!order) return { status: "ignored", outcome: "unknown_order" };
  if (order.status !== "pending") return { status: "processed", outcome: `order_${order.status}`, orderId: order.id };
  await failPayment(order.universityId, order.id);
  return { status: "processed", outcome: "seat_released", orderId: order.id };
}

/** refund.processed / refund.failed: move our refund on; record refunds made in the Razorpay dashboard. */
async function onRefund(sys: Actor, type: string, refund: RazorpayRefund | undefined, payment: RazorpayPayment | undefined): Promise<Outcome> {
  if (!refund?.id || !Number.isSafeInteger(refund.amount)) return { status: "ignored", outcome: "no_refund" };
  const notes = notesOf(refund.notes);
  return withTenant(sys, async (tx): Promise<Outcome> => {
    const order = payment?.order_id
      ? await orderByGatewayId(tx, payment.order_id)
      : UUID_RE.test(notes.orderId ?? "")
        ? await loadOrder(tx, notes.orderId).catch(() => null)
        : null;
    if (!order) return { status: "ignored", outcome: "unknown_order" };
    if (order.gatewayPaymentId && refund.payment_id && refund.payment_id !== order.gatewayPaymentId) {
      return { status: "ignored", outcome: "other_payment", orderId: order.id };
    }
    await lockOrder(tx, order.id);
    const [mine] = await tx
      .select()
      .from(payRefunds)
      .where(
        and(
          eq(payRefunds.orderId, order.id),
          or(eq(payRefunds.gatewayRefundId, refund.id), UUID_RE.test(notes.refundId ?? "") ? eq(payRefunds.id, notes.refundId) : sql`false`),
        ),
      );
    const status = type === "refund.processed" ? "processed" : "failed";
    if (mine) {
      const after = await applyGatewayStatus(tx, sys, mine.id, {
        gatewayRefundId: refund.id,
        status,
        failureReason: status === "failed" ? "Razorpay couldn't complete the refund." : undefined,
      });
      return { status: "processed", outcome: `refund_${after?.status ?? status}`, orderId: order.id, settle: after?.status === "processed" ? order.id : null };
    }
    if (status === "failed") return { status: "ignored", outcome: "unknown_refund", orderId: order.id };
    // Refunded straight from the Razorpay dashboard: record it so Sales and the order stay right.
    const [created] = await tx
      .insert(payRefunds)
      .values({
        universityId: order.universityId,
        orderId: order.id,
        amountPaise: refund.amount,
        reason: "Refunded from the Razorpay dashboard",
        status: "processed",
        gateway: "razorpay",
        gatewayRefundId: refund.id,
        processedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (!created) return { status: "processed", outcome: "refund_known", orderId: order.id };
    await audit(tx, sys, "payment.refund_processed", "order", order.id, { refundId: created.id, gatewayRefundId: refund.id, amountPaise: refund.amount, source: "razorpay_dashboard" });
    await announceRefund(tx, sys, created);
    return { status: "processed", outcome: "refund_recorded", orderId: order.id, settle: order.id };
  });
}

async function tellFinance(sys: Actor, order: OrderRow, kind: string, title: string, body: string) {
  await withTenant(sys, async (tx: Tx) => {
    const course = await courseTitle(tx, order.courseId);
    await notify(tx, order.universityId, await financeUserIds(tx), { kind, title, body: `${course.title}: ${body}`, data: { orderId: order.id } });
    await audit(tx, sys, kind, "order", order.id, { body });
  });
}

/** Webhook rows for one order, newest first (Sales order panel). */
export async function webhookLog(tx: Tx, orderId: string) {
  return tx
    .select({
      id: payWebhookEvents.id,
      eventType: payWebhookEvents.eventType,
      status: payWebhookEvents.status,
      outcome: payWebhookEvents.outcome,
      attempts: payWebhookEvents.attempts,
      receivedAt: payWebhookEvents.receivedAt,
      gatewayPaymentId: payWebhookEvents.gatewayPaymentId,
      gatewayRefundId: payWebhookEvents.gatewayRefundId,
    })
    .from(payWebhookEvents)
    .where(eq(payWebhookEvents.orderId, orderId))
    .orderBy(sql`${payWebhookEvents.receivedAt} desc`)
    .limit(50);
}


