/**
 * The two reports that come from core data (PRD page 8): enrolments and transactions.
 * Both read core tables with `select` only, inside withTenant, and narrow every row to
 * where the viewer holds the report's action, whatever ids arrive in the filters:
 *   - Institute Admin and Board / Owner see the whole university (Board read-only).
 *   - A Head of Department sees their own department.
 *   - Accounts & Fees hold finance.view but not enrolment.view: transactions only.
 */
import { and, asc, desc, eq, gte, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { batches, courses, departments, enrolments, invoices, orders, users } from "@/db/schema";
import type { ReportColumn, ReportDefinition, ReportParams, ReportResult } from "@/contracts/module";
import { universityLite, withTenant, type Actor } from "@/server/core";
import { batchInReach, checkParams, dayAfter, dayStart, reachOf } from "./scope";

export const ENROLMENTS_REPORT = "reports-board.enrolments";
export const TRANSACTIONS_REPORT = "reports-board.transactions";

/** Filters on the batch an enrolment or order belongs to (its department is copied from the course). */
function batchFilters(params: ReportParams): SQL[] {
  const out: SQL[] = [];
  if (params.departmentId) out.push(eq(batches.departmentId, params.departmentId));
  if (params.courseId) out.push(eq(batches.courseId, params.courseId));
  if (params.batchId) out.push(eq(batches.id, params.batchId));
  return out;
}

/* ───────────────────────────── Enrolments ───────────────────────────── */

const ENROLMENT_STATUS: Record<string, string> = {
  active: "Active",
  completed: "Completed",
  ended: "Ended at graduation",
  cancelled: "Cancelled",
  held: "Seat held",
  expired: "Hold expired",
};

export const ENROLMENT_COLUMNS: ReportColumn[] = [
  { key: "enrolledOn", label: "Enrolled on", type: "date" },
  { key: "student", label: "Student", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "department", label: "Department", type: "text" },
  { key: "course", label: "Course", type: "text" },
  { key: "batch", label: "Batch", type: "text" },
  { key: "status", label: "Status", type: "text" },
];

/** Students who enrolled in the range (paid or free), whatever their status is now. Seat holds that were never paid are left out. */
export async function runEnrolments(actor: Actor, params: ReportParams): Promise<ReportResult> {
  const r = reachOf(actor, "enrolment.view", "You don't have access to the enrolments report.");
  checkParams(params);
  return withTenant(actor, async (tx) => {
    const { timezone } = await universityLite(tx);
    const where: (SQL | undefined)[] = [isNotNull(enrolments.enrolledAt), batchInReach(r, batches.id, batches.departmentId), ...batchFilters(params)];
    if (params.from) where.push(gte(enrolments.enrolledAt, dayStart(params.from, timezone)));
    if (params.to) where.push(lt(enrolments.enrolledAt, dayAfter(params.to, timezone)));

    const rows = await tx
      .select({
        enrolledOn: sql<string>`to_char(${enrolments.enrolledAt} at time zone ${timezone}, 'YYYY-MM-DD')`,
        student: users.name,
        email: users.email,
        department: departments.name,
        course: courses.title,
        batch: batches.name,
        status: enrolments.status,
      })
      .from(enrolments)
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .innerJoin(departments, eq(departments.id, batches.departmentId))
      .innerJoin(users, eq(users.id, enrolments.userId))
      .where(and(...where))
      .orderBy(desc(enrolments.enrolledAt), asc(users.name), asc(enrolments.id));

    return {
      columns: ENROLMENT_COLUMNS,
      rows: rows.map((row) => ({ ...row, status: ENROLMENT_STATUS[row.status] ?? row.status })),
    };
  });
}

export const enrolmentsReport: ReportDefinition = {
  id: ENROLMENTS_REPORT,
  label: "Enrolments",
  description: "Who enrolled in which course, batch and department, with their status today and the date they enrolled.",
  action: "enrolment.view",
  filters: ["dateRange", "department", "course", "batch"],
  run: runEnrolments,
};

/* ───────────────────────────── Transactions ───────────────────────────── */

const ORDER_STATUS: Record<string, string> = {
  paid: "Paid",
  pending: "Awaiting payment",
  failed: "Failed",
  expired: "Expired",
  refund_due: "Refund due",
  refunded: "Refunded",
};

export const TRANSACTION_COLUMNS: ReportColumn[] = [
  { key: "date", label: "Date", type: "date" },
  { key: "invoice", label: "Invoice", type: "text" },
  { key: "student", label: "Student", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "department", label: "Department", type: "text" },
  { key: "course", label: "Course", type: "text" },
  { key: "batch", label: "Batch", type: "text" },
  { key: "status", label: "Status", type: "text" },
  { key: "taxableValue", label: "Taxable value", type: "money" },
  { key: "cgst", label: "CGST", type: "money" },
  { key: "sgst", label: "SGST", type: "money" },
  { key: "igst", label: "IGST", type: "money" },
  { key: "total", label: "Invoice total", type: "money" },
  { key: "refund", label: "Refunded", type: "money" },
  { key: "paymentReference", label: "Payment reference", type: "text" },
];

/**
 * Every order in the range. An order's date is its invoice date, or when it was paid, or
 * when it was placed, in that order. The money columns come from the GST invoice, so an
 * order without one (awaiting payment, failed, expired, or paid into a full batch) has
 * them blank, and the column totals equal the invoices issued in the range. Refunds are
 * always the full amount paid.
 */
export async function runTransactions(actor: Actor, params: ReportParams): Promise<ReportResult> {
  const r = reachOf(actor, "finance.view", "You don't have access to the transactions report.");
  checkParams(params);
  return withTenant(actor, async (tx) => {
    const { timezone } = await universityLite(tx);
    const at = sql`coalesce(${invoices.issuedAt}, ${orders.paidAt}, ${orders.createdAt})`;
    const where: (SQL | undefined)[] = [batchInReach(r, batches.id, batches.departmentId), ...batchFilters(params)];
    if (params.from) where.push(sql`${at} >= ${dayStart(params.from, timezone)}`);
    if (params.to) where.push(sql`${at} < ${dayAfter(params.to, timezone)}`);

    const rows = await tx
      .select({
        date: sql<string>`to_char(${at} at time zone ${timezone}, 'YYYY-MM-DD')`,
        invoice: invoices.number,
        student: users.name,
        email: users.email,
        department: departments.name,
        course: courses.title,
        batch: batches.name,
        status: orders.status,
        taxableValue: invoices.basePaise,
        cgst: invoices.cgstPaise,
        sgst: invoices.sgstPaise,
        igst: invoices.igstPaise,
        total: invoices.totalPaise,
        orderTotal: orders.totalPaise,
        paymentReference: orders.gatewayPaymentId,
      })
      .from(orders)
      .innerJoin(batches, eq(batches.id, orders.batchId))
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .innerJoin(departments, eq(departments.id, batches.departmentId))
      .innerJoin(users, eq(users.id, orders.userId))
      .leftJoin(invoices, eq(invoices.orderId, orders.id))
      .where(and(...where))
      .orderBy(desc(at), asc(invoices.number), asc(orders.id));

    return {
      columns: TRANSACTION_COLUMNS,
      rows: rows.map(({ orderTotal, ...row }) => ({
        ...row,
        status: ORDER_STATUS[row.status] ?? row.status,
        refund: row.status === "refunded" ? orderTotal : null,
      })),
    };
  });
}

export const transactionsReport: ReportDefinition = {
  id: TRANSACTIONS_REPORT,
  label: "Transactions",
  description: "Orders with their GST invoice number, taxable value, CGST, SGST, IGST, total, status and refunds.",
  action: "finance.view",
  filters: ["dateRange", "department", "course", "batch"],
  run: runTransactions,
};

export const coreReports: ReportDefinition[] = [enrolmentsReport, transactionsReport];
