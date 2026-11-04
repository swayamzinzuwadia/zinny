/**
 * Demo data for payments (contracts.md section 6). Institute courses are free for their
 * students, so the only orders are marketplace sales:
 *  - invoice settings for the Demo University (SAC code and footer);
 *  - the marketplace seed's purchase, partly refunded by Arun from Accounts.
 */
import { and, eq } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { orders } from "@/db/schema";
import { gateway, withTenant } from "@/server/core";
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

  // A partly refunded order: the marketplace seed's purchase (institute courses are free for
  // their students, so marketplace sales are the only orders).
  const [sale] = await withTenant(ctx.systemActor, (tx) =>
    tx.select().from(orders).where(and(eq(orders.universityId, ctx.universityId), eq(orders.status, "paid"))).orderBy(orders.createdAt).limit(1),
  );
  if (sale && sale.gateway === gateway().name) {
    await refundOrder(arun, {
      orderId: sale.id,
      amountPaise: Math.min(100_00, sale.totalPaise),
      reason: "Goodwill refund: two lessons were missing their notes",
    });
  } else {
    console.log("  payments: skipped the partial refund (no paid marketplace order, or it was paid through another gateway).");
  }
}
