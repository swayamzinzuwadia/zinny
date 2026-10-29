/**
 * Zinny billing (platform.finance): Zinny's own GST invoices to universities for their
 * licences: number, period, amount, GST, due date, paid or unpaid. Separate from the
 * universities' invoices to their students.
 */
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { universities, users } from "@/db/schema";
import { assertPlatform, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { platInvoiceCounters, platInvoices, platLicences } from "../schema";
import { DEFAULT_GST_BP, DEFAULT_PAYMENT_DAYS, GST_RATES_BP, PLAN_LABELS, zinnySeller, type Plan } from "../lib/constants";
import { addDays, financialYear, financialYearStart, formatDate, isDate, todayIST } from "../lib/format";
import { db, isUuid, logAction, universityOrThrow } from "./shared";

export type Invoice = typeof platInvoices.$inferSelect;

export function gstFor(basePaise: number, rateBp: number) {
  return Math.round((basePaise * rateBp) / 10_000);
}

/** Same state as Zinny → CGST + SGST, half each. Another state → IGST. */
export function splitGst(gstPaise: number, intraState: boolean) {
  if (!intraState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise };
  const cgstPaise = Math.floor(gstPaise / 2);
  return { cgstPaise, sgstPaise: gstPaise - cgstPaise, igstPaise: 0 };
}

/** Next number in the financial year of `issueDate`: "ZNY/26-27/0001" (16 characters at most, as GST requires). */
export async function nextInvoiceNumber(tx: Tx, issueDate: string) {
  const fy = financialYear(issueDate);
  const [row] = await tx
    .insert(platInvoiceCounters)
    .values({ financialYear: fy, lastSeq: 1 })
    .onConflictDoUpdate({ target: platInvoiceCounters.financialYear, set: { lastSeq: sql`${platInvoiceCounters.lastSeq} + 1` } })
    .returning();
  return { number: `${zinnySeller().invoicePrefix}/${fy}/${String(row.lastSeq).padStart(4, "0")}`, financialYear: fy };
}

export const isOverdue = (inv: Pick<Invoice, "status" | "dueDate">, today: string) => inv.status === "unpaid" && inv.dueDate < today;

export type InvoiceFilter = "all" | "unpaid" | "overdue" | "paid";

export async function listInvoices(actor: Actor, filters: { status?: string; universityId?: string } = {}, today = todayIST()) {
  assertPlatform(actor, "platform.finance");
  const status = (["unpaid", "overdue", "paid"].includes(filters.status ?? "") ? filters.status : "all") as InvoiceFilter;
  const uni = filters.universityId && isUuid(filters.universityId) ? filters.universityId : undefined;
  const rows = await db()
    .select({ invoice: platInvoices, universityName: universities.name })
    .from(platInvoices)
    .innerJoin(universities, eq(universities.id, platInvoices.universityId))
    .where(
      and(
        uni ? eq(platInvoices.universityId, uni) : undefined,
        status === "paid" ? eq(platInvoices.status, "paid") : undefined,
        status === "unpaid" ? eq(platInvoices.status, "unpaid") : undefined,
        status === "overdue" ? and(eq(platInvoices.status, "unpaid"), lt(platInvoices.dueDate, today)) : undefined,
      ),
    )
    .orderBy(desc(platInvoices.issueDate), desc(platInvoices.number))
    .limit(500);
  const fyStart = financialYearStart(today);
  const [s] = await db()
    .select({
      outstanding: sql<number>`coalesce(sum(${platInvoices.totalPaise}) filter (where ${platInvoices.status} = 'unpaid'), 0)`.mapWith(Number),
      unpaidCount: sql<number>`count(*) filter (where ${platInvoices.status} = 'unpaid')`.mapWith(Number),
      overdue: sql<number>`coalesce(sum(${platInvoices.totalPaise}) filter (where ${platInvoices.status} = 'unpaid' and ${platInvoices.dueDate} < ${today}), 0)`.mapWith(Number),
      overdueCount: sql<number>`count(*) filter (where ${platInvoices.status} = 'unpaid' and ${platInvoices.dueDate} < ${today})`.mapWith(Number),
      collectedFy: sql<number>`coalesce(sum(${platInvoices.totalPaise}) filter (where ${platInvoices.status} = 'paid' and ${platInvoices.paidOn} >= ${fyStart}), 0)`.mapWith(Number),
    })
    .from(platInvoices)
    .where(uni ? eq(platInvoices.universityId, uni) : undefined);
  return {
    filter: status,
    invoices: rows.map((r) => ({ ...r.invoice, universityName: r.universityName, overdue: isOverdue(r.invoice, today) })),
    summary: { ...s, financialYear: financialYear(today) },
  };
}

export type NewInvoiceInput = {
  universityId: string;
  periodStart: string;
  periodEnd: string;
  description: string;
  basePaise: number;
  gstRateBp: number;
  issueDate: string;
  dueDate: string;
};

/** Issues an invoice. Seller and buyer details are copied from Zinny's settings and the university now. */
export async function createInvoice(actor: Actor, input: NewInvoiceInput) {
  assertPlatform(actor, "platform.finance");
  if (!isUuid(input.universityId)) throw new ValidationError("Pick the university to invoice.");
  if (!isDate(input.periodStart) || !isDate(input.periodEnd)) throw new ValidationError("Enter the period the invoice covers.");
  if (input.periodEnd < input.periodStart) throw new ValidationError("The period must end on or after it starts.");
  const description = input.description.trim();
  if (description.length < 3) throw new ValidationError("Describe what the invoice is for, like \"Zinny Standard licence\".");
  if (description.length > 300) throw new ValidationError("Keep the description under 300 characters.");
  if (!Number.isInteger(input.basePaise) || input.basePaise <= 0) throw new ValidationError("Enter the amount before GST, in rupees.");
  if (input.basePaise > 100_00_00_000_00) throw new ValidationError("That amount is too large for one invoice.");
  if (!(GST_RATES_BP as readonly number[]).includes(input.gstRateBp)) throw new ValidationError("Pick a GST rate.");
  if (!isDate(input.issueDate)) throw new ValidationError("Enter the issue date.");
  if (!isDate(input.dueDate)) throw new ValidationError("Enter the due date.");
  if (input.dueDate < input.issueDate) throw new ValidationError("The due date can't be before the issue date.");

  const seller = zinnySeller();
  return db().transaction(async (tx) => {
    const uni = await universityOrThrow(tx, input.universityId);
    const gst = gstFor(input.basePaise, input.gstRateBp);
    const split = splitGst(gst, uni.stateCode === seller.stateCode);
    const { number, financialYear: fy } = await nextInvoiceNumber(tx, input.issueDate);
    const [inv] = await tx
      .insert(platInvoices)
      .values({
        universityId: uni.id,
        number,
        financialYear: fy,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        description,
        basePaise: input.basePaise,
        gstRateBp: input.gstRateBp,
        ...split,
        totalPaise: input.basePaise + gst,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        status: "unpaid",
        sellerName: seller.name,
        sellerGstin: seller.gstin,
        sellerStateCode: seller.stateCode,
        buyerName: uni.legalName?.trim() || uni.name,
        buyerGstin: uni.gstin,
        buyerStateCode: uni.stateCode,
        buyerAddress: uni.address,
        createdBy: actor.userId || null,
      })
      .returning();
    await logAction(tx, actor, { universityId: uni.id, inUniversityLog: true }, "plat.invoice.create", "plat_invoice", inv.id, {
      number,
      totalPaise: inv.totalPaise,
      dueDate: inv.dueDate,
    });
    return inv;
  });
}

export async function getInvoice(actor: Actor, invoiceId: string, today = todayIST()) {
  assertPlatform(actor, "platform.finance");
  if (!isUuid(invoiceId)) throw new NotFoundError("Invoice");
  const [row] = await db()
    .select({ invoice: platInvoices, universityName: universities.name, slug: universities.slug, createdByName: users.name })
    .from(platInvoices)
    .innerJoin(universities, eq(universities.id, platInvoices.universityId))
    .leftJoin(users, eq(users.id, platInvoices.createdBy))
    .where(eq(platInvoices.id, invoiceId));
  if (!row) throw new NotFoundError("Invoice");
  return { ...row.invoice, universityName: row.universityName, slug: row.slug, createdByName: row.createdByName, overdue: isOverdue(row.invoice, today) };
}

export async function markInvoicePaid(actor: Actor, invoiceId: string, input: { paidOn: string; reference: string }, today = todayIST()) {
  assertPlatform(actor, "platform.finance");
  if (!isUuid(invoiceId)) throw new NotFoundError("Invoice");
  if (!isDate(input.paidOn)) throw new ValidationError("Enter the date the money arrived.");
  if (input.paidOn > today) throw new ValidationError("The payment date can't be in the future.");
  const reference = input.reference.trim();
  if (reference.length < 3) throw new ValidationError("Enter the payment reference, like the UTR or cheque number.");
  if (reference.length > 120) throw new ValidationError("Keep the reference under 120 characters.");
  return db().transaction(async (tx) => {
    const [inv] = await tx.select().from(platInvoices).where(eq(platInvoices.id, invoiceId)).for("update");
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status === "paid") throw new ConflictError(`Invoice ${inv.number} is already marked paid.`);
    if (input.paidOn < inv.issueDate) throw new ValidationError(`The payment date can't be before the invoice was issued (${formatDate(inv.issueDate)}).`);
    const [row] = await tx
      .update(platInvoices)
      .set({ status: "paid", paidOn: input.paidOn, paymentReference: reference })
      .where(eq(platInvoices.id, invoiceId))
      .returning();
    await logAction(tx, actor, { universityId: inv.universityId, inUniversityLog: true }, "plat.invoice.paid", "plat_invoice", inv.id, {
      number: inv.number,
      paidOn: input.paidOn,
      reference,
    });
    return row;
  });
}

/** Undoes "paid" when it was recorded by mistake. Needs a reason. */
export async function markInvoiceUnpaid(actor: Actor, invoiceId: string, reason: string) {
  assertPlatform(actor, "platform.finance");
  if (!isUuid(invoiceId)) throw new NotFoundError("Invoice");
  const why = reason.trim();
  if (why.length < 5) throw new ValidationError("Write why this invoice is unpaid again.");
  return db().transaction(async (tx) => {
    const [inv] = await tx.select().from(platInvoices).where(eq(platInvoices.id, invoiceId)).for("update");
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status === "unpaid") throw new ConflictError(`Invoice ${inv.number} is already unpaid.`);
    const [row] = await tx
      .update(platInvoices)
      .set({ status: "unpaid", paidOn: null, paymentReference: null })
      .where(eq(platInvoices.id, invoiceId))
      .returning();
    await logAction(tx, actor, { universityId: inv.universityId, inUniversityLog: true }, "plat.invoice.unpaid", "plat_invoice", inv.id, {
      number: inv.number,
      reason: why,
      wasPaidOn: inv.paidOn,
      wasReference: inv.paymentReference,
    });
    return row;
  });
}

/** Sensible values for a new invoice: the university's licence term and plan, due in 15 days. */
export async function invoiceDraft(actor: Actor, universityId: string | undefined, today = todayIST()) {
  assertPlatform(actor, "platform.finance");
  const base = { universityId: "", periodStart: today, periodEnd: addDays(today, 364), description: "", gstRateBp: DEFAULT_GST_BP, issueDate: today, dueDate: addDays(today, DEFAULT_PAYMENT_DAYS) };
  if (!universityId || !isUuid(universityId)) return base;
  const [u] = await db().select({ id: universities.id, name: universities.name }).from(universities).where(eq(universities.id, universityId));
  if (!u) return base;
  const [l] = await db().select().from(platLicences).where(eq(platLicences.universityId, universityId));
  if (!l) return { ...base, universityId: u.id, description: "Zinny licence" };
  return {
    ...base,
    universityId: u.id,
    periodStart: l.startDate,
    periodEnd: l.endDate,
    description: `Zinny ${PLAN_LABELS[l.plan as Plan]} licence, up to ${l.studentCap.toLocaleString("en-IN")} students and ${l.staffCap.toLocaleString("en-IN")} staff`,
  };
}

/** Unpaid invoices past their due date, oldest first. For the platform home. */
export async function overdueInvoices(actor: Actor, today = todayIST()) {
  assertPlatform(actor, "platform.finance");
  return db()
    .select({ id: platInvoices.id, number: platInvoices.number, universityName: universities.name, totalPaise: platInvoices.totalPaise, dueDate: platInvoices.dueDate })
    .from(platInvoices)
    .innerJoin(universities, eq(universities.id, platInvoices.universityId))
    .where(and(eq(platInvoices.status, "unpaid"), lt(platInvoices.dueDate, today)))
    .orderBy(asc(platInvoices.dueDate))
    .limit(20);
}

/** Invoices for one university, newest first. */
export async function invoicesForUniversity(actor: Actor, universityId: string, today = todayIST()) {
  assertPlatform(actor, "platform.finance");
  if (!isUuid(universityId)) return [];
  const rows = await db()
    .select()
    .from(platInvoices)
    .where(eq(platInvoices.universityId, universityId))
    .orderBy(desc(platInvoices.issueDate))
    .limit(50);
  return rows.map((r) => ({ ...r, overdue: isOverdue(r, today) }));
}
