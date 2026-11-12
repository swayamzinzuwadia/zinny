/**
 * Zinny billing (platform.finance): Zinny's own GST invoices to universities for their
 * licences: number, period, amount, GST, due date, paid or unpaid. Separate from the
 * universities' invoices to their students.
 */
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { auditLog, universities, users } from "@/db/schema";
import { assertPlatform, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { platInvoiceCounters, platInvoices, platLicences } from "../schema";
import { chargeFor, gstFor, splitGst, type Charge } from "../lib/charge";
import { DEFAULT_GST_BP, DEFAULT_PAYMENT_DAYS, GST_RATES_BP, zinnySeller } from "../lib/constants";
import { addDays, financialYear, financialYearStart, formatDate, isDate, todayIST } from "../lib/format";
import { planNameFallback, planNames } from "./plans";
import { db, isUuid, logAction, universityOrThrow } from "./shared";

export type Invoice = typeof platInvoices.$inferSelect;

export { chargeFor, gstFor, splitGst, type Charge };

/** An invoice's price before discount. Invoices from before discounts existed only have the base. */
export const listPriceOf = (inv: Pick<Invoice, "listPricePaise" | "basePaise" | "discountPaise">) => inv.listPricePaise ?? inv.basePaise + inv.discountPaise;

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
  /** The price before any discount. `basePaise` is the older name for it and still works. */
  listPricePaise?: number;
  basePaise?: number;
  discountPaise?: number;
  discountNote?: string | null;
  gstRateBp: number;
  issueDate: string;
  dueDate: string;
  licenceId?: string | null;
};

const MAX_AMOUNT = 100_00_00_000_00;

type InvoiceFields = {
  periodStart: string;
  periodEnd: string;
  description: string;
  listPricePaise: number;
  discountPaise: number;
  discountNote: string | null;
  issueDate: string;
  dueDate: string;
};

/** The checks an invoice passes when it is issued and every time it is revised. */
function checkInvoiceFields(input: Omit<InvoiceFields, "discountNote"> & { discountNote?: string | null }): InvoiceFields {
  if (!isDate(input.periodStart) || !isDate(input.periodEnd)) throw new ValidationError("Enter the period the invoice covers.");
  if (input.periodEnd < input.periodStart) throw new ValidationError("The period must end on or after it starts.");
  const description = input.description.trim();
  if (description.length < 3) throw new ValidationError("Describe what the invoice is for, like \"Zinny Standard licence\".");
  if (description.length > 300) throw new ValidationError("Keep the description under 300 characters.");
  if (!Number.isInteger(input.listPricePaise) || input.listPricePaise <= 0) throw new ValidationError("Enter the amount before GST, in rupees.");
  if (input.listPricePaise > MAX_AMOUNT) throw new ValidationError("That amount is too large for one invoice.");
  if (!Number.isInteger(input.discountPaise) || input.discountPaise < 0) throw new ValidationError("Enter the discount in rupees, or leave it at 0.");
  if (input.discountPaise >= input.listPricePaise) throw new ValidationError("The discount must be less than the amount. For a free licence, don't create an invoice.");
  const discountNote = input.discountNote?.trim() || null;
  if (input.discountPaise > 0 && !discountNote) throw new ValidationError("Write why the discount was given, so finance can see it later.");
  if (discountNote && discountNote.length > 300) throw new ValidationError("Keep the discount note under 300 characters.");
  if (!isDate(input.issueDate)) throw new ValidationError("Enter the invoice date.");
  if (!isDate(input.dueDate)) throw new ValidationError("Enter the due date.");
  if (input.dueDate < input.issueDate) throw new ValidationError("The due date can't be before the invoice date.");
  return {
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    description,
    listPricePaise: input.listPricePaise,
    discountPaise: input.discountPaise,
    discountNote: input.discountPaise > 0 ? discountNote : null,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
  };
}

/**
 * Writes one invoice inside the caller's transaction and logs it. No permission check:
 * `createInvoice` (platform.finance) and `saveLicence` (platform.licences) check theirs.
 * Seller and buyer details are copied from Zinny's settings and the university now.
 */
export async function issueInvoice(tx: Tx, actor: Actor, input: NewInvoiceInput) {
  const fields = checkInvoiceFields({
    ...input,
    listPricePaise: input.listPricePaise ?? input.basePaise ?? Number.NaN,
    discountPaise: input.discountPaise ?? 0,
  });
  if (!(GST_RATES_BP as readonly number[]).includes(input.gstRateBp)) throw new ValidationError("Pick a GST rate.");
  const seller = zinnySeller();
  const uni = await universityOrThrow(tx, input.universityId);
  const charge = chargeFor(fields.listPricePaise, fields.discountPaise, input.gstRateBp, uni.stateCode === seller.stateCode);
  const { number, financialYear: fy } = await nextInvoiceNumber(tx, fields.issueDate);
  const [inv] = await tx
    .insert(platInvoices)
    .values({
      universityId: uni.id,
      number,
      financialYear: fy,
      periodStart: fields.periodStart,
      periodEnd: fields.periodEnd,
      description: fields.description,
      listPricePaise: charge.listPricePaise,
      discountPaise: charge.discountPaise,
      discountNote: fields.discountNote,
      basePaise: charge.basePaise,
      licenceId: input.licenceId ?? null,
      gstRateBp: input.gstRateBp,
      cgstPaise: charge.cgstPaise,
      sgstPaise: charge.sgstPaise,
      igstPaise: charge.igstPaise,
      totalPaise: charge.totalPaise,
      issueDate: fields.issueDate,
      dueDate: fields.dueDate,
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
    listPricePaise: charge.listPricePaise,
    discountPaise: charge.discountPaise,
    totalPaise: inv.totalPaise,
    dueDate: inv.dueDate,
    ...(inv.licenceId && { forLicence: true }),
  });
  return inv;
}

/** Issues an invoice by hand. */
export async function createInvoice(actor: Actor, input: NewInvoiceInput) {
  assertPlatform(actor, "platform.finance");
  if (!isUuid(input.universityId)) throw new ValidationError("Pick the institute to invoice.");
  return db().transaction((tx) => issueInvoice(tx, actor, input));
}

export type InvoiceRevision = {
  description: string;
  periodStart: string;
  periodEnd: string;
  listPricePaise: number;
  discountPaise: number;
  discountNote?: string | null;
  issueDate: string;
  dueDate: string;
};

const REVISABLE = ["description", "periodStart", "periodEnd", "listPricePaise", "discountPaise", "discountNote", "basePaise", "totalPaise", "issueDate", "dueDate"] as const;

/**
 * Changes an unpaid invoice: amount, discount and its note, description, period, invoice
 * date and due date. GST and the total are worked out again at the invoice's own rate and
 * state split. The number never changes. A paid invoice is locked until it is marked
 * unpaid. Each revision is logged with the values before and after.
 */
export async function reviseInvoice(actor: Actor, invoiceId: string, input: InvoiceRevision) {
  assertPlatform(actor, "platform.finance");
  if (!isUuid(invoiceId)) throw new NotFoundError("Invoice");
  const fields = checkInvoiceFields(input);
  return db().transaction(async (tx) => {
    const [inv] = await tx.select().from(platInvoices).where(eq(platInvoices.id, invoiceId)).for("update");
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status === "paid") throw new ConflictError(`Invoice ${inv.number} is paid, so it is locked. Mark it unpaid first if it needs changing.`);
    const charge = chargeFor(fields.listPricePaise, fields.discountPaise, inv.gstRateBp, inv.buyerStateCode === inv.sellerStateCode);
    const next = {
      description: fields.description,
      periodStart: fields.periodStart,
      periodEnd: fields.periodEnd,
      listPricePaise: charge.listPricePaise,
      discountPaise: charge.discountPaise,
      discountNote: fields.discountNote,
      basePaise: charge.basePaise,
      totalPaise: charge.totalPaise,
      issueDate: fields.issueDate,
      dueDate: fields.dueDate,
    };
    const was = { ...inv, listPricePaise: listPriceOf(inv) };
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of REVISABLE) {
      if (was[k] !== next[k]) {
        before[k] = was[k];
        after[k] = next[k];
      }
    }
    if (Object.keys(after).length === 0) throw new ValidationError("Nothing is different. Change a value, then save the revision.");
    const [row] = await tx
      .update(platInvoices)
      .set({ ...next, cgstPaise: charge.cgstPaise, sgstPaise: charge.sgstPaise, igstPaise: charge.igstPaise, revisedAt: new Date(), revisedBy: actor.userId || null })
      .where(eq(platInvoices.id, invoiceId))
      .returning();
    await logAction(tx, actor, { universityId: inv.universityId, inUniversityLog: true }, "plat.invoice.revise", "plat_invoice", inv.id, {
      number: inv.number,
      before,
      after,
    });
    return row;
  });
}

export type InvoiceEvent = { id: string; at: Date; action: string; byName: string | null; data: Record<string, unknown> };

/** What happened to an invoice, newest first: issued, revised, paid, unpaid. From the audit log. */
export async function invoiceHistory(actor: Actor, invoiceId: string): Promise<InvoiceEvent[]> {
  assertPlatform(actor, "platform.finance");
  if (!isUuid(invoiceId)) return [];
  const rows = await db()
    .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, byName: users.name, data: auditLog.data })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(
      and(
        eq(auditLog.entity, "plat_invoice"),
        eq(auditLog.entityId, invoiceId),
        inArray(auditLog.action, ["plat.invoice.create", "plat.invoice.revise", "plat.invoice.paid", "plat.invoice.unpaid"]),
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(50);
  return rows.map((r) => ({ ...r, data: (r.data ?? {}) as Record<string, unknown> }));
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
  return {
    ...row.invoice,
    listPricePaise: listPriceOf(row.invoice),
    universityName: row.universityName,
    slug: row.slug,
    createdByName: row.createdByName,
    overdue: isOverdue(row.invoice, today),
  };
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

/** Sensible values for a new invoice: the university's licence term, plan and price, due in 15 days. */
export async function invoiceDraft(actor: Actor, universityId: string | undefined, today = todayIST()) {
  assertPlatform(actor, "platform.finance");
  const base = {
    universityId: "",
    periodStart: today,
    periodEnd: addDays(today, 364),
    description: "",
    listPricePaise: 0,
    discountPaise: 0,
    discountNote: "",
    gstRateBp: DEFAULT_GST_BP,
    issueDate: today,
    dueDate: addDays(today, DEFAULT_PAYMENT_DAYS),
  };
  if (!universityId || !isUuid(universityId)) return base;
  const [u] = await db().select({ id: universities.id, name: universities.name }).from(universities).where(eq(universities.id, universityId));
  if (!u) return base;
  const [l] = await db().select().from(platLicences).where(eq(platLicences.universityId, universityId));
  if (!l) return { ...base, universityId: u.id, description: "Zinny licence" };
  return { ...base, universityId: u.id, ...licenceTerms(l, await planNames()) };
}

export type InvoiceTerms = { description: string; periodStart: string; periodEnd: string; listPricePaise: number; discountPaise: number; discountNote: string };

/** The line a licence's invoice carries: the plan and the period it covers. */
export function licenceInvoiceLine(planName: string, startDate: string, endDate: string) {
  return `Zinny ${planName} licence, ${formatDate(startDate)} to ${formatDate(endDate)}`;
}

function licenceTerms(l: typeof platLicences.$inferSelect, names: Record<string, string>): InvoiceTerms {
  return {
    periodStart: l.startDate,
    periodEnd: l.endDate,
    description: licenceInvoiceLine(names[l.plan] ?? planNameFallback(l.plan), l.startDate, l.endDate),
    listPricePaise: l.pricePaise,
    discountPaise: l.discountPaise,
    discountNote: l.discountNote ?? "",
  };
}

/** Each licensed university's term, description and price, so the new-invoice form can fill them in as you pick. */
export async function invoiceTermsByUniversity(actor: Actor): Promise<Record<string, InvoiceTerms>> {
  assertPlatform(actor, "platform.finance");
  const [rows, names] = await Promise.all([db().select().from(platLicences), planNames()]);
  return Object.fromEntries(rows.map((l) => [l.universityId, licenceTerms(l, names)]));
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

/**
 * The invoices raised for one licence, newest first, for the licence page. Anyone who can
 * open the licence sees what it was charged; opening an invoice still needs platform.finance.
 */
export async function invoicesForLicence(actor: Actor, licenceId: string, today = todayIST()) {
  assertPlatform(actor, "platform.licences");
  if (!isUuid(licenceId)) return [];
  const rows = await db()
    .select()
    .from(platInvoices)
    .where(eq(platInvoices.licenceId, licenceId))
    .orderBy(desc(platInvoices.issueDate), desc(platInvoices.number))
    .limit(50);
  return rows.map((r) => ({ ...r, listPricePaise: listPriceOf(r), overdue: isOverdue(r, today) }));
}
