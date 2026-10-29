/**
 * Demo data for payments (contracts.md section 6), on top of the core seed's paid orders:
 *  - invoice settings for the Demo University (SAC code and footer);
 *  - Riya's Python Basics order, partly refunded (a ₹1,000 scholarship) by Arun from Accounts;
 *  - Neil's refund_due order: he opened checkout for the Saturday intensive, then switched
 *    to the Evening batch in another tab and paid both. Core flags the first payment for
 *    a refund, which shows on the dashboard and on Sales for Accounts to send.
 */
import { and, eq } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { orders } from "@/db/schema";
import { confirmPayment, gateway, withTenant } from "@/server/core";
// Seeds need to hold a seat to create a refund_due order, and holding a seat isn't in the
// core API (see "Requests for other owners" in docs/handoff/payments.md).
import { holdSeat } from "@/server/services/enrolment";
import { refundOrder } from "./refunds";
import { payInvoiceDocuments } from "./schema";
import { updateInvoiceSettings } from "./settings";

export async function seed(ctx: SeedContext) {
  const arun = await ctx.actorFor("arun@demo.edu");

  await updateInvoiceSettings(arun, {
    sacCode: "999293",
    invoiceFooter:
      "Course fees are refundable in full until the batch starts, and in part for 14 days after. For billing questions, write to accounts@demo.edu.",
  });

  // The core seed's invoices were rendered (by the payment.confirmed handler) before these
  // settings existed. Demo data only: forget those renders so they come out with the
  // settings above on first download. Real invoices are never re-rendered.
  await withTenant(ctx.systemActor, (tx) => tx.delete(payInvoiceDocuments).where(eq(payInvoiceDocuments.universityId, ctx.universityId)));

  // A partly refunded order.
  const riyaPython = ctx.ids.enrolments["riya@demo.edu / Python Basics"];
  const [riyaOrder] = riyaPython
    ? await withTenant(ctx.systemActor, (tx) =>
        tx.select().from(orders).where(and(eq(orders.enrolmentId, riyaPython), eq(orders.status, "paid"))),
      )
    : [];
  if (riyaOrder && riyaOrder.gateway === gateway().name) {
    await refundOrder(arun, {
      orderId: riyaOrder.id,
      amountPaise: 1_000_00,
      reason: "Merit scholarship: ₹1,000 of the course fee waived",
    });
  } else {
    console.log("  payments: skipped the partial refund (Riya's Python order is missing or was paid through another gateway).");
  }

  // A refund_due order: two checkouts for one course, both paid.
  const neil = await ctx.actorFor("neil@demo.edu").catch(() => null);
  const saturday = ctx.ids.batches["Digital Marketing / Saturday intensive"];
  const evening = ctx.ids.batches["Digital Marketing / Evening"];
  if (!neil || !saturday || !evening) {
    console.log("  payments: skipped the refund_due order (Neil or the Digital Marketing batches are missing).");
    return;
  }
  const first = await holdSeat(neil, { batchId: saturday, acknowledgeClash: true });
  const second = await holdSeat(neil, { batchId: evening, acknowledgeClash: true });
  if (first.status !== "held" || second.status !== "held") {
    console.log("  payments: skipped the refund_due order (the Digital Marketing seats couldn't be held).");
    return;
  }
  await confirmPayment(ctx.universityId, { orderId: second.orderId, gatewayPaymentId: `seed_neil_dm_evening` });
  await confirmPayment(ctx.universityId, { orderId: first.orderId, gatewayPaymentId: `seed_neil_dm_saturday` });
}
