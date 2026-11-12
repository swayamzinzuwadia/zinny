/**
 * Invoices the institute raises itself (Finance → Invoices): numbering shared with order
 * invoices, GST and place of supply, statuses, editing, permissions, the PDF, the learner's
 * view and the list with its totals.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, invoiceCounters, notifications, universities } from "@/db/schema";
import { todayIn } from "@/server/core";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { COURSE_FEES_ID, createCategory } from "@/modules/payments/categories";
import { payInTestMode } from "@/modules/payments/checkout";
import { invoiceRegister, invoiceRegisterCsv, orderIdOfInvoice, parseRegisterFilters } from "@/modules/payments/invoice-register";
import { hasInvoices, invoiceDownload, myManualInvoices } from "@/modules/payments/invoices";
import {
  cancelManualInvoice,
  createManualInvoice,
  getManualInvoice,
  invoiceFormContext,
  markManualUnpaid,
  recordManualPayment,
  searchBillable,
  updateManualInvoice,
  type InvoiceInput,
} from "@/modules/payments/manual-invoices";
import { payManualInvoiceLines, payManualInvoices } from "@/modules/payments/schema";
import { updateGstSetting, updateInvoiceSettings } from "@/modules/payments/settings";
import { invoiceOf, paidCourse, startCheckout } from "./helpers";

afterAll(closeDb);

async function pdfText(bytes: Uint8Array, pages = 1) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  expect(pdf.numPages).toBe(pages);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, " ");
}

const today = () => todayIn("Asia/Kolkata");
const daysFrom = (n: number) => {
  const d = new Date(`${today()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const seq = (number: string) => Number(number.slice(-5));
const oneLine: InvoiceInput["lines"] = [{ description: "Semester 2 exam fee", quantity: 1, unitPricePaise: 250_000 }];
const walkIn = (extra: Partial<InvoiceInput> = {}): InvoiceInput => ({ buyerName: "Walk-in Candidate", lines: oneLine, ...extra });

async function setup(name: string) {
  const c = await paidCourse(name);
  await systemDb().update(universities).set({ address: "12 MG Road, Pune 411001" }).where(eq(universities.id, c.uni.id));
  const student = await c.student(`${name} Student`);
  const exam = await createCategory(c.accounts, { name: "Exam fees", defaultGstRateBp: 0, sacCode: "999294" });
  const workshop = await createCategory(c.accounts, { name: "Workshop", defaultGstRateBp: 1800 });
  return { ...c, studentActor: student, exam, workshop };
}

describe("creating an invoice", () => {
  it("bills a student of the institute, copies the seller and GST details, and notifies them", async () => {
    const c = await setup("Manual Create U");
    const inv = await createManualInvoice(c.accounts, {
      categoryId: c.workshop.id,
      userId: c.studentActor.userId,
      lines: [
        { description: "  Two-day   workshop ", quantity: 2, unitPricePaise: 120_000 },
        { description: "Workbook", quantity: 1, unitPricePaise: 15_050 },
        { description: "", quantity: 1, unitPricePaise: 0 },
      ],
      discountPaise: 5_050,
      discountNote: "Early bird",
      dueDate: daysFrom(7),
      notes: "Pay at the accounts office.",
    });
    expect(inv).toMatchObject({
      universityId: c.uni.id,
      categoryId: c.workshop.id,
      userId: c.studentActor.userId,
      buyerName: c.studentActor.name,
      buyerEmail: c.studentActor.email,
      placeOfSupply: "27",
      sellerName: "Manual Create U Trust",
      sellerGstin: "27AAAAA0000A1Z5",
      sellerAddress: "12 MG Road, Pune 411001",
      sellerStateCode: "27",
      gstApplied: true,
      gstRateBp: 1800,
      // No SAC on the category: the institute's own code.
      sacCode: "999293",
      subtotalPaise: 255_050,
      discountPaise: 5_050,
      discountNote: "Early bird",
      taxablePaise: 250_000,
      cgstPaise: 22_500,
      sgstPaise: 22_500,
      igstPaise: 0,
      totalPaise: 295_000,
      issueDate: today(),
      dueDate: daysFrom(7),
      status: "unpaid",
      createdBy: c.accounts.userId,
    });
    expect(inv.number).toMatch(/^TU\/\d\d-\d\d\/\d{5}$/);
    expect(inv.number.length).toBeLessThanOrEqual(16);
    const lines = await systemDb().select().from(payManualInvoiceLines).where(eq(payManualInvoiceLines.invoiceId, inv.id)).orderBy(payManualInvoiceLines.position);
    expect(lines.map((l) => [l.position, l.description, l.quantity, l.unitPricePaise, l.amountPaise])).toEqual([
      [1, "Two-day workshop", 2, 120_000, 240_000],
      [2, "Workbook", 1, 15_050, 15_050],
    ]);

    const notes = await systemDb().select().from(notifications).where(and(eq(notifications.universityId, c.uni.id), eq(notifications.userId, c.studentActor.userId)));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "payments.invoice", title: `New invoice ${inv.number} for ₹2,950`, data: { manualInvoiceId: inv.id, number: inv.number } });
    expect(notes[0].body).toContain("Workshop: Two-day workshop and 1 more.");

    const [log] = await systemDb().select().from(auditLog).where(and(eq(auditLog.entityId, inv.id), eq(auditLog.action, "manual_invoice.create")));
    expect(log).toMatchObject({ actorUserId: c.accounts.userId, entity: "pay_manual_invoice" });
    expect(log.data).toMatchObject({ number: inv.number, category: "Workshop", totalPaise: 295_000, gstApplied: true, gstRateBp: 1800 });
  });

  it("takes the GST rate and SAC code from the category, and charges IGST to a buyer in another state", async () => {
    const c = await setup("Manual Gst U");
    const exempt = await createManualInvoice(c.accounts, walkIn({ categoryId: c.exam.id }));
    expect(exempt).toMatchObject({ gstApplied: true, gstRateBp: 0, sacCode: "999294", cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 250_000, userId: null, buyerEmail: null });

    const outside = await createManualInvoice(c.accounts, {
      categoryId: c.workshop.id,
      buyerName: "Sunrise Coaching Centre",
      buyerEmail: "Accounts@Sunrise.example",
      buyerGstin: "29aaecs1234f1z3",
      placeOfSupply: "29",
      lines: [{ description: "Workshop", quantity: 3, unitPricePaise: 33_333 }],
    });
    expect(outside).toMatchObject({ placeOfSupply: "29", buyerGstin: "29AAECS1234F1Z3", buyerEmail: "accounts@sunrise.example", taxablePaise: 99_999, cgstPaise: 0, sgstPaise: 0, igstPaise: 18_000, totalPaise: 117_999 });

    // The rate can be set for one invoice; built-in Course fees starts at 18%.
    expect(await createManualInvoice(c.accounts, walkIn({ categoryId: c.exam.id, gstRateBp: 500 }))).toMatchObject({ gstRateBp: 500, cgstPaise: 6_250, sgstPaise: 6_250 });
    expect(await createManualInvoice(c.accounts, walkIn({ categoryId: COURSE_FEES_ID }))).toMatchObject({ categoryId: null, gstRateBp: 1800, totalPaise: 295_000 });
  });

  it("carries no tax at all while GST is off, and stays that way after GST is turned back on", async () => {
    const c = await setup("Manual No Gst U");
    await updateGstSetting(c.accounts, false);
    const inv = await createManualInvoice(c.accounts, walkIn({ categoryId: c.workshop.id, gstRateBp: 1800, buyerGstin: "27ABCDE1234F1Z5", dueDate: daysFrom(5) }));
    expect(inv).toMatchObject({ gstApplied: false, gstRateBp: 0, sacCode: null, sellerGstin: null, buyerGstin: null, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, taxablePaise: 250_000, totalPaise: 250_000 });

    const text = await pdfText((await invoiceDownload(c.accounts, inv.id)).bytes);
    expect(text).toContain("Invoice");
    expect(text).not.toContain("Tax invoice");
    expect(text).not.toMatch(/GSTIN|SAC|CGST|SGST|IGST|Taxable value|Place of supply|Reverse charge/);
    expect(text).toContain("Total (₹) 2,500.00");
    expect(text).toContain("Workshop");

    await updateGstSetting(c.accounts, true);
    // Editing it keeps it a no-GST invoice; a new one is taxed.
    const edited = await updateManualInvoice(c.accounts, inv.id, { lines: [{ description: "Exam fee", quantity: 2, unitPricePaise: 100_000 }], issueDate: inv.issueDate, dueDate: inv.dueDate });
    expect(edited).toMatchObject({ gstApplied: false, cgstPaise: 0, totalPaise: 200_000 });
    expect(await pdfText((await invoiceDownload(c.accounts, inv.id)).bytes)).not.toContain("Tax invoice");
    expect(await createManualInvoice(c.accounts, walkIn({ categoryId: c.workshop.id }))).toMatchObject({ gstApplied: true, gstRateBp: 1800, totalPaise: 295_000 });
  });

  it("says what's wrong and how to fix it", async () => {
    const c = await setup("Manual Validation U");
    const bad = (input: Partial<InvoiceInput>) => createManualInvoice(c.accounts, { ...walkIn(), ...input });
    await expect(bad({ lines: [] })).rejects.toThrow(/Add at least one line/);
    await expect(bad({ lines: [{ description: "", quantity: 1, unitPricePaise: 5_000 }] })).rejects.toThrow(/Line 1 has a price but no description/);
    await expect(bad({ lines: [{ description: "Fee", quantity: 0, unitPricePaise: 5_000 }] })).rejects.toThrow(/quantity on line 1 must be a whole number from 1 to 9,999/);
    await expect(bad({ lines: [{ description: "Fee", quantity: 1.5, unitPricePaise: 5_000 }] })).rejects.toThrow(/whole number/);
    await expect(bad({ lines: [{ description: "Fee", quantity: 1, unitPricePaise: 0 }] })).rejects.toThrow(/add up to nothing/);
    await expect(bad({ lines: Array.from({ length: 13 }, () => oneLine[0]) })).rejects.toThrow(/up to 12 lines/);
    await expect(bad({ discountPaise: 250_000 })).rejects.toThrow(/discount \(₹2,500\) must be less than the lines add up to \(₹2,500\)/);
    await expect(bad({ lines: [{ description: "Fee", quantity: 9999, unitPricePaise: 100_000_00 }] })).rejects.toThrow(/up to ₹2,00,00,000/);
    await expect(bad({ buyerName: " " })).rejects.toThrow(/Say who the invoice is for/);
    await expect(bad({ buyerEmail: "not-an-email" })).rejects.toThrow(/email address doesn't look right/);
    await expect(bad({ placeOfSupply: "99" })).rejects.toThrow(/Pick the buyer's state/);
    await expect(bad({ buyerGstin: "27ABC" })).rejects.toThrow(/GSTIN has 15 characters/);
    await expect(bad({ buyerGstin: "29AAECS1234F1Z3" })).rejects.toThrow(/registered in Karnataka, but the buyer's state is Maharashtra/);
    await expect(bad({ gstRateBp: 1700 })).rejects.toThrow(/0, 5, 12, 18 or 28%/);
    await expect(bad({ issueDate: daysFrom(1) })).rejects.toThrow(/can't be in the future/);
    await expect(bad({ issueDate: "2026-02-30" })).rejects.toThrow(/Pick the invoice date/);
    await expect(bad({ dueDate: daysFrom(-1) })).rejects.toThrow(/due date is before the invoice date/);
    await expect(bad({ categoryId: "3f0d1a52-7c1e-4f0b-9a55-000000000000" })).rejects.toThrow(/Pick a category from the list/);
    await expect(bad({ notes: "x".repeat(501) })).rejects.toThrow(/notes under 500 characters/);
    // Someone from another institute can't be billed as "someone at the institute".
    const other = await paidCourse("Manual Validation Other U");
    const stranger = await other.student("Stranger Student");
    await expect(bad({ userId: stranger.userId })).rejects.toThrow(/isn't part of this institute/);
    // Nothing was created, and no number was used up.
    expect(await systemDb().select().from(payManualInvoices).where(eq(payManualInvoices.universityId, c.uni.id))).toEqual([]);
    expect(await systemDb().select().from(invoiceCounters).where(eq(invoiceCounters.universityId, c.uni.id))).toEqual([]);
  });

  it("finds people of this institute only, students first", async () => {
    const c = await setup("Manual Search U");
    const other = await paidCourse("Manual Search Other U");
    await other.student("Manual Search U Twin");
    const found = await searchBillable(c.accounts, "manual search u");
    expect(found.map((p) => p.id)).toEqual([c.studentActor.userId]);
    expect(found[0]).toMatchObject({ name: c.studentActor.name, email: c.studentActor.email, role: "student" });
    expect((await searchBillable(c.accounts, "Arun")).map((p) => p.name)).toEqual(["Arun Accounts"]);
    expect(await searchBillable(c.accounts, "a")).toEqual([]);
    await expect(searchBillable(c.board, "manual")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("invoice numbers", () => {
  it("come from the same series as order invoices, never collide, and are never reused", async () => {
    const c = await setup("Manual Numbering U");
    const first = await createManualInvoice(c.accounts, walkIn({ categoryId: c.exam.id }));

    const buyer = await c.student("Numbering Buyer");
    const { orderId } = await startCheckout(buyer, c.batch.id);
    await payInTestMode(buyer, orderId);
    const orderInvoice = await invoiceOf(orderId);

    const second = await createManualInvoice(c.accounts, walkIn({ categoryId: c.exam.id }));
    expect([seq(first.number), seq(orderInvoice.number), seq(second.number)]).toEqual([1, 2, 3]);
    expect(new Set([first.number, orderInvoice.number, second.number]).size).toBe(3);
    expect(first.number.slice(0, -5)).toBe(orderInvoice.number.slice(0, -5));

    // A cancelled invoice keeps its number; the next one moves on.
    await cancelManualInvoice(c.accounts, second.id, "Raised by mistake");
    const third = await createManualInvoice(c.accounts, walkIn());
    expect(seq(third.number)).toBe(4);
    const [counter] = await systemDb().select().from(invoiceCounters).where(eq(invoiceCounters.universityId, c.uni.id));
    expect(counter).toMatchObject({ financialYear: third.financialYear, lastSeq: 4 });

    // Raised at the same moment, they still get different numbers.
    const many = await Promise.all(Array.from({ length: 6 }, () => createManualInvoice(c.accounts, walkIn())));
    expect(many.map((m) => seq(m.number)).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10]);
    // Another institute has its own series.
    const other = await setup("Manual Numbering Other U");
    expect(seq((await createManualInvoice(other.accounts, walkIn())).number)).toBe(1);
  });

  it("follow the financial year of the invoice date", async () => {
    const c = await setup("Manual Fy U");
    const year = Number(today().slice(0, 4)) - (Number(today().slice(5, 7)) >= 4 ? 0 : 1);
    const lastYear = await createManualInvoice(c.accounts, walkIn({ issueDate: `${year}-03-31` }));
    const thisYear = await createManualInvoice(c.accounts, walkIn({ issueDate: `${year}-04-01` }));
    const fy = (y: number) => `${String(y % 100).padStart(2, "0")}-${String((y + 1) % 100).padStart(2, "0")}`;
    expect(lastYear).toMatchObject({ financialYear: fy(year - 1), number: `TU/${fy(year - 1)}/00001` });
    expect(thisYear).toMatchObject({ financialYear: fy(year), number: `TU/${fy(year)}/00001` });
    // An edit can't move an invoice out of the year its number belongs to.
    await expect(updateManualInvoice(c.accounts, thisYear.id, { lines: oneLine, issueDate: `${year}-03-31` })).rejects.toThrow(/Keep the invoice date inside it/);
  });
});

describe("status", () => {
  it("unpaid → paid → unpaid → cancelled, each step audited", async () => {
    const c = await setup("Manual Status U");
    const inv = await createManualInvoice(c.accounts, walkIn({ userId: c.studentActor.userId, buyerName: undefined, dueDate: daysFrom(3) }));

    await expect(recordManualPayment(c.accounts, inv.id, { paidOn: today(), mode: "barter" })).rejects.toThrow(/Pick how it was paid/);
    await expect(recordManualPayment(c.accounts, inv.id, { paidOn: today(), mode: "cheque" })).rejects.toThrow(/Add the cheque number/);
    await expect(recordManualPayment(c.accounts, inv.id, { paidOn: today(), mode: "upi" })).rejects.toThrow(/UPI transaction id/);
    await expect(recordManualPayment(c.accounts, inv.id, { paidOn: daysFrom(1), mode: "cash" })).rejects.toThrow(/can't be in the future/);
    await expect(recordManualPayment(c.accounts, inv.id, { paidOn: daysFrom(-2), mode: "cash" })).rejects.toThrow(/before the invoice date/);

    const paid = await recordManualPayment(c.accounts, inv.id, { paidOn: today(), mode: "bank_transfer", reference: " HDFC N123 " });
    expect(paid).toMatchObject({ status: "paid", paidOn: today(), paymentMode: "bank_transfer", paymentReference: "HDFC N123", paymentRecordedBy: c.accounts.userId });

    // Paid = locked.
    await expect(recordManualPayment(c.accounts, inv.id, { paidOn: today(), mode: "cash" })).rejects.toThrow(/already marked paid/);
    await expect(updateManualInvoice(c.accounts, inv.id, { lines: oneLine, issueDate: today() })).rejects.toThrow(/paid, so it's locked. Mark it unpaid first/);
    await expect(cancelManualInvoice(c.accounts, inv.id, "Changed my mind")).rejects.toThrow(/Mark it unpaid first, then cancel it/);

    const reopened = await markManualUnpaid(c.admin, inv.id);
    expect(reopened).toMatchObject({ status: "unpaid", paidOn: null, paymentMode: null, paymentReference: null, paymentRecordedBy: null });
    await expect(markManualUnpaid(c.admin, inv.id)).rejects.toThrow(/already unpaid/);
    await expect(updateManualInvoice(c.accounts, inv.id, { lines: oneLine, issueDate: today(), dueDate: daysFrom(9) })).resolves.toMatchObject({ dueDate: daysFrom(9) });

    await expect(cancelManualInvoice(c.accounts, inv.id, " ")).rejects.toThrow(/Say why this invoice is being cancelled/);
    const cancelled = await cancelManualInvoice(c.accounts, inv.id, "Raised twice by mistake");
    expect(cancelled).toMatchObject({ status: "cancelled", cancelReason: "Raised twice by mistake", cancelledBy: c.accounts.userId, number: inv.number });
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);

    // Cancelled is final, and it stays in the list.
    await expect(recordManualPayment(c.accounts, inv.id, { paidOn: today(), mode: "cash" })).rejects.toThrow(/cancelled invoice can't take a payment/);
    await expect(markManualUnpaid(c.accounts, inv.id)).rejects.toThrow(/can't be reopened/);
    await expect(updateManualInvoice(c.accounts, inv.id, { lines: oneLine, issueDate: today() })).rejects.toThrow(/cancelled invoice can't be changed/);
    await expect(cancelManualInvoice(c.accounts, inv.id, "Again")).rejects.toThrow(/already cancelled/);
    expect((await invoiceRegister(c.accounts)).rows.map((r) => [r.number, r.status])).toEqual([[inv.number, "cancelled"]]);

    const log = await systemDb().select().from(auditLog).where(eq(auditLog.entityId, inv.id)).orderBy(auditLog.at);
    expect(log.map((l) => l.action)).toEqual(["manual_invoice.create", "manual_invoice.paid", "manual_invoice.unpaid", "manual_invoice.update", "manual_invoice.cancel"]);
    expect(log[1].data).toMatchObject({ paidOn: today(), mode: "bank_transfer", reference: "HDFC N123" });
    expect(log[2].data).toMatchObject({ before: { paidOn: today(), mode: "bank_transfer", reference: "HDFC N123" } });
    expect(log[4].data).toMatchObject({ reason: "Raised twice by mistake" });
    // The student hears about the invoice and about its cancellation.
    const notes = await systemDb().select().from(notifications).where(eq(notifications.userId, c.studentActor.userId)).orderBy(notifications.createdAt);
    expect(notes.map((n) => n.title)).toEqual([`New invoice ${inv.number} for ₹2,950`, `Invoice ${inv.number} was cancelled`]);

    const detail = await getManualInvoice(c.board, inv.id);
    expect(detail.history.map((h) => h.action)).toEqual(["manual_invoice.cancel", "manual_invoice.update", "manual_invoice.unpaid", "manual_invoice.paid", "manual_invoice.create"]);
    expect(detail.history[0].by).toBe("Arun Accounts");
  });

  it("an unpaid invoice can be edited: lines, discount, dates and notes, with before and after in the audit log", async () => {
    const c = await setup("Manual Edit U");
    const inv = await createManualInvoice(c.accounts, walkIn({ categoryId: c.workshop.id, placeOfSupply: "29", dueDate: daysFrom(2), notes: "First note" }));
    expect(inv).toMatchObject({ igstPaise: 45_000, totalPaise: 295_000 });
    const saved = await updateManualInvoice(c.accounts, inv.id, {
      lines: [
        { description: "Workshop seat", quantity: 4, unitPricePaise: 100_000 },
        { description: "Lunch", quantity: 4, unitPricePaise: 12_500 },
      ],
      discountPaise: 50_000,
      discountNote: "Group booking",
      issueDate: daysFrom(-1),
      dueDate: daysFrom(10),
      notes: "Second note",
    });
    // The number, buyer, category, GST rate and place of supply stay as issued.
    expect(saved).toMatchObject({
      number: inv.number,
      categoryId: c.workshop.id,
      buyerName: "Walk-in Candidate",
      gstRateBp: 1800,
      placeOfSupply: "29",
      subtotalPaise: 450_000,
      discountPaise: 50_000,
      discountNote: "Group booking",
      taxablePaise: 400_000,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 72_000,
      totalPaise: 472_000,
      issueDate: daysFrom(-1),
      dueDate: daysFrom(10),
      notes: "Second note",
      status: "unpaid",
    });
    const detail = await getManualInvoice(c.accounts, inv.id);
    expect(detail.lines.map((l) => [l.position, l.description, l.amountPaise])).toEqual([
      [1, "Workshop seat", 400_000],
      [2, "Lunch", 50_000],
    ]);
    const [log] = await systemDb().select().from(auditLog).where(and(eq(auditLog.entityId, inv.id), eq(auditLog.action, "manual_invoice.update")));
    expect(log.data).toMatchObject({
      number: inv.number,
      before: { issueDate: today(), dueDate: daysFrom(2), discountPaise: 0, notes: "First note", totalPaise: 295_000, lines: [{ description: "Semester 2 exam fee", quantity: 1, unitPricePaise: 250_000 }] },
      after: { issueDate: daysFrom(-1), dueDate: daysFrom(10), discountPaise: 50_000, notes: "Second note", totalPaise: 472_000, lines: [{ description: "Workshop seat" }, { description: "Lunch" }] },
    });
    await expect(updateManualInvoice(c.accounts, inv.id, { lines: [], issueDate: today() })).rejects.toThrow(/Add at least one line/);
    await expect(updateManualInvoice(c.accounts, "nope", { lines: oneLine, issueDate: today() })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is overdue once unpaid past its due date", async () => {
    const c = await setup("Manual Overdue U");
    const late = await createManualInvoice(c.accounts, walkIn({ issueDate: daysFrom(-10), dueDate: daysFrom(-1) }));
    const dueToday = await createManualInvoice(c.accounts, walkIn({ issueDate: daysFrom(-10), dueDate: today() }));
    const open = await createManualInvoice(c.accounts, walkIn({ issueDate: daysFrom(-10) }));
    expect((await getManualInvoice(c.accounts, late.id)).overdue).toBe(true);
    expect((await getManualInvoice(c.accounts, dueToday.id)).overdue).toBe(false);
    expect((await getManualInvoice(c.accounts, open.id)).overdue).toBe(false);
    expect((await invoiceRegister(c.accounts, { status: "overdue" })).rows.map((r) => r.number)).toEqual([late.number]);
    expect(await pdfText((await invoiceDownload(c.accounts, late.id)).bytes)).toContain("Overdue: payment was due on");
    await recordManualPayment(c.accounts, late.id, { paidOn: today(), mode: "cash" });
    expect((await getManualInvoice(c.accounts, late.id)).overdue).toBe(false);
  });
});

describe("permissions", () => {
  it("finance.view sees invoices; only finance.manage creates and changes them", async () => {
    const c = await setup("Manual Perms U");
    const inv = await createManualInvoice(c.accounts, walkIn({ dueDate: daysFrom(3) }));
    const paid = await createManualInvoice(c.admin, walkIn());
    await recordManualPayment(c.admin, paid.id, { paidOn: today(), mode: "cash" });

    // Allowed to view: Board / Owner (finance.view only).
    await expect(getManualInvoice(c.board, inv.id)).resolves.toMatchObject({ canManage: false });
    await expect(invoiceRegister(c.board)).resolves.toMatchObject({ can: { manage: false } });
    await expect(invoiceRegisterCsv(c.board)).resolves.toMatchObject({ count: 2 });
    await expect(orderIdOfInvoice(c.board, inv.id)).resolves.toBeNull();
    await expect(invoiceDownload(c.board, inv.id)).resolves.toMatchObject({ number: inv.number });
    expect((await getManualInvoice(c.accounts, inv.id)).canManage).toBe(true);

    const student = c.studentActor;
    // Denied to view: no finance.view.
    for (const who of [c.faculty, c.hod, student]) {
      await expect(getManualInvoice(who, inv.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(invoiceRegister(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(invoiceRegisterCsv(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(orderIdOfInvoice(who, inv.id)).rejects.toBeInstanceOf(ForbiddenError);
      // The PDF of an invoice that isn't theirs is "not found", so ids don't leak.
      await expect(invoiceDownload(who, inv.id)).rejects.toBeInstanceOf(NotFoundError);
    }
    // Denied to change: finance.view isn't enough.
    for (const who of [c.board, c.faculty, student]) {
      await expect(createManualInvoice(who, walkIn())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(invoiceFormContext(who)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updateManualInvoice(who, inv.id, { lines: oneLine, issueDate: today() })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(recordManualPayment(who, inv.id, { paidOn: today(), mode: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(markManualUnpaid(who, paid.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(cancelManualInvoice(who, inv.id, "No reason")).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await systemDb().select().from(payManualInvoices).where(eq(payManualInvoices.id, inv.id)))[0].status).toBe("unpaid");

    // Another institute's Accounts can't see or change it.
    const other = await setup("Manual Perms Other U");
    await expect(getManualInvoice(other.accounts, inv.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(recordManualPayment(other.accounts, inv.id, { paidOn: today(), mode: "cash" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(cancelManualInvoice(other.accounts, inv.id, "Not mine")).rejects.toBeInstanceOf(NotFoundError);
    await expect(invoiceDownload(other.accounts, inv.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await invoiceRegister(other.accounts)).rows).toEqual([]);
  });
});

describe("the PDF", () => {
  it("looks like an order invoice and shows the category, lines, discount, due date and payment status", async () => {
    const c = await setup("Manual Pdf U");
    await updateInvoiceSettings(c.accounts, { sacCode: "999293", invoiceFooter: "Questions? Write to fees@example.edu." });
    const inv = await createManualInvoice(c.accounts, {
      categoryId: c.workshop.id,
      buyerName: "Sunrise Coaching Centre",
      buyerEmail: "accounts@sunrise.example",
      buyerPhone: "080 4123 9876",
      buyerAddress: "42 Residency Road, Bengaluru 560025",
      lines: [
        { description: "Two-day workshop: Spreadsheets for teachers", quantity: 18, unitPricePaise: 120_000 },
        { description: "Printed workbook", quantity: 18, unitPricePaise: 15_000 },
      ],
      discountPaise: 200_000,
      discountNote: "Group booking",
      dueDate: daysFrom(7),
      notes: "Venue: Seminar Hall 2.",
    });
    const { bytes, fileName } = await invoiceDownload(c.accounts, inv.id);
    expect(fileName).toBe(`Invoice-${inv.number.replace(/\//g, "-")}.pdf`);
    const unpaid = await pdfText(bytes);
    for (const part of [
      "Tax invoice",
      "Workshop",
      inv.number,
      "Manual Pdf U Trust",
      "12 MG Road, Pune 411001",
      "GSTIN: 27AAAAA0000A1Z5",
      "Sunrise Coaching Centre",
      "accounts@sunrise.example",
      "080 4123 9876",
      "42 Residency Road, Bengaluru 560025",
      "Place of supply: Maharashtra (27)",
      "Two-day workshop: Spreadsheets for teachers",
      "Printed workbook",
      "999293",
      "21,600.00",
      "2,700.00",
      "Subtotal 24,300.00",
      "Discount -2,000.00",
      "Group booking",
      "Taxable value 22,300.00",
      "CGST @ 9% 2,007.00",
      "SGST @ 9% 2,007.00",
      "Total (₹) 26,314.00",
      "Indian Rupees Twenty Six Thousand Three Hundred Fourteen Only",
      "Payment due by",
      "Amount due ₹26,314.00",
      "Venue: Seminar Hall 2.",
      "Questions? Write to fees@example.edu.",
    ]) {
      expect(unpaid, part).toContain(part);
    }
    expect(unpaid).not.toContain("Paid in full");

    await recordManualPayment(c.accounts, inv.id, { paidOn: today(), mode: "upi", reference: "431276598812" });
    const paid = await pdfText((await invoiceDownload(c.accounts, inv.id)).bytes);
    expect(paid).toContain("Paid in full on");
    expect(paid).toContain("Paid by UPI");
    expect(paid).toContain("Payment reference 431276598812");

    const gone = await createManualInvoice(c.accounts, walkIn({ categoryId: c.exam.id }));
    await cancelManualInvoice(c.accounts, gone.id, "Raised twice by mistake");
    const cancelled = await pdfText((await invoiceDownload(c.accounts, gone.id)).bytes);
    expect(cancelled).toContain("Cancelled: nothing is payable");
    expect(cancelled).toContain("Raised twice by mistake");
    // GST at 0% on a GST invoice still prints the tax rows.
    expect(cancelled).toContain("CGST @ 0% 0.00");
  });

  it("runs a full invoice of 12 long lines onto a second page without losing anything", async () => {
    const c = await setup("Manual Pdf Long U");
    await updateInvoiceSettings(c.accounts, { sacCode: "999293", invoiceFooter: "Footer line. ".repeat(40).trim() });
    const inv = await createManualInvoice(c.accounts, {
      buyerName: "A".repeat(110),
      buyerAddress: "Flat 12, Long Building Name, Very Long Street Name, Some Locality, City 400001",
      lines: Array.from({ length: 12 }, (_, i) => ({ description: `Line ${i + 1} ${"long description ".repeat(6)}`.slice(0, 120), quantity: i + 1, unitPricePaise: 12_345 })),
      discountPaise: 100,
      discountNote: "Rounding",
      dueDate: daysFrom(1),
      notes: "n".repeat(500),
    });
    const text = await pdfText((await invoiceDownload(c.accounts, inv.id)).bytes, 2);
    for (let n = 1; n <= 12; n++) expect(text).toContain(`Line ${n} long description`);
    for (const part of ["Subtotal 9,629.10", "Discount -1.00", "Taxable value 9,628.10", "Total (₹) 11,361.16", "Payment due by", "Authorised signatory", `Tax invoice ${inv.number} Continued`, "Footer line."]) {
      expect(text, part).toContain(part);
    }
  });

  it("keeps a typical invoice of a few lines on one page", async () => {
    const c = await setup("Manual Pdf Short U");
    const inv = await createManualInvoice(c.accounts, walkIn({ lines: Array.from({ length: 5 }, (_, i) => ({ description: `Fee ${i + 1}`, quantity: 1, unitPricePaise: 10_000 })), discountPaise: 500, notes: "Pay at the office." }));
    const text = await pdfText((await invoiceDownload(c.accounts, inv.id)).bytes, 1);
    expect(text).toContain("Fee 5");
    expect(text).toContain("Authorised signatory");
  });
});

describe("the learner's invoices", () => {
  it("shows invoices billed to them with status and due date, and lets them download the PDF", async () => {
    const c = await setup("Manual Learner U");
    const me = c.studentActor;
    const someoneElse = await c.student("Other Learner");
    expect(await hasInvoices(me)).toBe(false);
    const late = await createManualInvoice(c.accounts, { categoryId: c.exam.id, userId: me.userId, lines: oneLine, issueDate: daysFrom(-9), dueDate: daysFrom(-2) });
    const paid = await createManualInvoice(c.accounts, {
      categoryId: c.workshop.id,
      userId: me.userId,
      lines: [
        { description: "Workshop seat", quantity: 1, unitPricePaise: 100_000 },
        { description: "Lunch", quantity: 1, unitPricePaise: 10_000 },
      ],
      issueDate: daysFrom(-3),
    });
    await recordManualPayment(c.accounts, paid.id, { paidOn: daysFrom(-1), mode: "cash" });
    const theirs = await createManualInvoice(c.accounts, { userId: someoneElse.userId, lines: oneLine });
    await createManualInvoice(c.accounts, walkIn());

    expect(await hasInvoices(me)).toBe(true);
    expect(await myManualInvoices(me)).toEqual([
      { id: paid.id, number: paid.number, issuedOn: daysFrom(-3), dueDate: null, category: "Workshop", title: "Workshop seat and 1 more", totalPaise: 129_800, gstPaise: 19_800, status: "paid", overdue: false, paidOn: daysFrom(-1) },
      { id: late.id, number: late.number, issuedOn: daysFrom(-9), dueDate: daysFrom(-2), category: "Exam fees", title: "Semester 2 exam fee", totalPaise: 250_000, gstPaise: 0, status: "unpaid", overdue: true, paidOn: null },
    ]);

    const pdf = await invoiceDownload(me, late.id);
    expect(pdf.number).toBe(late.number);
    expect(await pdfText(pdf.bytes)).toContain(me.name);
    // Not theirs: not found.
    await expect(invoiceDownload(me, theirs.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(invoiceDownload(someoneElse, late.id)).rejects.toBeInstanceOf(NotFoundError);
    // Staff without self.view_invoices have no learner list.
    await expect(myManualInvoices(c.accounts)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the invoice list", () => {
  it("puts order invoices under Course fees next to raised ones, with totals, a per-category summary, filters and CSV", async () => {
    const c = await setup("Manual Register U");
    const buyer = await c.student("Register Buyer");
    const { orderId } = await startCheckout(buyer, c.batch.id);
    await payInTestMode(buyer, orderId);
    const orderInvoice = await invoiceOf(orderId);

    const overdue = await createManualInvoice(c.accounts, { categoryId: c.exam.id, userId: c.studentActor.userId, lines: oneLine, issueDate: daysFrom(-20), dueDate: daysFrom(-5) });
    const unpaid = await createManualInvoice(c.accounts, walkIn({ categoryId: c.exam.id, issueDate: daysFrom(-2), dueDate: daysFrom(5), buyerEmail: "walkin@example.com" }));
    const paid = await createManualInvoice(c.accounts, walkIn({ categoryId: c.workshop.id, issueDate: daysFrom(-4), buyerName: "=Sunrise, Coaching" }));
    await recordManualPayment(c.accounts, paid.id, { paidOn: daysFrom(-3), mode: "cheque", reference: "004512" });
    const cancelled = await createManualInvoice(c.accounts, walkIn({ categoryId: c.workshop.id, issueDate: daysFrom(-1) }));
    await cancelManualInvoice(c.accounts, cancelled.id, "Raised twice by mistake");
    const cash = await createManualInvoice(c.accounts, walkIn({ categoryId: COURSE_FEES_ID, issueDate: daysFrom(-6) }));

    const all = await invoiceRegister(c.accounts);
    expect(all.rows.map((r) => r.number)).toEqual([orderInvoice.number, cancelled.number, unpaid.number, paid.number, cash.number, overdue.number]);
    expect(all.rows[0]).toMatchObject({ source: "order", orderId, categoryId: COURSE_FEES_ID, category: "Course fees", status: "paid", totalPaise: 1_180_000, gstPaise: 180_000, gst: true, buyerName: buyer.name });
    expect(all.rows[5]).toMatchObject({ source: "manual", category: "Exam fees", status: "unpaid", overdue: true, buyerName: c.studentActor.name, description: "Semester 2 exam fee" });
    // Billed leaves cancelled out: order 11,800 + exam 2,500 × 2 + workshop 2,950 + course fees 2,950.
    expect(all.totals).toEqual({ count: 6, billedPaise: 2_270_000, collectedPaise: 1_475_000, outstandingPaise: 795_000, overduePaise: 250_000, unpaid: 3, overdue: 1, cancelled: 1 });
    expect(all.byCategory).toEqual([
      { id: COURSE_FEES_ID, name: "Course fees", archived: false, count: 2, billedPaise: 1_475_000, collectedPaise: 1_180_000, outstandingPaise: 295_000 },
      { id: c.exam.id, name: "Exam fees", archived: false, count: 2, billedPaise: 500_000, collectedPaise: 0, outstandingPaise: 500_000 },
      { id: c.workshop.id, name: "Workshop", archived: false, count: 2, billedPaise: 295_000, collectedPaise: 295_000, outstandingPaise: 0 },
    ]);
    expect(all.gstEnabled).toBe(true);

    const numbers = async (f: Parameters<typeof invoiceRegister>[1]) => (await invoiceRegister(c.accounts, f)).rows.map((r) => r.number);
    expect(await numbers({ category: COURSE_FEES_ID })).toEqual([orderInvoice.number, cash.number]);
    expect(await numbers({ category: c.exam.id })).toEqual([unpaid.number, overdue.number]);
    expect(await numbers({ status: "paid" })).toEqual([orderInvoice.number, paid.number]);
    expect(await numbers({ status: "unpaid" })).toEqual([unpaid.number, cash.number, overdue.number]);
    expect(await numbers({ status: "overdue" })).toEqual([overdue.number]);
    expect(await numbers({ status: "cancelled" })).toEqual([cancelled.number]);
    expect(await numbers({ from: daysFrom(-4), to: daysFrom(-1) })).toEqual([cancelled.number, unpaid.number, paid.number]);
    expect(await numbers({ q: overdue.number })).toEqual([overdue.number]);
    expect(await numbers({ q: "walkin@EXAMPLE" })).toEqual([unpaid.number]);
    expect(await numbers({ q: "register buyer" })).toEqual([orderInvoice.number]);
    expect(await numbers({ q: "100%" })).toEqual([]);
    expect((await invoiceRegister(c.accounts, { category: c.exam.id })).totals).toMatchObject({ count: 2, billedPaise: 500_000, outstandingPaise: 500_000, overduePaise: 250_000 });

    expect(parseRegisterFilters({ category: "course-fees", status: "overdue", from: "2026-04-01", to: "nope", q: " riya ", page: "3" })).toEqual({ category: "course-fees", status: "overdue", from: "2026-04-01", q: "riya", page: 3 });
    expect(parseRegisterFilters({ category: "x", status: "refunded", page: "-1" })).toEqual({});

    const { csv, count } = await invoiceRegisterCsv(c.accounts, { status: "paid" });
    expect(count).toBe(2);
    const rows = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(rows[0]).toBe("Invoice number,Invoice date,Due date,Category,Billed to,Email,For,Amount before GST,GST,Total,Status,Paid on,Payment mode,Payment reference,Refunded,Source");
    expect(rows[1]).toContain(`${orderInvoice.number},${today()},,Course fees,Register Buyer`);
    expect(rows[1]).toMatch(/10000\.00,1800\.00,11800\.00,Paid,.*,Order$/);
    // A name that starts like a formula is neutralised, and a comma is quoted.
    expect(rows[2]).toBe(`${paid.number},${daysFrom(-4)},,Workshop,"'=Sunrise, Coaching",,Semester 2 exam fee,2500.00,450.00,2950.00,Paid,${daysFrom(-3)},Cheque,004512,0.00,Raised by institute`);
    expect((await invoiceRegisterCsv(c.accounts, { status: "overdue" })).csv).toContain(",Overdue,");
    // An order invoice opens on its order.
    expect(await orderIdOfInvoice(c.accounts, orderInvoice.id)).toBe(orderId);
  });
});
