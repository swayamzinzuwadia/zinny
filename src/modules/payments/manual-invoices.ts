/**
 * Invoices the institute raises itself (Finance → Invoices): exam fees, hostel, a
 * workshop, a course fee taken in cash. Everything outside checkout.
 *
 *  - Numbers come from core's invoice counter (`nextInvoiceNumber`), the same sequence
 *    order invoices use, so numbers never collide, never repeat and stay within GST's
 *    16 characters. A cancelled invoice keeps its number.
 *  - Billed to someone with an account here (they see it under Invoices and are
 *    notified), or to anyone else by name.
 *  - GST: the rate starts from the category and can be changed per invoice. CGST + SGST
 *    when the buyer's state is the institute's, IGST otherwise (core `splitGst`). With GST
 *    turned off for the institute, the invoice carries no tax at all. The seller details,
 *    the GST choice, rate and SAC code are copied onto the invoice when it's issued, so
 *    changing settings later never alters it.
 *  - Status: unpaid → paid (date, mode, reference) → unpaid again if the payment is taken
 *    back; unpaid → cancelled (reason needed, final). Overdue = unpaid past its due date.
 *    Only an unpaid invoice can be edited.
 *
 * Viewing needs `finance.view`; creating and changing need `finance.manage`. Every write
 * is audited, edits with before and after.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { auditLog, roleAssignments, users } from "@/db/schema";
import { assertCan, audit, can, nextInvoiceNumber, notify, todayIn, withTenant, type Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { COURSE_FEES_ID, COURSE_FEES_NAME, GST_RATES_BP } from "./categories";
import { UUID_RE, uni, universityRow } from "./internal";
import { GST_STATES, inr, invoiceAmounts } from "./money";
import { invoiceDate, renderInvoicePdf, type InvoicePdfData } from "./pdf/invoice-pdf";
import { PAYMENT_MODES, payInvoiceCategories, payManualInvoiceLines, payManualInvoices, type PaymentMode } from "./schema";
import { settingsFor } from "./settings";

export type ManualInvoiceRow = typeof payManualInvoices.$inferSelect;
export type ManualInvoiceLine = typeof payManualInvoiceLines.$inferSelect;
export type ManualStatus = ManualInvoiceRow["status"];

export const MODE_LABEL: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

export const MAX_LINES = 12;
export const LINE_MAX = 120;
export const NOTES_MAX = 500;
/** Integer paise in a 32-bit column: ₹2 crore per invoice is the ceiling. */
export const MAX_TOTAL_PAISE = 2_000_000_000;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{13}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validDate(d: string) {
  if (!DATE.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

export type LineInput = { description: string; quantity: number; unitPricePaise: number };

export type InvoiceInput = {
  /** A category id, or "course-fees" (or empty) for the built-in one. */
  categoryId?: string | null;
  /** Someone with an account in this institute; their name and email are used. */
  userId?: string | null;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  buyerAddress?: string;
  buyerGstin?: string;
  /** The buyer's GST state code; the institute's state when left out. */
  placeOfSupply?: string;
  lines: LineInput[];
  discountPaise?: number;
  discountNote?: string;
  /** Ignored (0) when the institute has GST turned off. Defaults to the category's rate. */
  gstRateBp?: number;
  /** "YYYY-MM-DD"; today when left out. */
  issueDate?: string;
  dueDate?: string | null;
  notes?: string;
};

function cleanLines(lines: LineInput[]) {
  const kept = lines.filter((l) => l.description.trim() || l.unitPricePaise > 0);
  if (kept.length === 0) throw new ValidationError("Add at least one line: what you're charging for and its price.");
  if (kept.length > MAX_LINES) throw new ValidationError(`An invoice holds up to ${MAX_LINES} lines. Combine some, or raise a second invoice.`);
  return kept.map((l, i) => {
    const description = l.description.replace(/\s+/g, " ").trim();
    if (!description) throw new ValidationError(`Line ${i + 1} has a price but no description. Say what it's for.`);
    if (description.length > LINE_MAX) throw new ValidationError(`Keep the description of line ${i + 1} under ${LINE_MAX} characters.`);
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 9999) throw new ValidationError(`The quantity on line ${i + 1} must be a whole number from 1 to 9,999.`);
    if (!Number.isSafeInteger(l.unitPricePaise) || l.unitPricePaise < 0) throw new ValidationError(`Enter the price on line ${i + 1} in rupees, like 1500 or 1500.50.`);
    return { description, quantity: l.quantity, unitPricePaise: l.unitPricePaise, amountPaise: l.quantity * l.unitPricePaise };
  });
}

function cleanMoney(lines: ReturnType<typeof cleanLines>, input: { discountPaise?: number; discountNote?: string }) {
  const subtotal = lines.reduce((n, l) => n + l.amountPaise, 0);
  if (subtotal <= 0) throw new ValidationError("The lines add up to nothing. Enter a price on at least one line.");
  if (subtotal > MAX_TOTAL_PAISE) throw new ValidationError("One invoice can bill up to ₹2,00,00,000. Split this across two invoices.");
  const discountPaise = input.discountPaise ?? 0;
  if (!Number.isSafeInteger(discountPaise) || discountPaise < 0) throw new ValidationError("Enter the discount in rupees, like 500. Leave it empty for no discount.");
  if (discountPaise >= subtotal) throw new ValidationError(`The discount (${inr(discountPaise)}) must be less than the lines add up to (${inr(subtotal)}).`);
  const discountNote = (input.discountNote ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return { discountPaise, discountNote: discountPaise > 0 ? discountNote : "" };
}

function cleanDates(input: { issueDate: string; dueDate?: string | null }, today: string) {
  if (!validDate(input.issueDate)) throw new ValidationError("Pick the invoice date.");
  if (input.issueDate > today) throw new ValidationError("The invoice date can't be in the future. Use today's date or an earlier one.");
  const dueDate = input.dueDate?.trim() || null;
  if (dueDate) {
    if (!validDate(dueDate)) throw new ValidationError("Pick a valid due date, or leave it empty.");
    if (dueDate < input.issueDate) throw new ValidationError("The due date is before the invoice date. Pick the same day or a later one.");
  }
  return { issueDate: input.issueDate, dueDate };
}

const cleanNotes = (notes?: string) => {
  const n = (notes ?? "").replace(/\r\n/g, "\n").trim();
  if (n.length > NOTES_MAX) throw new ValidationError(`Keep the notes under ${NOTES_MAX} characters so they fit on the invoice.`);
  return n;
};

/** Whether an unpaid invoice is past its due date today. */
export function isOverdue(i: { status: string; dueDate: string | null }, today: string) {
  return i.status === "unpaid" && !!i.dueDate && i.dueDate < today;
}

export type BillablePerson = { id: string; name: string; email: string; phone: string | null; role: string };

/** People with a role in this institute matching a name or email, students first, for "Bill to". Needs `finance.manage`. */
export async function searchBillable(actor: Actor, q: string): Promise<BillablePerson[]> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, role: roleAssignments.role })
      .from(users)
      .innerJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), eq(roleAssignments.universityId, uni(actor)), isNull(roleAssignments.revokedAt)))
      .where(or(ilike(users.name, like), ilike(users.email, like)))
      .orderBy(asc(users.name))
      .limit(60);
    const rank = (r: string) => (r === "student" ? 0 : r === "alumni" || r === "individual_learner" ? 1 : r === "parent" ? 2 : 3);
    const best = new Map<string, BillablePerson>();
    for (const r of rows) {
      const had = best.get(r.id);
      if (!had || rank(r.role) < rank(had.role)) best.set(r.id, r);
    }
    return [...best.values()].sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name)).slice(0, 8);
  });
}

async function billTo(tx: Tx, actor: Actor, input: InvoiceInput, sellerState: string, gstOn: boolean) {
  let userId: string | null = null;
  let name = (input.buyerName ?? "").replace(/\s+/g, " ").trim();
  let email = (input.buyerEmail ?? "").trim().toLowerCase();
  let phone = (input.buyerPhone ?? "").replace(/\s+/g, " ").trim();
  if (input.userId) {
    if (!UUID_RE.test(input.userId)) throw new ValidationError("Pick the person again from the search results.");
    const [person] = await tx
      .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
      .from(users)
      .innerJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), eq(roleAssignments.universityId, uni(actor))))
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!person) throw new ValidationError("That person isn't part of this institute. Search for them again, or type their details in.");
    userId = person.id;
    name = person.name;
    email = person.email;
    phone = phone || person.phone || "";
  } else {
    if (name.length < 2) throw new ValidationError("Say who the invoice is for: pick a student, or type the name of the person or organisation.");
    if (name.length > 120) throw new ValidationError("Keep the name under 120 characters.");
    if (email && !EMAIL_RE.test(email)) throw new ValidationError("That email address doesn't look right. Check it, or leave it empty.");
  }
  if (phone.length > 20) throw new ValidationError("Keep the phone number under 20 characters.");
  const address = (input.buyerAddress ?? "").replace(/\r\n/g, "\n").trim();
  if (address.length > 300) throw new ValidationError("Keep the address under 300 characters.");
  const placeOfSupply = (input.placeOfSupply ?? "").trim() || sellerState;
  if (!GST_STATES[placeOfSupply]) throw new ValidationError("Pick the buyer's state from the list.");
  const gstin = gstOn ? (input.buyerGstin ?? "").replace(/\s+/g, "").toUpperCase() : "";
  if (gstin) {
    if (!GSTIN_RE.test(gstin)) throw new ValidationError("A GSTIN has 15 characters and starts with the 2-digit state code, like 27ABCDE1234F1Z5. Check it, or leave it empty.");
    if (gstin.slice(0, 2) !== placeOfSupply) {
      throw new ValidationError(`This GSTIN is registered in ${GST_STATES[gstin.slice(0, 2)] ?? `state ${gstin.slice(0, 2)}`}, but the buyer's state is ${GST_STATES[placeOfSupply]}. Make the two match.`);
    }
  }
  return { userId, buyerName: name, buyerEmail: email || null, buyerPhone: phone || null, buyerAddress: address || null, buyerGstin: gstin || null, placeOfSupply };
}

async function loadForUpdate(tx: Tx, id: string): Promise<ManualInvoiceRow> {
  if (!UUID_RE.test(id)) throw new NotFoundError("Invoice");
  const [row] = await tx.select().from(payManualInvoices).where(eq(payManualInvoices.id, id)).for("update");
  if (!row) throw new NotFoundError("Invoice");
  return row;
}

const linesOf = (tx: Tx, invoiceId: string) => tx.select().from(payManualInvoiceLines).where(eq(payManualInvoiceLines.invoiceId, invoiceId)).orderBy(asc(payManualInvoiceLines.position));

/**
 * Issues an invoice. Needs `finance.manage`. Takes the next number from the shared
 * invoice counter, and notifies the person billed when they have an account here.
 */
export async function createManualInvoice(actor: Actor, input: InvoiceInput): Promise<ManualInvoiceRow> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  const lines = cleanLines(input.lines);
  const money = cleanMoney(lines, input);
  const notes = cleanNotes(input.notes);
  return withTenant(actor, async (tx) => {
    const u = await universityRow(tx);
    const today = todayIn(u.timezone);
    const dates = cleanDates({ issueDate: input.issueDate?.trim() || today, dueDate: input.dueDate }, today);

    let categoryId: string | null = null;
    let categoryName = COURSE_FEES_NAME;
    let categoryRate = 1800;
    let categorySac: string | null = null;
    if (input.categoryId && input.categoryId !== COURSE_FEES_ID) {
      const [c] = UUID_RE.test(input.categoryId) ? await tx.select().from(payInvoiceCategories).where(eq(payInvoiceCategories.id, input.categoryId)) : [];
      if (!c) throw new ValidationError("Pick a category from the list.");
      if (c.archivedAt) throw new ValidationError(`${c.name} is archived, so it can't be used for a new invoice. Pick another category, or restore it first.`);
      categoryId = c.id;
      categoryName = c.name;
      categoryRate = c.defaultGstRateBp;
      categorySac = c.sacCode;
    }

    const gstApplied = u.gstEnabled;
    const gstRateBp = gstApplied ? (input.gstRateBp ?? categoryRate) : 0;
    if (!(GST_RATES_BP as readonly number[]).includes(gstRateBp)) throw new ValidationError("Pick a GST rate of 0, 5, 12, 18 or 28%.");
    const buyer = await billTo(tx, actor, input, u.stateCode, gstApplied);
    const amounts = invoiceAmounts({ lines, discountPaise: money.discountPaise, gstRateBp, intraState: buyer.placeOfSupply === u.stateCode });
    if (amounts.totalPaise > MAX_TOTAL_PAISE) throw new ValidationError("One invoice can bill up to ₹2,00,00,000. Split this across two invoices.");
    const settings = await settingsFor(tx, u.id);

    const { number, financialYear } = await nextInvoiceNumber(tx, u.id, u.invoicePrefix, dates.issueDate);
    const [inv] = await tx
      .insert(payManualInvoices)
      .values({
        universityId: u.id,
        number,
        financialYear,
        categoryId,
        ...buyer,
        sellerName: u.legalName ?? u.name,
        sellerGstin: gstApplied ? u.gstin : null,
        sellerAddress: u.address,
        sellerStateCode: u.stateCode,
        gstApplied,
        gstRateBp,
        sacCode: gstApplied ? (categorySac ?? settings.sacCode) : null,
        subtotalPaise: amounts.subtotalPaise,
        discountPaise: money.discountPaise,
        discountNote: money.discountNote,
        taxablePaise: amounts.taxablePaise,
        cgstPaise: amounts.cgstPaise,
        sgstPaise: amounts.sgstPaise,
        igstPaise: amounts.igstPaise,
        totalPaise: amounts.totalPaise,
        ...dates,
        notes,
        createdBy: actor.userId || null,
      })
      .returning();
    await tx.insert(payManualInvoiceLines).values(lines.map((l, i) => ({ universityId: u.id, invoiceId: inv.id, position: i + 1, ...l })));
    await audit(tx, actor, "manual_invoice.create", "pay_manual_invoice", inv.id, {
      number,
      category: categoryName,
      buyer: buyer.buyerName,
      userId: buyer.userId,
      totalPaise: inv.totalPaise,
      gstApplied,
      gstRateBp,
      dueDate: dates.dueDate,
      lines: lines.length,
    });
    if (buyer.userId) {
      await notify(tx, u.id, [buyer.userId], {
        kind: "payments.invoice",
        title: `New invoice ${number} for ${inr(inv.totalPaise)}`,
        body: `${categoryName}: ${lines[0].description}${lines.length > 1 ? ` and ${lines.length - 1} more` : ""}.${dates.dueDate ? ` Due by ${invoiceDate(dates.dueDate)}.` : ""}`,
        data: { manualInvoiceId: inv.id, number },
      });
    }
    return inv;
  });
}

export type InvoiceEdit = { lines: LineInput[]; discountPaise?: number; discountNote?: string; issueDate: string; dueDate?: string | null; notes?: string };

/**
 * Changes the dates, lines, discount and notes of an unpaid invoice. Needs
 * `finance.manage`. The number, who it's billed to, the GST choice and rate stay as
 * issued; a paid invoice must be marked unpaid first, and a cancelled one is final.
 */
export async function updateManualInvoice(actor: Actor, id: string, input: InvoiceEdit): Promise<ManualInvoiceRow> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  const lines = cleanLines(input.lines);
  const money = cleanMoney(lines, input);
  const notes = cleanNotes(input.notes);
  return withTenant(actor, async (tx) => {
    const before = await loadForUpdate(tx, id);
    if (before.status === "paid") throw new ValidationError("This invoice is paid, so it's locked. Mark it unpaid first if it needs changing.");
    if (before.status === "cancelled") throw new ValidationError("A cancelled invoice can't be changed. Create a new invoice instead.");
    const u = await universityRow(tx);
    const dates = cleanDates(input, todayIn(u.timezone));
    const { financialYear } = fyOf(dates.issueDate);
    if (financialYear !== before.financialYear) {
      throw new ValidationError(`Invoice ${before.number} belongs to financial year 20${before.financialYear}. Keep the invoice date inside it (1 April to 31 March), or cancel this and create a new invoice.`);
    }
    const oldLines = await linesOf(tx, id);
    const amounts = invoiceAmounts({ lines, discountPaise: money.discountPaise, gstRateBp: before.gstRateBp, intraState: before.placeOfSupply === before.sellerStateCode });
    if (amounts.totalPaise > MAX_TOTAL_PAISE) throw new ValidationError("One invoice can bill up to ₹2,00,00,000. Split this across two invoices.");
    await tx.delete(payManualInvoiceLines).where(eq(payManualInvoiceLines.invoiceId, id));
    await tx.insert(payManualInvoiceLines).values(lines.map((l, i) => ({ universityId: before.universityId, invoiceId: id, position: i + 1, ...l })));
    const [row] = await tx
      .update(payManualInvoices)
      .set({
        subtotalPaise: amounts.subtotalPaise,
        discountPaise: money.discountPaise,
        discountNote: money.discountNote,
        taxablePaise: amounts.taxablePaise,
        cgstPaise: amounts.cgstPaise,
        sgstPaise: amounts.sgstPaise,
        igstPaise: amounts.igstPaise,
        totalPaise: amounts.totalPaise,
        ...dates,
        notes,
        updatedAt: new Date(),
      })
      .where(eq(payManualInvoices.id, id))
      .returning();
    const snap = (i: ManualInvoiceRow, ls: { description: string; quantity: number; unitPricePaise: number }[]) => ({
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      discountPaise: i.discountPaise,
      discountNote: i.discountNote,
      notes: i.notes,
      totalPaise: i.totalPaise,
      lines: ls.map((l) => ({ description: l.description, quantity: l.quantity, unitPricePaise: l.unitPricePaise })),
    });
    await audit(tx, actor, "manual_invoice.update", "pay_manual_invoice", id, { number: before.number, before: snap(before, oldLines), after: snap(row, lines) });
    return row;
  });
}

function fyOf(date: string) {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return { financialYear: `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}` };
}

/** Marks an unpaid invoice paid. Needs `finance.manage`. */
export async function recordManualPayment(actor: Actor, id: string, input: { paidOn: string; mode: string; reference?: string }): Promise<ManualInvoiceRow> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  if (!(PAYMENT_MODES as readonly string[]).includes(input.mode)) throw new ValidationError("Pick how it was paid: cash, UPI, bank transfer, cheque, card or other.");
  const mode = input.mode as PaymentMode;
  const reference = (input.reference ?? "").replace(/\s+/g, " ").trim();
  if (reference.length > 80) throw new ValidationError("Keep the payment reference under 80 characters.");
  if (!reference && (mode === "upi" || mode === "bank_transfer" || mode === "cheque")) {
    throw new ValidationError(`Add the ${mode === "cheque" ? "cheque number" : mode === "upi" ? "UPI transaction id" : "bank reference (UTR)"} so this payment can be traced later.`);
  }
  return withTenant(actor, async (tx) => {
    const before = await loadForUpdate(tx, id);
    if (before.status === "paid") throw new ValidationError("This invoice is already marked paid.");
    if (before.status === "cancelled") throw new ValidationError("A cancelled invoice can't take a payment. Create a new invoice instead.");
    const u = await universityRow(tx);
    if (!validDate(input.paidOn)) throw new ValidationError("Pick the date the payment came in.");
    if (input.paidOn > todayIn(u.timezone)) throw new ValidationError("The payment date can't be in the future.");
    if (input.paidOn < before.issueDate) throw new ValidationError(`The payment date is before the invoice date (${invoiceDate(before.issueDate)}). Pick that day or a later one.`);
    const [row] = await tx
      .update(payManualInvoices)
      .set({ status: "paid", paidOn: input.paidOn, paymentMode: mode, paymentReference: reference || null, paymentRecordedBy: actor.userId || null, updatedAt: new Date() })
      .where(eq(payManualInvoices.id, id))
      .returning();
    await audit(tx, actor, "manual_invoice.paid", "pay_manual_invoice", id, { number: before.number, paidOn: input.paidOn, mode, reference: reference || null, totalPaise: before.totalPaise });
    return row;
  });
}

/** Takes a recorded payment back (a bounced cheque, a wrong entry): the invoice is unpaid and editable again. Needs `finance.manage`. */
export async function markManualUnpaid(actor: Actor, id: string): Promise<ManualInvoiceRow> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const before = await loadForUpdate(tx, id);
    if (before.status === "unpaid") throw new ValidationError("This invoice is already unpaid.");
    if (before.status === "cancelled") throw new ValidationError("A cancelled invoice can't be reopened. Create a new invoice instead.");
    const [row] = await tx
      .update(payManualInvoices)
      .set({ status: "unpaid", paidOn: null, paymentMode: null, paymentReference: null, paymentRecordedBy: null, updatedAt: new Date() })
      .where(eq(payManualInvoices.id, id))
      .returning();
    await audit(tx, actor, "manual_invoice.unpaid", "pay_manual_invoice", id, {
      number: before.number,
      before: { paidOn: before.paidOn, mode: before.paymentMode, reference: before.paymentReference },
    });
    return row;
  });
}

/** Cancels an unpaid invoice. Needs `finance.manage` and a reason. It stays in the list and keeps its number. */
export async function cancelManualInvoice(actor: Actor, id: string, reason: string): Promise<ManualInvoiceRow> {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  const why = reason.replace(/\s+/g, " ").trim();
  if (why.length < 3) throw new ValidationError("Say why this invoice is being cancelled, so anyone reading the list later understands.");
  if (why.length > 200) throw new ValidationError("Keep the reason under 200 characters.");
  return withTenant(actor, async (tx) => {
    const before = await loadForUpdate(tx, id);
    if (before.status === "cancelled") throw new ValidationError("This invoice is already cancelled.");
    if (before.status === "paid") throw new ValidationError("This invoice is paid. Mark it unpaid first, then cancel it.");
    const [row] = await tx
      .update(payManualInvoices)
      .set({ status: "cancelled", cancelReason: why, cancelledAt: new Date(), cancelledBy: actor.userId || null, updatedAt: new Date() })
      .where(eq(payManualInvoices.id, id))
      .returning();
    await audit(tx, actor, "manual_invoice.cancel", "pay_manual_invoice", id, { number: before.number, reason: why, totalPaise: before.totalPaise });
    if (before.userId) {
      await notify(tx, before.universityId, [before.userId], {
        kind: "payments.invoice",
        title: `Invoice ${before.number} was cancelled`,
        body: `Nothing is payable on it. Reason: ${why}`,
        data: { manualInvoiceId: id, number: before.number },
      });
    }
    return row;
  });
}

export type ManualInvoiceDetail = {
  invoice: ManualInvoiceRow;
  lines: ManualInvoiceLine[];
  category: { id: string; name: string; archived: boolean };
  overdue: boolean;
  today: string;
  canManage: boolean;
  history: { at: Date; action: string; by: string | null; data: Record<string, unknown> }[];
};

async function categoryOf(tx: Tx, categoryId: string | null) {
  if (!categoryId) return { id: COURSE_FEES_ID, name: COURSE_FEES_NAME, archived: false };
  const [c] = await tx.select().from(payInvoiceCategories).where(eq(payInvoiceCategories.id, categoryId));
  return c ? { id: c.id, name: c.name, archived: c.archivedAt !== null } : { id: categoryId, name: "Uncategorised", archived: true };
}

/** One invoice with its lines, category and history. Needs `finance.view`. */
export async function getManualInvoice(actor: Actor, id: string): Promise<ManualInvoiceDetail> {
  assertCan(actor, "finance.view", { universityId: uni(actor) });
  if (!UUID_RE.test(id)) throw new NotFoundError("Invoice");
  return withTenant(actor, async (tx) => {
    const [invoice] = await tx.select().from(payManualInvoices).where(eq(payManualInvoices.id, id));
    if (!invoice) throw new NotFoundError("Invoice");
    const u = await universityRow(tx);
    const today = todayIn(u.timezone);
    const history = await tx
      .select({ at: auditLog.at, action: auditLog.action, by: users.name, data: auditLog.data })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(eq(auditLog.entity, "pay_manual_invoice"), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.at))
      .limit(30);
    return {
      invoice,
      lines: await linesOf(tx, id),
      category: await categoryOf(tx, invoice.categoryId),
      overdue: isOverdue(invoice, today),
      today,
      canManage: can(actor, "finance.manage", { universityId: uni(actor) }),
      history: history.map((h) => ({ ...h, data: (h.data ?? {}) as Record<string, unknown> })),
    };
  });
}

/** Everything the PDF needs for a manual invoice, from what was copied onto it at issue. */
export async function manualPdfData(tx: Tx, invoice: ManualInvoiceRow): Promise<InvoicePdfData> {
  const u = await universityRow(tx);
  const lines = await linesOf(tx, invoice.id);
  const category = await categoryOf(tx, invoice.categoryId);
  const settings = await settingsFor(tx, invoice.universityId);
  return {
    seller: { legalName: invoice.sellerName, tradeName: u.name, address: invoice.sellerAddress, gstin: invoice.sellerGstin, stateCode: invoice.sellerStateCode },
    invoice: { number: invoice.number, date: invoice.issueDate, placeOfSupply: invoice.placeOfSupply, dueDate: invoice.dueDate, category: category.name },
    buyer: { name: invoice.buyerName, email: invoice.buyerEmail, phone: invoice.buyerPhone, address: invoice.buyerAddress, gstin: invoice.buyerGstin },
    gst: invoice.gstApplied,
    line: { course: category.name, batch: "", sac: invoice.sacCode ?? "", basePaise: invoice.taxablePaise },
    items: lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPricePaise: l.unitPricePaise, amountPaise: l.amountPaise })),
    discount: { paise: invoice.discountPaise, note: invoice.discountNote },
    tax: { cgstPaise: invoice.cgstPaise, sgstPaise: invoice.sgstPaise, igstPaise: invoice.igstPaise, ratePercent: invoice.gstRateBp / 100 },
    totalPaise: invoice.totalPaise,
    payment: { paidOn: invoice.paidOn, reference: invoice.paymentReference, orderRef: invoice.number },
    manual: {
      status: invoice.status,
      overdue: isOverdue(invoice, todayIn(u.timezone)),
      paidOn: invoice.paidOn,
      mode: invoice.paymentMode ? MODE_LABEL[invoice.paymentMode] : null,
      reference: invoice.paymentReference,
      cancelReason: invoice.cancelReason,
    },
    notes: invoice.notes,
    footer: settings.invoiceFooter,
  };
}

/**
 * A manual invoice as a PDF, rendered as it stands now (its status can still change).
 * For staff with `finance.view`, or the person it's billed to with `self.view_invoices`.
 * Returns null when there's no such invoice for this actor, so ids don't leak.
 */
export async function manualInvoicePdf(tx: Tx, actor: Actor, id: string): Promise<{ number: string; bytes: Uint8Array } | null> {
  const [invoice] = await tx.select().from(payManualInvoices).where(eq(payManualInvoices.id, id));
  if (!invoice) return null;
  const own = invoice.userId === actor.userId && can(actor, "self.view_invoices", { universityId: uni(actor), ownerUserId: actor.userId });
  if (!own && !can(actor, "finance.view", { universityId: uni(actor) })) return null;
  return { number: invoice.number, bytes: await renderInvoicePdf(await manualPdfData(tx, invoice)) };
}

export type MyManualInvoice = {
  id: string;
  number: string;
  issuedOn: string;
  dueDate: string | null;
  category: string;
  title: string;
  totalPaise: number;
  gstPaise: number;
  status: ManualStatus;
  overdue: boolean;
  paidOn: string | null;
};

/** Manual invoices billed to the learner, newest first (inside an open tenant transaction; the caller checks `self.view_invoices`). */
export async function myManualInvoicesIn(tx: Tx, actor: Actor, today: string): Promise<MyManualInvoice[]> {
  const rows = await tx
    .select({ i: payManualInvoices, category: payInvoiceCategories.name })
    .from(payManualInvoices)
    .leftJoin(payInvoiceCategories, eq(payInvoiceCategories.id, payManualInvoices.categoryId))
    .where(eq(payManualInvoices.userId, actor.userId))
    .orderBy(desc(payManualInvoices.issueDate), desc(payManualInvoices.createdAt));
  if (rows.length === 0) return [];
  const lines = await tx
    .select({ invoiceId: payManualInvoiceLines.invoiceId, description: payManualInvoiceLines.description, position: payManualInvoiceLines.position })
    .from(payManualInvoiceLines)
    .where(inArray(payManualInvoiceLines.invoiceId, rows.map((r) => r.i.id)))
    .orderBy(asc(payManualInvoiceLines.position));
  return rows.map(({ i, category }) => {
    const mine = lines.filter((l) => l.invoiceId === i.id);
    return {
      id: i.id,
      number: i.number,
      issuedOn: i.issueDate,
      dueDate: i.dueDate,
      category: category ?? COURSE_FEES_NAME,
      title: mine.length > 1 ? `${mine[0].description} and ${mine.length - 1} more` : (mine[0]?.description ?? category ?? COURSE_FEES_NAME),
      totalPaise: i.totalPaise,
      gstPaise: i.cgstPaise + i.sgstPaise + i.igstPaise,
      status: i.status,
      overdue: isOverdue(i, today),
      paidOn: i.paidOn,
    };
  });
}

/** What the invoice form needs: live categories, the GST choice, the institute's state, today and a default due date a week out. Needs `finance.manage`. */
export async function invoiceFormContext(actor: Actor) {
  assertCan(actor, "finance.manage", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const u = await universityRow(tx);
    const today = todayIn(u.timezone);
    const due = new Date(`${today}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 7);
    const categories = await tx
      .select({ id: payInvoiceCategories.id, name: payInvoiceCategories.name, defaultGstRateBp: payInvoiceCategories.defaultGstRateBp })
      .from(payInvoiceCategories)
      .where(isNull(payInvoiceCategories.archivedAt))
      .orderBy(asc(sql`lower(${payInvoiceCategories.name})`));
    return {
      gstEnabled: u.gstEnabled,
      sellerState: u.stateCode,
      states: Object.entries(GST_STATES)
        .map(([code, name]) => ({ code, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      today,
      defaultDueDate: due.toISOString().slice(0, 10),
      categories: [...categories, { id: COURSE_FEES_ID, name: COURSE_FEES_NAME, defaultGstRateBp: 1800 }],
    };
  });
}
