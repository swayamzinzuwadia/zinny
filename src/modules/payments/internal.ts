/**
 * Small helpers shared by the payments services. Everything here takes an open tenant
 * transaction (from withTenant); callers check permissions first.
 *
 * Core tables (orders, invoices, courses, batches, users, universities, role_assignments)
 * are only ever read here, never written: orders change through the core API.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { courses, orders, roleAssignments, universities } from "@/db/schema";
import { NotFoundError } from "@/server/errors";
import type { Actor } from "@/server/core";
import { payRefunds } from "./schema";

export function uni(actor: Actor) {
  return actor.universityId!;
}

export type OrderRow = typeof orders.$inferSelect;
export type RefundRow = typeof payRefunds.$inferSelect;

/** Orders that took money: paid, paid after the batch filled, or refunded since. */
export const MONEY_IN = ["paid", "refund_due", "refunded"] as const;

/**
 * Serialises everything that changes one order's refunds (a refund request, its gateway
 * answer, a refund webhook, the reconcile job), without locking core's own order row.
 */
export async function lockOrder(tx: Tx, orderId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`pay.order:${orderId}`}, 0))`);
}

export async function loadOrder(tx: Tx, orderId: string): Promise<OrderRow> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!o) throw new NotFoundError("Order");
  return o;
}

export async function orderByGatewayId(tx: Tx, gatewayOrderId: string): Promise<OrderRow | null> {
  const [o] = await tx.select().from(orders).where(eq(orders.gatewayOrderId, gatewayOrderId)).limit(1);
  return o ?? null;
}

/**
 * Money already sent back (processed) and money promised but not yet confirmed
 * (requested or pending). Failed refunds count for neither.
 */
export async function refundTotals(tx: Tx, orderId: string) {
  const [r] = await tx
    .select({
      processed: sql<number>`coalesce(sum(${payRefunds.amountPaise}) filter (where ${payRefunds.status} = 'processed'), 0)::int`,
      inFlight: sql<number>`coalesce(sum(${payRefunds.amountPaise}) filter (where ${payRefunds.status} in ('requested', 'pending')), 0)::int`,
    })
    .from(payRefunds)
    .where(eq(payRefunds.orderId, orderId));
  return { processedPaise: r.processed, inFlightPaise: r.inFlight, reservedPaise: r.processed + r.inFlight };
}

/** People who handle money in this university: Institute Admins and Accounts & Fees, still active. */
export async function financeUserIds(tx: Tx): Promise<string[]> {
  const now = new Date();
  const rows = await tx
    .select({ userId: roleAssignments.userId, endsAt: roleAssignments.endsAt })
    .from(roleAssignments)
    .where(
      and(
        inArray(roleAssignments.role, ["institute_admin", "accounts_fees"]),
        isNull(roleAssignments.revokedAt),
        eq(roleAssignments.scopeType, "university"),
        or(isNull(roleAssignments.endsAt), sql`${roleAssignments.endsAt} > now()`),
      ),
    );
  return [...new Set(rows.filter((r) => !r.endsAt || r.endsAt > now).map((r) => r.userId))];
}

export async function courseTitle(tx: Tx, courseId: string) {
  const [c] = await tx.select({ title: courses.title, gstRateBp: courses.gstRateBp }).from(courses).where(eq(courses.id, courseId));
  return c ?? { title: "your course", gstRateBp: 0 };
}

/** The tenant's university row with the GST and invoice details core keeps (read only). */
export async function universityRow(tx: Tx) {
  const [u] = await tx.select().from(universities).where(sql`${universities.id} = zinny_current_university()`);
  if (!u) throw new NotFoundError("University");
  return u;
}

/** "YYYY-MM-DD" of a moment in a time zone. */
export function dayIn(timezone: string, at: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
