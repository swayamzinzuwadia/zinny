/** Money (PRD pages 8 and 9): every payment is tagged with course, batch and university; every paid order gets a GST invoice. */
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses, invoiceCounters, invoices, orders, universities, users } from "@/db/schema";
import { assertCan, type Actor } from "../authz/engine";
import { financialYear, todayIn } from "../lib/dates";
import { withTenant } from "../tenant";

export function gstFor(basePaise: number, rateBp: number) {
  return Math.round((basePaise * rateBp) / 10_000);
}

/** Intra-state supply → CGST + SGST (half each). Inter-state → IGST. */
export function splitGst(gstPaise: number, intraState: boolean) {
  if (!intraState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise };
  const cgstPaise = Math.floor(gstPaise / 2);
  return { cgstPaise, sgstPaise: gstPaise - cgstPaise, igstPaise: 0 };
}

/**
 * Next invoice number for the university's financial year, e.g. "NMIM/26-27/00042".
 * GST rules cap invoice numbers at 16 characters and require them to be unique per
 * financial year — the 4-character prefix keeps us inside that.
 */
export async function nextInvoiceNumber(tx: Tx, universityId: string, prefix: string, onDate: string) {
  const fy = financialYear(onDate);
  const [row] = await tx
    .insert(invoiceCounters)
    .values({ universityId, financialYear: fy, lastSeq: 1 })
    .onConflictDoUpdate({
      target: [invoiceCounters.universityId, invoiceCounters.financialYear],
      set: { lastSeq: sql`${invoiceCounters.lastSeq} + 1` },
    })
    .returning();
  return { number: `${prefix}/${fy}/${String(row.lastSeq).padStart(5, "0")}`, financialYear: fy };
}

export async function issueInvoice(tx: Tx, orderId: string) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  const [uni] = await tx.select().from(universities).where(eq(universities.id, order.universityId));
  const [buyer] = await tx.select().from(users).where(eq(users.id, order.userId));
  const [course] = await tx.select().from(courses).where(eq(courses.id, order.courseId));
  const [batch] = await tx.select().from(batches).where(eq(batches.id, order.batchId));
  const today = todayIn(uni.timezone);
  const { number, financialYear: fy } = await nextInvoiceNumber(tx, uni.id, uni.invoicePrefix, today);
  // Students' state isn't collected yet, so place of supply is the university's state (intra-state).
  const split = splitGst(order.gstPaise, true);
  const [inv] = await tx
    .insert(invoices)
    .values({
      universityId: uni.id,
      orderId: order.id,
      number,
      financialYear: fy,
      sellerGstin: uni.gstin,
      sellerName: uni.legalName ?? uni.name,
      buyerName: buyer.name,
      buyerEmail: buyer.email,
      placeOfSupply: uni.stateCode,
      description: `${course.title} — ${batch.name}`,
      basePaise: order.basePaise,
      ...split,
      totalPaise: order.totalPaise,
    })
    .returning();
  return inv;
}

/** Finance → Sales: orders with course, batch and buyer. */
export async function listSales(actor: Actor, limit = 200) {
  assertCan(actor, "finance.view", { universityId: actor.universityId! });
  return withTenant(actor, (tx) =>
    tx
      .select({
        id: orders.id,
        status: orders.status,
        totalPaise: orders.totalPaise,
        gstPaise: orders.gstPaise,
        createdAt: orders.createdAt,
        paidAt: orders.paidAt,
        buyer: users.name,
        course: courses.title,
        batch: batches.name,
        invoiceNumber: invoices.number,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .innerJoin(courses, eq(courses.id, orders.courseId))
      .innerJoin(batches, eq(batches.id, orders.batchId))
      .leftJoin(invoices, eq(invoices.orderId, orders.id))
      .orderBy(desc(orders.createdAt))
      .limit(limit),
  );
}

export function formatINR(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(
    paise / 100,
  );
}
