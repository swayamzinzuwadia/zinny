/**
 * Finance → Sales (PRD page 8: orders, payments, GST invoices; page 2: finance reports).
 *
 *  - Filters: date (the day the order was paid, or created if never paid, in the
 *    university's time zone), status, course, batch, and a student search.
 *  - Totals over everything the filters match: gross collected, GST, refunds, net.
 *  - Order detail: amounts, gateway ids, invoice, refund history, webhook log.
 *  - CSV export of the filtered orders.
 *
 * Viewing needs `finance.view` (Admin, Board / Owner, Accounts & Fees). Refunding needs
 * `finance.refund`; editing invoice settings needs `finance.manage`.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { batches, courses, invoices, orders, universities, users } from "@/db/schema";
import { assertCan, audit, can, withTenant, type Actor } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { dayIn, MONEY_IN, refundTotals, uni } from "./internal";
import { decimal } from "./money";
import { refundableNow } from "./refunds";
import { payRefunds } from "./schema";
import { webhookLog } from "./webhooks";

export const SALES_STATUSES = ["paid", "partly_refunded", "refund_due", "refunded", "pending", "failed", "expired"] as const;
export type SalesStatus = (typeof SALES_STATUSES)[number];

export const STATUS_LABEL: Record<SalesStatus, string> = {
  paid: "Paid",
  partly_refunded: "Partly refunded",
  refund_due: "Refund due",
  refunded: "Refunded",
  pending: "Awaiting payment",
  failed: "Failed",
  expired: "Expired",
};

export type SalesFilters = {
  from?: string;
  to?: string;
  status?: SalesStatus;
  courseId?: string;
  batchId?: string;
  q?: string;
  page?: number;
};

export const PAGE_SIZE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f-]{36}$/i;

/** Accepts URL search params and keeps only valid values. */
export function parseFilters(sp: Record<string, string | string[] | undefined>): SalesFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const f: SalesFilters = {};
  if (DATE.test(one("from"))) f.from = one("from");
  if (DATE.test(one("to"))) f.to = one("to");
  if ((SALES_STATUSES as readonly string[]).includes(one("status"))) f.status = one("status") as SalesStatus;
  if (ID.test(one("course"))) f.courseId = one("course");
  if (ID.test(one("batch"))) f.batchId = one("batch");
  if (one("q")) f.q = one("q").slice(0, 80);
  const page = Number(one("page"));
  if (Number.isInteger(page) && page > 1) f.page = Math.min(page, 10_000);
  return f;
}

/** Per order: money refunded (processed) and on its way (requested or pending). */
function refundAgg() {
  return sql`(select ${payRefunds.orderId} as order_id,
      coalesce(sum(${payRefunds.amountPaise}) filter (where ${payRefunds.status} = 'processed'), 0)::int as refunded,
      coalesce(sum(${payRefunds.amountPaise}) filter (where ${payRefunds.status} in ('requested', 'pending')), 0)::int as in_flight
    from ${payRefunds} group by ${payRefunds.orderId})`;
}

const refunded = sql<number>`coalesce(r.refunded, 0)`;
const inFlight = sql<number>`coalesce(r.in_flight, 0)`;

function where(f: SalesFilters, timezone: string): SQL | undefined {
  const day = sql`(coalesce(${orders.paidAt}, ${orders.createdAt}) at time zone ${timezone})::date`;
  const conds: (SQL | undefined)[] = [
    f.from ? sql`${day} >= ${f.from}::date` : undefined,
    f.to ? sql`${day} <= ${f.to}::date` : undefined,
    f.courseId ? eq(orders.courseId, f.courseId) : undefined,
    f.batchId ? eq(orders.batchId, f.batchId) : undefined,
  ];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(users.name, like), ilike(users.email, like), ilike(invoices.number, like), ilike(orders.gatewayPaymentId, like)));
  }
  switch (f.status) {
    case "paid":
      conds.push(and(eq(orders.status, "paid"), sql`${refunded} = 0`));
      break;
    case "partly_refunded":
      conds.push(and(inArray(orders.status, ["paid", "refund_due"]), sql`${refunded} > 0`));
      break;
    case "refund_due":
      conds.push(eq(orders.status, "refund_due"));
      break;
    case "refunded":
    case "pending":
    case "failed":
    case "expired":
      conds.push(eq(orders.status, f.status));
      break;
  }
  return and(...conds);
}

/** The status shown for an order, with partial refunds made visible. */
export function displayStatus(status: string, refundedPaise: number): SalesStatus {
  if (status === "paid" && refundedPaise > 0) return "partly_refunded";
  return (SALES_STATUSES as readonly string[]).includes(status) ? (status as SalesStatus) : "pending";
}

function base(tx: Parameters<Parameters<typeof withTenant>[1]>[0]) {
  return tx
    .select({
      id: orders.id,
      status: orders.status,
      basePaise: orders.basePaise,
      gstPaise: orders.gstPaise,
      totalPaise: orders.totalPaise,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      gateway: orders.gateway,
      gatewayOrderId: orders.gatewayOrderId,
      gatewayPaymentId: orders.gatewayPaymentId,
      studentName: users.name,
      studentEmail: users.email,
      courseId: courses.id,
      course: courses.title,
      batchId: batches.id,
      batch: batches.name,
      invoiceId: invoices.id,
      invoiceNumber: invoices.number,
      refundedPaise: refunded,
      refundInFlightPaise: inFlight,
    })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .innerJoin(courses, eq(courses.id, orders.courseId))
    .innerJoin(batches, eq(batches.id, orders.batchId))
    .leftJoin(invoices, eq(invoices.orderId, orders.id))
    .leftJoin(sql`${refundAgg()} r`, sql`r.order_id = ${orders.id}`);
}

export type SalesRow = Awaited<ReturnType<ReturnType<typeof base>["execute"]>>[number] & { display: SalesStatus; day: string };

export type SalesOverview = {
  rows: SalesRow[];
  totals: { grossPaise: number; gstPaise: number; refundsPaise: number; netPaise: number; paidOrders: number; refundDue: number; matched: number };
  page: number;
  pages: number;
  courses: { id: string; title: string }[];
  batches: { id: string; courseId: string; name: string }[];
  timezone: string;
  can: { refund: boolean; manage: boolean };
};

async function timezoneOf(tx: Parameters<Parameters<typeof withTenant>[1]>[0], universityId: string) {
  const [u] = await tx.select({ timezone: universities.timezone }).from(universities).where(eq(universities.id, universityId));
  return u?.timezone ?? "Asia/Kolkata";
}

export async function salesOverview(actor: Actor, f: SalesFilters): Promise<SalesOverview> {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const timezone = await timezoneOf(tx, uni(actor));
    const w = where(f, timezone);
    const [t] = await tx
      .select({
        matched: sql<number>`count(*)::int`,
        gross: sql<number>`coalesce(sum(${orders.totalPaise}) filter (where ${inArray(orders.status, [...MONEY_IN])}), 0)::bigint`,
        gst: sql<number>`coalesce(sum(${orders.gstPaise}) filter (where ${inArray(orders.status, [...MONEY_IN])}), 0)::bigint`,
        refunds: sql<number>`coalesce(sum(${refunded}), 0)::bigint`,
        paidOrders: sql<number>`count(*) filter (where ${inArray(orders.status, [...MONEY_IN])})::int`,
        refundDue: sql<number>`count(*) filter (where ${orders.status} = 'refund_due' and ${refunded} + ${inFlight} < ${orders.totalPaise})::int`,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .leftJoin(invoices, eq(invoices.orderId, orders.id))
      .leftJoin(sql`${refundAgg()} r`, sql`r.order_id = ${orders.id}`)
      .where(w);
    const pages = Math.max(1, Math.ceil(t.matched / PAGE_SIZE));
    const page = Math.min(f.page ?? 1, pages);
    const rows = await base(tx)
      .where(w)
      .orderBy(desc(sql`coalesce(${orders.paidAt}, ${orders.createdAt})`), desc(orders.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE);
    const cs = await tx.select({ id: courses.id, title: courses.title }).from(courses).where(sql`exists (select 1 from ${orders} o where o.course_id = ${courses.id})`).orderBy(asc(courses.title));
    const bs = await tx
      .select({ id: batches.id, courseId: batches.courseId, name: batches.name })
      .from(batches)
      .where(sql`exists (select 1 from ${orders} o where o.batch_id = ${batches.id})`)
      .orderBy(asc(batches.name));
    const gross = Number(t.gross);
    const refunds = Number(t.refunds);
    return {
      rows: rows.map((r) => ({ ...r, display: displayStatus(r.status, r.refundedPaise), day: dayIn(timezone, r.paidAt ?? r.createdAt) })),
      totals: { grossPaise: gross, gstPaise: Number(t.gst), refundsPaise: refunds, netPaise: gross - refunds, paidOrders: t.paidOrders, refundDue: t.refundDue, matched: t.matched },
      page,
      pages,
      courses: cs,
      batches: bs,
      timezone,
      can: { refund: can(actor, "finance.refund", { universityId: uni(actor) }), manage: can(actor, "finance.manage", { universityId: uni(actor) }) },
    };
  });
}

const requester = alias(users, "requester");

export async function orderDetail(actor: Actor, orderId: string) {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  if (!ID.test(orderId)) throw new NotFoundError("Order");
  return withTenant(actor, async (tx) => {
    const timezone = await timezoneOf(tx, uni(actor));
    const [row] = await base(tx).where(eq(orders.id, orderId));
    if (!row) throw new NotFoundError("Order");
    const [inv] = row.invoiceId ? await tx.select().from(invoices).where(eq(invoices.id, row.invoiceId)) : [];
    const refunds = await tx
      .select({ refund: payRefunds, requestedBy: requester.name })
      .from(payRefunds)
      .leftJoin(requester, eq(requester.id, payRefunds.requestedBy))
      .where(eq(payRefunds.orderId, orderId))
      .orderBy(desc(payRefunds.createdAt));
    const totals = await refundTotals(tx, orderId);
    const log = await webhookLog(tx, orderId);
    const refundable = refundableNow(row, totals.reservedPaise);
    return {
      order: { ...row, display: displayStatus(row.status, row.refundedPaise), day: dayIn(timezone, row.paidAt ?? row.createdAt) },
      invoice: inv ?? null,
      refunds: refunds.map((r) => ({ ...r.refund, requestedByName: r.requestedBy })),
      webhooks: log,
      totals,
      refundablePaise: refundable,
      timezone,
      can: {
        /** Holds finance.refund and something is left to refund. */
        refund: can(actor, "finance.refund", { universityId: uni(actor) }) && refundable > 0,
        /** Holds finance.refund at all (the refund box stays, so its last message stays visible). */
        refundAccess: can(actor, "finance.refund", { universityId: uni(actor) }),
        manage: can(actor, "finance.manage", { universityId: uni(actor) }),
      },
    };
  });
}

/** CSV cell: quoted, and prefixed when it would start a spreadsheet formula. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_LIMIT = 20_000;

/** Every order the filters match (up to 20,000), as CSV with money in rupees. Needs `finance.view`; logged. */
export async function salesCsv(actor: Actor, f: SalesFilters): Promise<{ csv: string; rows: number; truncated: boolean }> {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const timezone = await timezoneOf(tx, uni(actor));
    const rows = await base(tx)
      .where(where(f, timezone))
      .orderBy(desc(sql`coalesce(${orders.paidAt}, ${orders.createdAt})`), desc(orders.id))
      .limit(CSV_LIMIT + 1);
    const truncated = rows.length > CSV_LIMIT;
    const head = [
      "Date",
      "Order id",
      "Student",
      "Email",
      "Course",
      "Batch",
      "Status",
      "Taxable value (INR)",
      "GST (INR)",
      "Total (INR)",
      "Refunded (INR)",
      "Net (INR)",
      "GST invoice",
      "Gateway",
      "Gateway order id",
      "Gateway payment id",
    ];
    const lines = [head.map(csvCell).join(",")];
    for (const r of rows.slice(0, CSV_LIMIT)) {
      const money = (MONEY_IN as readonly string[]).includes(r.status);
      lines.push(
        [
          dayIn(timezone, r.paidAt ?? r.createdAt),
          r.id,
          r.studentName,
          r.studentEmail,
          r.course,
          r.batch,
          STATUS_LABEL[displayStatus(r.status, r.refundedPaise)],
          decimal(r.basePaise),
          decimal(r.gstPaise),
          decimal(r.totalPaise),
          decimal(r.refundedPaise),
          decimal(money ? r.totalPaise - r.refundedPaise : 0),
          r.invoiceNumber ?? "",
          r.gateway,
          r.gatewayOrderId ?? "",
          r.gatewayPaymentId ?? "",
        ]
          .map(csvCell)
          .join(","),
      );
    }
    await audit(tx, actor, "sales.export", "orders", null, { filters: f, rows: Math.min(rows.length, CSV_LIMIT) });
    return { csv: `﻿${lines.join("\r\n")}\r\n`, rows: Math.min(rows.length, CSV_LIMIT), truncated };
  });
}

/**
 * What needs the accounts team's attention: refund_due orders not yet refunded, and
 * refunds that failed or that Razorpay hasn't confirmed. Needs `finance.view` across the
 * university; returns null for anyone else (the dashboard card then shows nothing).
 */
export async function financeAttention(actor: Actor) {
  if (!can(actor, "finance.view", { universityId: uni(actor) })) return null;
  return withTenant(actor, async (tx) => {
    const due = await base(tx)
      .where(and(eq(orders.status, "refund_due"), sql`${refunded} + ${inFlight} < ${orders.totalPaise}`))
      .orderBy(asc(orders.paidAt))
      .limit(5);
    const [{ dueCount }] = await tx
      .select({ dueCount: sql<number>`count(*)::int` })
      .from(orders)
      .leftJoin(sql`${refundAgg()} r`, sql`r.order_id = ${orders.id}`)
      .where(and(eq(orders.status, "refund_due"), sql`${refunded} + ${inFlight} < ${orders.totalPaise}`));
    const [{ failed, waiting }] = await tx
      .select({
        failed: sql<number>`count(*) filter (where ${payRefunds.status} = 'failed' and ${payRefunds.createdAt} > now() - interval '14 days')::int`,
        waiting: sql<number>`count(*) filter (where ${payRefunds.status} in ('requested', 'pending'))::int`,
      })
      .from(payRefunds);
    return { due, dueCount, failedRefunds: failed, refundsInProgress: waiting };
  });
}
