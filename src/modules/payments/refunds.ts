/**
 * Refunds (PRD page 2: fee collection and refunds; brief "Refunds").
 *
 *  - Paid orders and refund_due orders (paid after the batch filled) can be refunded in
 *    full or in part, by holders of `finance.refund`, with a reason.
 *  - The amount is reserved first (pay_refunds, status "requested"), so two people
 *    refunding at once can never send back more than was paid.
 *  - Then the gateway refund API is called. When the refund is processed, the student is
 *    notified and `payment.refunded` is emitted (once per refund). When processed refunds
 *    add up to the whole order, core `markOrderRefunded` marks the order refunded.
 *  - Razorpay may answer "pending"; the refund.processed webhook (or the hourly reconcile
 *    job) finishes it later.
 */
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { orders } from "@/db/schema";
import { assertCan, audit, emit, gateway, markOrderRefunded, notify, withTenant, type Actor } from "@/server/core";
import { ConflictError, ValidationError } from "@/server/errors";
import { courseTitle, financeUserIds, loadOrder, lockOrder, refundTotals, uni, type OrderRow, type RefundRow } from "./internal";
import { inr } from "./money";
import { GatewayError, isRazorpay, type RazorpayRefund } from "./razorpay";
import { payRefunds } from "./schema";

export type RefundInput = { orderId: string; amountPaise: number; reason: string };
export type RefundResult = {
  refundId: string;
  status: "processed" | "pending" | "requested";
  amountPaise: number;
  /** True when this refund completed the order (the order is now "refunded"). */
  orderRefunded: boolean;
  message: string;
};

const REFUNDABLE = ["paid", "refund_due"];

/** How much of an order can still be refunded, and why not when it can't. */
export function refundableNow(order: Pick<OrderRow, "status" | "totalPaise" | "gatewayPaymentId">, reservedPaise: number) {
  if (!REFUNDABLE.includes(order.status) || !order.gatewayPaymentId) return 0;
  return Math.max(0, order.totalPaise - reservedPaise);
}

/** Starts a full or partial refund. Needs `finance.refund`. */
export async function refundOrder(actor: Actor, input: RefundInput): Promise<RefundResult> {
  assertCan(actor, "finance.refund", { universityId: uni(actor) });
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 5) throw new ValidationError("Say why you're refunding, in a few words. The student and the audit log see it.");
  if (reason.length > 500) throw new ValidationError("Keep the reason under 500 characters.");
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new ValidationError("Enter an amount above ₹0.");

  const g = gateway();

  // 1. Reserve the amount (locked per order, so concurrent refunds can't overshoot).
  const { refund, order } = await withTenant(actor, async (tx) => {
    await lockOrder(tx, input.orderId);
    const order = await loadOrder(tx, input.orderId);
    if (order.status === "refunded") throw new ConflictError("This order is already refunded in full.", "already_refunded");
    if (!REFUNDABLE.includes(order.status)) throw new ConflictError("Only paid orders can be refunded.", "not_paid");
    if (!order.gatewayPaymentId) throw new ConflictError("This order has no payment to refund.", "no_payment");
    if (order.gateway !== g.name) {
      throw new ConflictError(
        order.gateway === "mock"
          ? "This order was paid in test mode, so Razorpay can't refund it."
          : "This order was paid through Razorpay, but Razorpay keys aren't set here. Set the keys, then refund.",
        "gateway_mismatch",
      );
    }
    const totals = await refundTotals(tx, order.id);
    const left = refundableNow(order, totals.reservedPaise);
    if (left === 0) {
      throw new ConflictError(
        totals.inFlightPaise > 0 ? "A refund for the rest of this order is already on its way." : "Nothing is left to refund on this order.",
        "nothing_left",
      );
    }
    if (input.amountPaise > left) {
      throw new ValidationError(`You can refund at most ${inr(left)} on this order. ${totals.reservedPaise > 0 ? `${inr(totals.reservedPaise)} is already refunded or on its way.` : ""}`.trim(), "too_much");
    }
    if (isRazorpay(g) && input.amountPaise < 100) throw new ValidationError("Razorpay refunds start at ₹1.");
    const [refund] = await tx
      .insert(payRefunds)
      .values({ universityId: uni(actor), orderId: order.id, amountPaise: input.amountPaise, reason, gateway: g.name, requestedBy: actor.userId || null })
      .returning();
    await audit(tx, actor, "payment.refund_request", "order", order.id, { refundId: refund.id, amountPaise: refund.amountPaise, reason });
    return { refund, order };
  });

  // 2. Ask the gateway (outside any transaction: no network call while holding locks).
  let answer: Awaited<ReturnType<typeof g.refund>>;
  try {
    answer = await g.refund({
      gatewayPaymentId: order.gatewayPaymentId!,
      amountPaise: refund.amountPaise,
      notes: { refundId: refund.id, orderId: order.id, universityId: order.universityId, reason: reason.slice(0, 200) },
    });
  } catch (e) {
    const unsure = e instanceof GatewayError ? e.retriable : !(e instanceof GatewayError);
    const message = e instanceof GatewayError ? e.message : "The payment gateway failed.";
    await withTenant(actor, async (tx) => {
      await lockOrder(tx, order.id);
      if (unsure) {
        // The refund may still have gone through: keep the amount reserved; reconcile checks.
        await tx.update(payRefunds).set({ failureReason: message }).where(and(eq(payRefunds.id, refund.id), eq(payRefunds.status, "requested")));
      } else {
        await tx.update(payRefunds).set({ status: "failed", failureReason: message }).where(and(eq(payRefunds.id, refund.id), eq(payRefunds.status, "requested")));
      }
      await audit(tx, actor, unsure ? "payment.refund_unconfirmed" : "payment.refund_failed", "order", order.id, { refundId: refund.id, error: message });
    });
    if (!unsure) throw new ValidationError(`The refund didn't go through. ${message} Nothing was refunded.`, "gateway_refused");
    return {
      refundId: refund.id,
      status: "requested",
      amountPaise: refund.amountPaise,
      orderRefunded: false,
      message: `${message} The refund is saved; we'll check with Razorpay again within the hour.`,
    };
  }

  // 3. Record the gateway's answer.
  const after = await withTenant(actor, (tx) =>
    applyGatewayStatus(tx, actor, refund.id, { gatewayRefundId: answer.gatewayRefundId, status: answer.status }),
  );
  if (answer.status === "failed") throw new ValidationError("The payment gateway refused the refund. Nothing was refunded.", "gateway_refused");
  const orderRefunded = after?.status === "processed" ? await settleOrder(actor, order.id) : false;
  return {
    refundId: refund.id,
    status: after?.status === "processed" ? "processed" : "pending",
    amountPaise: refund.amountPaise,
    orderRefunded,
    message:
      after?.status === "processed"
        ? `${inr(refund.amountPaise)} refunded. The student is notified; it reaches their account in 5 to 7 working days.`
        : `${inr(refund.amountPaise)} refund started. Razorpay is processing it; the student is notified when it's done.`,
  };
}

const RANK: Record<RefundRow["status"], number> = { requested: 0, pending: 1, processed: 2, failed: 2 };

/**
 * Moves a refund forward with what the gateway said (never backwards: a processed refund
 * stays processed). Announces it when it becomes processed. Takes the order lock.
 */
export async function applyGatewayStatus(
  tx: Tx,
  actor: Actor,
  refundId: string,
  g: { gatewayRefundId?: string | null; status: "pending" | "processed" | "failed"; failureReason?: string },
): Promise<RefundRow | null> {
  const [current] = await tx.select().from(payRefunds).where(eq(payRefunds.id, refundId));
  if (!current) return null;
  await lockOrder(tx, current.orderId);
  const [r] = await tx.select().from(payRefunds).where(eq(payRefunds.id, refundId));
  const set: Partial<typeof payRefunds.$inferInsert> = {};
  if (g.gatewayRefundId && !r.gatewayRefundId) set.gatewayRefundId = g.gatewayRefundId;
  const moves = RANK[g.status] > RANK[r.status] || (r.status === "pending" && g.status === "failed");
  if (moves && r.status !== "processed" && r.status !== "failed") {
    set.status = g.status;
    if (g.status === "processed") {
      set.processedAt = new Date();
      set.failureReason = null;
    }
    if (g.status === "failed") set.failureReason = g.failureReason ?? "The payment gateway couldn't complete the refund.";
  }
  if (Object.keys(set).length === 0) return r;
  const [updated] = await tx.update(payRefunds).set(set).where(eq(payRefunds.id, refundId)).returning();
  if (set.status) {
    await audit(tx, actor, `payment.refund_${set.status}`, "order", r.orderId, { refundId, gatewayRefundId: updated.gatewayRefundId, amountPaise: r.amountPaise });
  }
  if (updated.status === "processed") await announceRefund(tx, actor, updated);
  if (set.status === "failed") await tellFinanceRefundFailed(tx, updated);
  return updated;
}

/** Notifies the student and emits `payment.refunded`, exactly once per processed refund. */
export async function announceRefund(tx: Tx, actor: Actor, refund: RefundRow) {
  const [claimed] = await tx
    .update(payRefunds)
    .set({ announcedAt: new Date() })
    .where(and(eq(payRefunds.id, refund.id), eq(payRefunds.status, "processed"), isNull(payRefunds.announcedAt)))
    .returning();
  if (!claimed) return false;
  const order = await loadOrder(tx, refund.orderId);
  const course = await courseTitle(tx, order.courseId);
  const full = (await refundTotals(tx, order.id)).processedPaise >= order.totalPaise;
  await notify(tx, order.universityId, [order.userId], {
    kind: "payment.refunded",
    title: `${inr(refund.amountPaise)} refunded for ${course.title}`,
    body: `${full ? "Your payment was refunded in full." : "Part of your payment was refunded."} It reaches your account in 5 to 7 working days. Reason: ${refund.reason}`,
    data: { orderId: order.id, refundId: refund.id, amountPaise: refund.amountPaise },
  });
  await emit(tx, actor, "payment.refunded", { orderId: order.id, userId: order.userId, amountPaise: refund.amountPaise });
  return true;
}

async function tellFinanceRefundFailed(tx: Tx, refund: RefundRow) {
  const order = await loadOrder(tx, refund.orderId);
  const course = await courseTitle(tx, order.courseId);
  await notify(tx, order.universityId, await financeUserIds(tx), {
    kind: "finance.refund_failed",
    title: `A refund of ${inr(refund.amountPaise)} failed`,
    body: `${course.title}: ${refund.failureReason ?? "the gateway couldn't complete it"}. Open Sales to try again.`,
    data: { orderId: order.id, refundId: refund.id },
  });
}

/**
 * When processed refunds cover the whole order, marks it refunded in core (idempotent).
 * Returns true when the order is refunded after this call.
 */
export async function settleOrder(actor: Actor, orderId: string): Promise<boolean> {
  const state = await withTenant(actor, async (tx) => {
    const order = await loadOrder(tx, orderId);
    const totals = await refundTotals(tx, orderId);
    const [last] = await tx
      .select({ id: payRefunds.gatewayRefundId })
      .from(payRefunds)
      .where(and(eq(payRefunds.orderId, orderId), eq(payRefunds.status, "processed")))
      .orderBy(sql`${payRefunds.processedAt} desc nulls last`)
      .limit(1);
    return { order, full: totals.processedPaise >= order.totalPaise, lastRefundId: last?.id ?? "" };
  });
  if (state.order.status === "refunded") return true;
  if (!state.full || !REFUNDABLE.includes(state.order.status)) return false;
  const res = await markOrderRefunded(actor, orderId, state.lastRefundId || "refund");
  return res.status === "refunded" || res.status === "already_refunded";
}

/**
 * Hourly safety net (job "payments.reconcile"), as the university's system actor:
 *  - refunds Razorpay hasn't confirmed yet (requested a while ago, or pending) are checked
 *    against Razorpay and moved on;
 *  - processed refunds that weren't announced are announced;
 *  - orders whose processed refunds cover the total are marked refunded in core.
 */
export async function reconcileRefunds(actor: Actor, now = new Date()) {
  const g = gateway();
  const stale = new Date(now.getTime() - 2 * 60_000);
  const giveUp = new Date(now.getTime() - 24 * 3600_000);
  const open = await withTenant(actor, (tx) =>
    tx
      .select({ refund: payRefunds, paymentId: orders.gatewayPaymentId })
      .from(payRefunds)
      .innerJoin(orders, eq(orders.id, payRefunds.orderId))
      .where(
        and(
          inArray(payRefunds.status, ["requested", "pending"]),
          eq(payRefunds.gateway, g.name),
          lt(payRefunds.createdAt, stale),
        ),
      )
      .orderBy(asc(payRefunds.createdAt))
      .limit(100),
  );
  let changed = 0;
  if (isRazorpay(g)) {
    const byPayment = new Map<string, RazorpayRefund[]>();
    for (const { refund, paymentId } of open) {
      if (!paymentId) continue;
      let list = byPayment.get(paymentId);
      if (!list) {
        try {
          list = await g.paymentRefunds(paymentId);
        } catch {
          continue; // Razorpay unreachable: try again next hour.
        }
        byPayment.set(paymentId, list);
      }
      const match = list.find(
        (x) =>
          (refund.gatewayRefundId && x.id === refund.gatewayRefundId) ||
          (!Array.isArray(x.notes) && x.notes?.refundId === refund.id) ||
          x.receipt === refund.id,
      );
      const next = match
        ? { gatewayRefundId: match.id, status: (match.status === "processed" ? "processed" : match.status === "failed" ? "failed" : "pending") as "processed" | "failed" | "pending" }
        : refund.status === "requested" && refund.createdAt < giveUp
          ? { status: "failed" as const, failureReason: "Razorpay has no record of this refund, so nothing was refunded. Try again." }
          : null;
      if (!next) continue;
      const after = await withTenant(actor, (tx) => applyGatewayStatus(tx, actor, refund.id, next));
      if (after && after.status !== refund.status) changed++;
    }
  }
  // Processed but never announced (a crash between steps), and orders to settle.
  const pendingWork = await withTenant(actor, async (tx) => {
    const unannounced = await tx.select().from(payRefunds).where(and(eq(payRefunds.status, "processed"), isNull(payRefunds.announcedAt))).limit(100);
    for (const r of unannounced) {
      await lockOrder(tx, r.orderId);
      await announceRefund(tx, actor, r);
    }
    const toSettle = await tx
      .selectDistinct({ orderId: payRefunds.orderId })
      .from(payRefunds)
      .innerJoin(orders, eq(orders.id, payRefunds.orderId))
      .where(and(eq(payRefunds.status, "processed"), inArray(orders.status, ["paid", "refund_due"])))
      .limit(100);
    return toSettle.map((x) => x.orderId);
  });
  for (const orderId of pendingWork) await settleOrder(actor, orderId);
  return { checked: open.length, changed };
}
