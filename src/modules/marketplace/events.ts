/** Event handlers (contracts.md section 2). Idempotent: a redelivery finds the seat already cancelled. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { defineHandler, type EventHandler } from "@/contracts/events";
import { batches, enrolments, orders } from "@/db/schema";
import { payRefunds } from "@/modules/payments/schema";
import { audit } from "@/server/core";

export const handlers: EventHandler[] = [
  defineHandler({
    id: "marketplace.refund-ends-access",
    on: ["payment.refunded"],
    async handle({ tx, actor, event }) {
      if (!event.universityId) return;
      const { orderId } = event.payload;
      const [order] = await tx
        .select({ totalPaise: orders.totalPaise, enrolmentId: orders.enrolmentId, recorded: batches.recorded })
        .from(orders)
        .innerJoin(batches, eq(batches.id, orders.batchId))
        .where(eq(orders.id, orderId));
      if (!order?.recorded || !order.enrolmentId) return;
      // Institute students keep their seat after a refund until an admin removes it. A marketplace
      // seat exists only because of the sale, so a full refund ends it; a partial one doesn't.
      const [{ refunded }] = await tx
        .select({ refunded: sql<number>`coalesce(sum(${payRefunds.amountPaise}), 0)::int` })
        .from(payRefunds)
        .where(and(eq(payRefunds.orderId, orderId), eq(payRefunds.status, "processed")));
      if (refunded < order.totalPaise) return;
      await tx
        .update(enrolments)
        .set({ status: "cancelled" })
        .where(and(eq(enrolments.id, order.enrolmentId), inArray(enrolments.status, ["active", "completed"])));
      await audit(tx, actor, "marketplace.access_ended", "enrolment", order.enrolmentId, { orderId });
    },
  }),
];
