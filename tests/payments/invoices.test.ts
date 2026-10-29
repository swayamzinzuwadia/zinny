import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { extractText, getDocumentProxy } from "unpdf";
import { closeDb, systemDb } from "@/db/client";
import { universities } from "@/db/schema";
import { storage } from "@/server/core";
import { payInTestMode } from "@/modules/payments/checkout";
import { gstRatePercent, invoiceDownload, invoiceFileName, myInvoices } from "@/modules/payments/invoices";
import { amount, rupeesInWords } from "@/modules/payments/money";
import { renderInvoicePdf } from "@/modules/payments/pdf/invoice-pdf";
import { refundOrder } from "@/modules/payments/refunds";
import { payInvoiceDocuments } from "@/modules/payments/schema";
import { updateInvoiceSettings } from "@/modules/payments/settings";
import { drainEvents } from "../helpers/events";
import { invoiceOf, orderRow, paidCourse, startCheckout } from "./helpers";

afterAll(closeDb);

async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  expect(pdf.numPages).toBe(1);
  const { text } = await extractText(pdf, { mergePages: true });
  return text.replace(/\s+/g, " ");
}

async function paid(name: string, pricePaise?: number) {
  const c = await paidCourse(name, { pricePaise });
  await systemDb().update(universities).set({ address: "12 MG Road, Pune, Maharashtra 411001" }).where(eq(universities.id, c.uni.id));
  const s = await c.student(`${name} Student`);
  const { orderId } = await startCheckout(s, c.batch.id);
  await payInTestMode(s, orderId);
  return { c, s, orderId, order: await orderRow(orderId), invoice: await invoiceOf(orderId) };
}

describe("GST invoice PDF", () => {
  it("is an A4 page whose totals equal the order, with every required detail", async () => {
    const { s, order, invoice, c } = await paid("Invoice Totals U");
    const { bytes, fileName } = await invoiceDownload(s, invoice.id);
    expect(fileName).toBe(invoiceFileName(invoice.number));
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe("%PDF-");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const page = await pdf.getPage(1);
    const [, , w, h] = page.view;
    expect([Math.round(w), Math.round(h)]).toEqual([595, 842]);

    const text = await pdfText(bytes);
    // Totals equal the order: taxable value + CGST + SGST = total.
    expect(order.basePaise + order.gstPaise).toBe(order.totalPaise);
    expect(invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise).toBe(order.gstPaise);
    expect(text).toContain(`Taxable value ${amount(order.basePaise)}`);
    expect(text).toContain(`CGST @ 9% ${amount(invoice.cgstPaise)}`);
    expect(text).toContain(`SGST @ 9% ${amount(invoice.sgstPaise)}`);
    expect(text).toContain(`Total (₹) ${amount(order.totalPaise)}`);
    expect(text).toContain(rupeesInWords(order.totalPaise));
    expect(text).toContain("Indian Rupees Eleven Thousand Eight Hundred Only");
    // Seller, invoice, buyer, course and batch, SAC.
    expect(text).toContain("Invoice Totals U Trust");
    expect(text).toContain("12 MG Road, Pune, Maharashtra 411001");
    expect(text).toContain("GSTIN: 27AAAAA0000A1Z5");
    expect(text).toContain(invoice.number);
    expect(text).toContain("Invoice Totals U Student");
    expect(text).toContain(s.email);
    expect(text).toContain("Data Analytics");
    expect(text).toContain("Batch: Weekday morning");
    expect(text).toContain("999293");
    expect(text).toContain("Place of supply: Maharashtra (27)");
    expect(text).toContain("Reverse charge: No");
    void c;
  });

  it("totals stay exact for odd amounts (paise) and the words include paise", async () => {
    const { s, order, invoice } = await paid("Invoice Paise U", 333_333);
    expect(order.gstPaise).toBe(60_000);
    const text = await pdfText((await invoiceDownload(s, invoice.id)).bytes);
    expect(text).toContain(`Taxable value ${amount(333_333)}`);
    expect(text).toContain(`Total (₹) ${amount(393_333)}`);
    expect(text).toContain("Indian Rupees Three Thousand Nine Hundred Thirty Three and Thirty Three Paise Only");
  });

  it("shows IGST for an inter-state invoice", async () => {
    const bytes = await renderInvoicePdf({
      seller: { legalName: "Karnataka Institute", tradeName: "KI", address: null, gstin: "29AAAAA0000A1Z5", stateCode: "29" },
      invoice: { number: "KI/26-27/00001", date: "2026-10-29", placeOfSupply: "27" },
      buyer: { name: "Ślęzak Gonçalves", email: "s@example.com" },
      line: { course: "Design", batch: "Evening", sac: "999293", basePaise: 100_000 },
      tax: { cgstPaise: 0, sgstPaise: 0, igstPaise: 18_000, ratePercent: 18 },
      totalPaise: 118_000,
      payment: { paidOn: "2026-10-29", reference: "pay_X", orderRef: "order_X" },
      footer: "",
    });
    const text = await pdfText(bytes);
    expect(text).toContain("IGST @ 18% 180.00");
    expect(text).not.toContain("CGST");
    expect(text).toContain("Ślęzak Gonçalves");
    expect(text).toContain("Place of supply: Maharashtra (27)");
  });

  it("works out the GST rate from the amounts", () => {
    expect(gstRatePercent(1_000_000, 180_000, 1800)).toBe(18);
    expect(gstRatePercent(1_000_000, 180_000, 500)).toBe(18);
    expect(gstRatePercent(1_000_000, 50_000, null)).toBe(5);
    expect(gstRatePercent(0, 0, null)).toBe(0);
  });

  it("uses the university's SAC code and footer, and an issued invoice never changes afterwards", async () => {
    const { c, s, invoice } = await paid("Invoice Settings U");
    await updateInvoiceSettings(c.accounts, { sacCode: "999294", invoiceFooter: "Refunds within 7 days. Write to fees@example.edu." });
    const first = await invoiceDownload(s, invoice.id);
    const text = await pdfText(first.bytes);
    expect(text).toContain("999294");
    expect(text).toContain("Refunds within 7 days. Write to fees@example.edu.");
    await updateInvoiceSettings(c.accounts, { sacCode: "999293", invoiceFooter: "Changed footer" });
    const again = await invoiceDownload(c.accounts, invoice.id);
    expect(Buffer.from(again.bytes).equals(Buffer.from(first.bytes))).toBe(true);
    // If the stored file goes missing it's rebuilt with the settings it was issued with.
    const [doc] = await systemDb().select().from(payInvoiceDocuments).where(eq(payInvoiceDocuments.invoiceId, invoice.id));
    await storage().delete(doc.storageKey);
    const rebuilt = await pdfText((await invoiceDownload(s, invoice.id)).bytes);
    expect(rebuilt).toContain("999294");
    expect(rebuilt).not.toContain("Changed footer");
  });

  it("is rendered and emailed once when the payment is confirmed", async () => {
    const { invoice, s: student } = await paid("Invoice Email U");
    const logs: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void logs.push(a.join(" "));
    try {
      await drainEvents();
      await drainEvents();
    } finally {
      console.log = log;
    }
    const [doc] = await systemDb().select().from(payInvoiceDocuments).where(eq(payInvoiceDocuments.invoiceId, invoice.id));
    expect(doc.emailedAt).toBeInstanceOf(Date);
    expect(doc.sizeBytes).toBeGreaterThan(5_000);
    const mails = logs.filter((l) => l.includes(`to ${student.email}`) && l.includes(`Your GST invoice ${invoice.number}`));
    expect(mails).toHaveLength(1);
    expect(mails[0]).toContain("/learn/invoices");
  });
});

describe("who can download an invoice", () => {
  it("the student who paid and finance staff can; other students, HOD, faculty and other universities can't", async () => {
    const { c, s, invoice } = await paid("Invoice Access U");
    await expect(invoiceDownload(s, invoice.id)).resolves.toMatchObject({ number: invoice.number });
    await expect(invoiceDownload(c.accounts, invoice.id)).resolves.toBeTruthy();
    await expect(invoiceDownload(c.board, invoice.id)).resolves.toBeTruthy();
    await expect(invoiceDownload(c.admin, invoice.id)).resolves.toBeTruthy();
    for (const who of [await c.student("Nosy Student"), c.hod, c.faculty]) {
      await expect(invoiceDownload(who, invoice.id)).rejects.toThrow(/Invoice not found/);
    }
    const other = await paidCourse("Invoice Other U");
    await expect(invoiceDownload(other.accounts, invoice.id)).rejects.toThrow(/Invoice not found/);
    await expect(invoiceDownload(s, "not-a-uuid")).rejects.toThrow(/Invoice not found/);
  });

  it("students list only their own invoices, with refunds shown", async () => {
    const { c, s, orderId, invoice } = await paid("Invoice List U");
    const someoneElse = await c.student("Other Learner");
    await refundOrder(c.accounts, { orderId, amountPaise: 100_000, reason: "Partial scholarship" });
    const mine = await myInvoices(s);
    expect(mine).toEqual([
      expect.objectContaining({ id: invoice.id, number: invoice.number, course: "Data Analytics", batch: "Weekday morning", totalPaise: 1_180_000, gstPaise: 180_000, refundedPaise: 100_000, refundInFlightPaise: 0 }),
    ]);
    expect(await myInvoices(someoneElse)).toEqual([]);
    // Staff have no invoices of their own to view.
    await expect(myInvoices(c.hod)).rejects.toThrow(/access/);
  });
});
