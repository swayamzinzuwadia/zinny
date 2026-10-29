/**
 * Hourly safety net (contracts.md section 5), run once per university as its system actor.
 *
 *  - Payments: a Razorpay order still pending, failed or expired whose payment Razorpay
 *    did capture (the browser closed before the callback and the webhook was missed) is
 *    confirmed through core `confirmPayment`, which enrols the student or flags a refund.
 *  - Refunds: see reconcileRefunds in refunds.ts.
 */
import { and, desc, eq, gt, inArray, isNotNull, lt } from "drizzle-orm";
import type { Job } from "@/contracts/module";
import { orders } from "@/db/schema";
import { audit, confirmPayment, gateway, withTenant, type Actor } from "@/server/core";
import { GatewayError, isRazorpay } from "./razorpay";
import { reconcileRefunds } from "./refunds";

export async function reconcilePayments(actor: Actor, now = new Date()) {
  const g = gateway();
  if (!isRazorpay(g)) return { checked: 0, confirmed: 0 };
  const candidates = await withTenant(actor, (tx) =>
    tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.gateway, "razorpay"),
          isNotNull(orders.gatewayOrderId),
          inArray(orders.status, ["pending", "failed", "expired"]),
          gt(orders.createdAt, new Date(now.getTime() - 3 * 86_400_000)),
          lt(orders.createdAt, new Date(now.getTime() - 15 * 60_000)),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(50),
  );
  let confirmed = 0;
  for (const o of candidates) {
    let payments;
    try {
      payments = await g.orderPayments(o.gatewayOrderId!);
    } catch (e) {
      if (e instanceof GatewayError) continue;
      throw e;
    }
    let paid = payments.find((p) => p.status === "captured" && p.amount === o.totalPaise && p.currency === "INR");
    const authorised = !paid && payments.find((p) => p.status === "authorized" && p.amount === o.totalPaise && p.currency === "INR");
    if (authorised) {
      try {
        paid = await g.capturePayment(authorised.id, o.totalPaise);
      } catch (e) {
        if (e instanceof GatewayError) continue;
        throw e;
      }
    }
    if (!paid || paid.status !== "captured") continue;
    const out = await confirmPayment(o.universityId, { orderId: o.id, gatewayPaymentId: paid.id });
    await withTenant(actor, (tx) => audit(tx, actor, "payment.reconciled", "order", o.id, { gatewayPaymentId: paid.id, outcome: out.status }));
    confirmed++;
  }
  return { checked: candidates.length, confirmed };
}

export const jobs: Job[] = [
  {
    id: "payments.reconcile",
    every: "hour",
    async run(actor) {
      await reconcilePayments(actor);
      await reconcileRefunds(actor);
    },
  },
];
