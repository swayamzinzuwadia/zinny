/**
 * Finance → Invoices: every invoice of the institute in one list. Order invoices (issued
 * by core when a course or marketplace order is paid) sit under the built-in "Course
 * fees" category next to the invoices the institute raises itself.
 *
 *  - Filters: category, status (unpaid, overdue, paid, cancelled), invoice date range and
 *    a search over number, name and email.
 *  - Totals over everything the filters match: billed, collected, outstanding, overdue.
 *    Cancelled invoices count for none of them.
 *  - A summary per category, and a CSV export of the filtered list.
 *
 * Needs `finance.view`.
 */
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { invoices, orders } from "@/db/schema";
import { assertCan, can, todayIn, withTenant, type Actor } from "@/server/core";
import { categoriesIn, COURSE_FEES_ID, COURSE_FEES_NAME, type Category } from "./categories";
import { uni, universityRow } from "./internal";
import { invoiceHasGst } from "./invoices";
import { isOverdue, MODE_LABEL } from "./manual-invoices";
import { decimal } from "./money";
import { payInvoiceCategories, payManualInvoices, payRefunds } from "./schema";

export const REGISTER_STATUSES = ["unpaid", "overdue", "paid", "cancelled"] as const;
export type RegisterStatus = (typeof REGISTER_STATUSES)[number];
export const REGISTER_STATUS_LABEL: Record<RegisterStatus, string> = { unpaid: "Unpaid", overdue: "Overdue", paid: "Paid", cancelled: "Cancelled" };

export type RegisterFilters = { category?: string; status?: RegisterStatus; from?: string; to?: string; q?: string; page?: number };

export const REGISTER_PAGE_SIZE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Accepts URL search params and keeps only valid values. */
export function parseRegisterFilters(sp: Record<string, string | string[] | undefined>): RegisterFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const f: RegisterFilters = {};
  if (one("category") === COURSE_FEES_ID || ID.test(one("category"))) f.category = one("category");
  if ((REGISTER_STATUSES as readonly string[]).includes(one("status"))) f.status = one("status") as RegisterStatus;
  if (DATE.test(one("from"))) f.from = one("from");
  if (DATE.test(one("to"))) f.to = one("to");
  if (one("q")) f.q = one("q").slice(0, 80);
  const page = Number(one("page"));
  if (Number.isInteger(page) && page > 1) f.page = Math.min(page, 10_000);
  return f;
}

export type RegisterRow = {
  /** "order" = issued by checkout for a paid order; "manual" = raised by the institute. */
  source: "order" | "manual";
  id: string;
  /** The order behind an order invoice, for the link to Sales. */
  orderId: string | null;
  number: string;
  issueDate: string;
  dueDate: string | null;
  categoryId: string;
  category: string;
  buyerName: string;
  buyerEmail: string | null;
  description: string;
  taxablePaise: number;
  gstPaise: number;
  totalPaise: number;
  /** False for an invoice issued without GST. */
  gst: boolean;
  status: "unpaid" | "paid" | "cancelled";
  overdue: boolean;
  paidOn: string | null;
  paymentMode: string | null;
  paymentReference: string | null;
  /** Money sent back on an order invoice. */
  refundedPaise: number;
};

export type RegisterTotals = {
  count: number;
  billedPaise: number;
  collectedPaise: number;
  outstandingPaise: number;
  overduePaise: number;
  unpaid: number;
  overdue: number;
  cancelled: number;
};

export type CategorySummary = { id: string; name: string; archived: boolean; count: number; billedPaise: number; collectedPaise: number; outstandingPaise: number };

export type Register = {
  rows: RegisterRow[];
  page: number;
  pages: number;
  totals: RegisterTotals;
  byCategory: CategorySummary[];
  categories: Category[];
  gstEnabled: boolean;
  today: string;
  can: { manage: boolean };
};

function totalsOf(rows: RegisterRow[]): RegisterTotals {
  const live = rows.filter((r) => r.status !== "cancelled");
  const sum = (rs: RegisterRow[]) => rs.reduce((n, r) => n + r.totalPaise, 0);
  const unpaid = live.filter((r) => r.status === "unpaid");
  const overdue = unpaid.filter((r) => r.overdue);
  return {
    count: rows.length,
    billedPaise: sum(live),
    collectedPaise: sum(live.filter((r) => r.status === "paid")),
    outstandingPaise: sum(unpaid),
    overduePaise: sum(overdue),
    unpaid: unpaid.length,
    overdue: overdue.length,
    cancelled: rows.length - live.length,
  };
}

/** Every invoice the filters match, newest first (not paged). */
async function matching(actor: Actor, f: RegisterFilters) {
  return withTenant(actor, async (tx) => {
    const u = await universityRow(tx);
    const today = todayIn(u.timezone);
    const categories = await categoriesIn(tx, { includeArchived: true });
    const like = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

    // Order invoices: always paid, always "Course fees".
    const wantOrders = (!f.category || f.category === COURSE_FEES_ID) && (!f.status || f.status === "paid");
    const day = sql<string>`to_char((${invoices.issuedAt} at time zone ${u.timezone})::date, 'YYYY-MM-DD')`;
    const orderConds: (SQL | undefined)[] = [
      f.from ? sql`(${invoices.issuedAt} at time zone ${u.timezone})::date >= ${f.from}::date` : undefined,
      f.to ? sql`(${invoices.issuedAt} at time zone ${u.timezone})::date <= ${f.to}::date` : undefined,
      like ? or(ilike(invoices.number, like), ilike(invoices.buyerName, like), ilike(invoices.buyerEmail, like)) : undefined,
    ];
    const orderRows = wantOrders
      ? await tx
          .select({
            inv: invoices,
            day,
            paidAt: orders.paidAt,
            gatewayPaymentId: orders.gatewayPaymentId,
            gatewayName: orders.gateway,
            refunded: sql<number>`coalesce((select sum(${payRefunds.amountPaise}) from ${payRefunds} where ${payRefunds.orderId} = ${invoices.orderId} and ${payRefunds.status} = 'processed'), 0)::int`,
          })
          .from(invoices)
          .innerJoin(orders, eq(orders.id, invoices.orderId))
          .where(and(...orderConds))
          .orderBy(desc(invoices.issuedAt))
      : [];

    const manualConds: (SQL | undefined)[] = [
      f.category ? (f.category === COURSE_FEES_ID ? isNull(payManualInvoices.categoryId) : eq(payManualInvoices.categoryId, f.category)) : undefined,
      f.from ? sql`${payManualInvoices.issueDate} >= ${f.from}::date` : undefined,
      f.to ? sql`${payManualInvoices.issueDate} <= ${f.to}::date` : undefined,
      like ? or(ilike(payManualInvoices.number, like), ilike(payManualInvoices.buyerName, like), ilike(payManualInvoices.buyerEmail, like)) : undefined,
      f.status === "paid" ? eq(payManualInvoices.status, "paid") : undefined,
      f.status === "cancelled" ? eq(payManualInvoices.status, "cancelled") : undefined,
      f.status === "unpaid" ? eq(payManualInvoices.status, "unpaid") : undefined,
      f.status === "overdue" ? and(eq(payManualInvoices.status, "unpaid"), sql`${payManualInvoices.dueDate} < ${today}::date`) : undefined,
    ];
    const manualRows = await tx
      .select({
        i: payManualInvoices,
        category: payInvoiceCategories.name,
        firstLine: sql<string>`(select l.description from pay_manual_invoice_lines l where l.invoice_id = ${payManualInvoices.id} order by l.position limit 1)`,
        lineCount: sql<number>`(select count(*)::int from pay_manual_invoice_lines l where l.invoice_id = ${payManualInvoices.id})`,
      })
      .from(payManualInvoices)
      .leftJoin(payInvoiceCategories, eq(payInvoiceCategories.id, payManualInvoices.categoryId))
      .where(and(...manualConds))
      .orderBy(desc(payManualInvoices.issueDate), desc(payManualInvoices.createdAt));

    const rows: RegisterRow[] = [
      ...orderRows.map(({ inv, day: d, paidAt, gatewayPaymentId, gatewayName, refunded }): RegisterRow => ({
        source: "order",
        id: inv.id,
        orderId: inv.orderId,
        number: inv.number,
        issueDate: d,
        dueDate: null,
        categoryId: COURSE_FEES_ID,
        category: COURSE_FEES_NAME,
        buyerName: inv.buyerName,
        buyerEmail: inv.buyerEmail,
        description: inv.description,
        taxablePaise: inv.basePaise,
        gstPaise: inv.cgstPaise + inv.sgstPaise + inv.igstPaise,
        totalPaise: inv.totalPaise,
        gst: invoiceHasGst(inv),
        status: "paid",
        overdue: false,
        paidOn: paidAt ? todayIn(u.timezone, paidAt) : d,
        paymentMode: gatewayName === "mock" ? "Online (test mode)" : "Online",
        paymentReference: gatewayPaymentId,
        refundedPaise: refunded,
      })),
      ...manualRows.map(({ i, category, firstLine, lineCount }): RegisterRow => ({
        source: "manual",
        id: i.id,
        orderId: null,
        number: i.number,
        issueDate: i.issueDate,
        dueDate: i.dueDate,
        categoryId: i.categoryId ?? COURSE_FEES_ID,
        category: category ?? COURSE_FEES_NAME,
        buyerName: i.buyerName,
        buyerEmail: i.buyerEmail,
        description: lineCount > 1 ? `${firstLine} and ${lineCount - 1} more` : (firstLine ?? ""),
        taxablePaise: i.taxablePaise,
        gstPaise: i.cgstPaise + i.sgstPaise + i.igstPaise,
        totalPaise: i.totalPaise,
        gst: i.gstApplied,
        status: i.status,
        overdue: isOverdue(i, today),
        paidOn: i.paidOn,
        paymentMode: i.paymentMode ? MODE_LABEL[i.paymentMode] : null,
        paymentReference: i.paymentReference,
        refundedPaise: 0,
      })),
    ].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number));

    return { rows, categories, today, gstEnabled: u.gstEnabled };
  });
}

/** The invoice list with its totals and per-category summary. Needs `finance.view`. */
export async function invoiceRegister(actor: Actor, f: RegisterFilters = {}): Promise<Register> {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  const { rows, categories, today, gstEnabled } = await matching(actor, f);
  const pages = Math.max(1, Math.ceil(rows.length / REGISTER_PAGE_SIZE));
  const page = Math.min(f.page ?? 1, pages);

  const byId = new Map<string, RegisterRow[]>();
  for (const r of rows) byId.set(r.categoryId, [...(byId.get(r.categoryId) ?? []), r]);
  const byCategory = categories
    .filter((c) => byId.has(c.id))
    .map((c) => {
      const t = totalsOf(byId.get(c.id)!);
      return { id: c.id, name: c.name, archived: c.archived, count: t.count, billedPaise: t.billedPaise, collectedPaise: t.collectedPaise, outstandingPaise: t.outstandingPaise };
    })
    .sort((a, b) => b.billedPaise - a.billedPaise || a.name.localeCompare(b.name));

  return {
    rows: rows.slice((page - 1) * REGISTER_PAGE_SIZE, page * REGISTER_PAGE_SIZE),
    page,
    pages,
    totals: totalsOf(rows),
    byCategory,
    categories,
    gstEnabled,
    today,
    can: { manage: can(actor, "finance.manage", { universityId: uni(actor) }) },
  };
}

/** The order behind an order invoice (to open it in Sales), or null. Needs `finance.view`. */
export async function orderIdOfInvoice(actor: Actor, invoiceId: string): Promise<string | null> {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  if (!ID.test(invoiceId)) return null;
  return withTenant(actor, async (tx) => {
    const [row] = await tx.select({ orderId: invoices.orderId }).from(invoices).where(eq(invoices.id, invoiceId));
    return row?.orderId ?? null;
  });
}

const csvCell = (v: string | number | null) => {
  let s = v === null ? "" : String(v);
  // Stop a spreadsheet from running a cell that starts like a formula.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of every invoice the filters match. Needs `finance.view`. */
export async function invoiceRegisterCsv(actor: Actor, f: RegisterFilters = {}): Promise<{ csv: string; count: number }> {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  const { rows } = await matching(actor, f);
  const head = ["Invoice number", "Invoice date", "Due date", "Category", "Billed to", "Email", "For", "Amount before GST", "GST", "Total", "Status", "Paid on", "Payment mode", "Payment reference", "Refunded", "Source"];
  const lines = rows.map((r) =>
    [
      r.number,
      r.issueDate,
      r.dueDate,
      r.category,
      r.buyerName,
      r.buyerEmail,
      r.description,
      decimal(r.taxablePaise),
      decimal(r.gstPaise),
      decimal(r.totalPaise),
      r.status === "unpaid" && r.overdue ? "Overdue" : REGISTER_STATUS_LABEL[r.status],
      r.paidOn,
      r.paymentMode,
      r.paymentReference,
      decimal(r.refundedPaise),
      r.source === "order" ? "Order" : "Raised by institute",
    ]
      .map(csvCell)
      .join(","),
  );
  return { csv: `﻿${[head.join(","), ...lines].join("\r\n")}\r\n`, count: rows.length };
}
