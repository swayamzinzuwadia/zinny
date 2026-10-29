/**
 * GST invoice PDFs from core's invoice records (core issues the invoice and its number
 * on confirmPayment; payments renders and stores the A4 PDF).
 *
 *  - Students see and download their own invoices (`self.view_invoices`).
 *  - Staff with `finance.view` download any invoice of their university (Sales page).
 *  - The first render is stored (storage key `<uni>/payments/invoices/<invoiceId>.pdf`)
 *    with the SAC code and footer it used, so an issued invoice never changes later.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses, invoices, orders, universities } from "@/db/schema";
import { assertCan, audit, can, sendEmail, storage, withTenant, type Actor } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { appUrl } from "./config";
import { dayIn, loadOrder, uni, universityRow } from "./internal";
import { inr } from "./money";
import { renderInvoicePdf, type InvoicePdfData } from "./pdf/invoice-pdf";
import { payInvoiceDocuments, payRefunds } from "./schema";
import { settingsFor } from "./settings";

export type InvoiceRow = typeof invoices.$inferSelect;

/** "DEMO/26-27/00042" → "Invoice-DEMO-26-27-00042.pdf" */
export function invoiceFileName(number: string) {
  return `Invoice-${number.replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}.pdf`;
}

export function invoiceStorageKey(universityId: string, invoiceId: string) {
  return `${universityId}/payments/invoices/${invoiceId}.pdf`;
}

/** GST rate of an order in percent: the course's current rate when it reproduces the order's GST, else worked out from the amounts. */
export function gstRatePercent(basePaise: number, gstPaise: number, courseRateBp: number | null) {
  if (courseRateBp !== null && Math.round((basePaise * courseRateBp) / 10_000) === gstPaise) return courseRateBp / 100;
  if (basePaise === 0) return 0;
  return Math.round((gstPaise * 10_000) / basePaise) / 100;
}

/** Splits core's "Course — Batch" description. */
function splitDescription(description: string, fallbackBatch: string) {
  const i = description.lastIndexOf(" — ");
  return i > 0 ? { course: description.slice(0, i), batch: description.slice(i + 3) } : { course: description, batch: fallbackBatch };
}

/** Everything the PDF needs, from core's invoice snapshot plus the university's details. */
export async function invoicePdfData(tx: Tx, invoice: InvoiceRow, snapshot?: { sacCode: string; footer: string }): Promise<InvoicePdfData> {
  const order = await loadOrder(tx, invoice.orderId);
  const u = await universityRow(tx);
  const [c] = await tx.select({ gstRateBp: courses.gstRateBp }).from(courses).where(eq(courses.id, order.courseId));
  const [b] = await tx.select({ name: batches.name }).from(batches).where(eq(batches.id, order.batchId));
  let settings: { sacCode: string; footer: string };
  if (snapshot) settings = snapshot;
  else {
    const s = await settingsFor(tx, invoice.universityId);
    settings = { sacCode: s.sacCode, footer: s.invoiceFooter };
  }
  const gst = invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise;
  const { course, batch } = splitDescription(invoice.description, b?.name ?? "");
  return {
    seller: { legalName: invoice.sellerName, tradeName: u.name, address: u.address, gstin: invoice.sellerGstin, stateCode: u.stateCode },
    invoice: { number: invoice.number, date: dayIn(u.timezone, invoice.issuedAt), placeOfSupply: invoice.placeOfSupply },
    buyer: { name: invoice.buyerName, email: invoice.buyerEmail },
    line: { course, batch, sac: settings.sacCode, basePaise: invoice.basePaise },
    tax: { cgstPaise: invoice.cgstPaise, sgstPaise: invoice.sgstPaise, igstPaise: invoice.igstPaise, ratePercent: gstRatePercent(invoice.basePaise, gst, c?.gstRateBp ?? null) },
    totalPaise: invoice.totalPaise,
    payment: {
      paidOn: order.paidAt ? dayIn(u.timezone, order.paidAt) : null,
      reference: order.gatewayPaymentId,
      orderRef: order.gatewayOrderId ?? order.id,
    },
    footer: settings.footer,
  };
}

/**
 * The stored PDF for an invoice, rendering and storing it the first time (or again with
 * the same settings if the stored file went missing). Caller checks permissions.
 */
export async function ensureInvoiceDocument(tx: Tx, actor: Actor, invoice: InvoiceRow): Promise<Uint8Array> {
  const [doc] = await tx.select().from(payInvoiceDocuments).where(eq(payInvoiceDocuments.invoiceId, invoice.id));
  if (doc) {
    const stored = await storage().get(doc.storageKey);
    if (stored) return new Uint8Array(stored.body);
    const again = await renderInvoicePdf(await invoicePdfData(tx, invoice, { sacCode: doc.sacCode, footer: doc.footer }));
    await storage().put({ key: doc.storageKey, body: again, contentType: "application/pdf" });
    await audit(tx, actor, "invoice.pdf_restored", "invoice", invoice.id, { number: invoice.number });
    return again;
  }
  const data = await invoicePdfData(tx, invoice);
  const bytes = await renderInvoicePdf(data);
  const key = invoiceStorageKey(invoice.universityId, invoice.id);
  await storage().put({ key, body: bytes, contentType: "application/pdf" });
  const [inserted] = await tx
    .insert(payInvoiceDocuments)
    .values({
      universityId: invoice.universityId,
      invoiceId: invoice.id,
      storageKey: key,
      sacCode: data.line.sac,
      footer: data.footer,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: bytes.length,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) await audit(tx, actor, "invoice.pdf_rendered", "invoice", invoice.id, { number: invoice.number, sacCode: data.line.sac });
  return bytes;
}

/**
 * An invoice PDF for download. The student who paid (with `self.view_invoices`) or staff
 * with `finance.view`; anyone else gets "not found", so invoice ids don't leak.
 */
export async function invoiceDownload(actor: Actor, invoiceId: string): Promise<{ fileName: string; bytes: Uint8Array; number: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) throw new NotFoundError("Invoice");
  return withTenant(actor, async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!invoice) throw new NotFoundError("Invoice");
    const [order] = await tx.select({ userId: orders.userId }).from(orders).where(eq(orders.id, invoice.orderId));
    const own = order?.userId === actor.userId && can(actor, "self.view_invoices", { universityId: uni(actor), ownerUserId: actor.userId });
    if (!own && !can(actor, "finance.view", { universityId: uni(actor) })) throw new NotFoundError("Invoice");
    const bytes = await ensureInvoiceDocument(tx, actor, invoice);
    return { fileName: invoiceFileName(invoice.number), bytes, number: invoice.number };
  });
}

export type MyInvoice = {
  id: string;
  number: string;
  issuedOn: string;
  course: string;
  batch: string;
  totalPaise: number;
  gstPaise: number;
  orderStatus: string;
  refundedPaise: number;
  refundInFlightPaise: number;
};

/** The learner's own GST invoices, newest first. Needs `self.view_invoices`. */
export async function myInvoices(actor: Actor): Promise<MyInvoice[]> {
  assertCan(actor, "self.view_invoices", { universityId: uni(actor), ownerUserId: actor.userId });
  return withTenant(actor, async (tx) => {
    const [u] = await tx.select({ timezone: universities.timezone }).from(universities).where(eq(universities.id, uni(actor)));
    const rows = await tx
      .select({ invoice: invoices, orderStatus: orders.status, batch: batches.name })
      .from(invoices)
      .innerJoin(orders, eq(orders.id, invoices.orderId))
      .innerJoin(batches, eq(batches.id, orders.batchId))
      .where(eq(orders.userId, actor.userId))
      .orderBy(desc(invoices.issuedAt));
    const refunds = rows.length
      ? await tx
          .select({ orderId: payRefunds.orderId, status: payRefunds.status, amountPaise: payRefunds.amountPaise })
          .from(payRefunds)
          .where(and(inArray(payRefunds.orderId, rows.map((r) => r.invoice.orderId)), inArray(payRefunds.status, ["requested", "pending", "processed"])))
      : [];
    return rows.map(({ invoice, orderStatus, batch }) => {
      const mine = refunds.filter((r) => r.orderId === invoice.orderId);
      const { course, batch: b } = splitDescription(invoice.description, batch);
      return {
        id: invoice.id,
        number: invoice.number,
        issuedOn: dayIn(u?.timezone ?? "Asia/Kolkata", invoice.issuedAt),
        course,
        batch: b,
        totalPaise: invoice.totalPaise,
        gstPaise: invoice.cgstPaise + invoice.sgstPaise + invoice.igstPaise,
        orderStatus,
        refundedPaise: mine.filter((r) => r.status === "processed").reduce((n, r) => n + r.amountPaise, 0),
        refundInFlightPaise: mine.filter((r) => r.status !== "processed").reduce((n, r) => n + r.amountPaise, 0),
      };
    });
  });
}

/** Email text for a new invoice. */
export function invoiceEmail(o: { universityName: string; slug: string; number: string; course: string; totalPaise: number; name: string }) {
  const link = `${appUrl()}/${o.slug}/learn/invoices`;
  const subject = `Your GST invoice ${o.number} from ${o.universityName}`;
  const text = [
    `Hi ${o.name},`,
    "",
    `Thank you for your payment of ${inr(o.totalPaise)} for ${o.course}.`,
    `Your GST invoice ${o.number} is ready. Download it any time from Invoices in your account:`,
    link,
    "",
    o.universityName,
  ].join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const html = `<p>Hi ${esc(o.name)},</p><p>Thank you for your payment of <b>${esc(inr(o.totalPaise))}</b> for ${esc(o.course)}.</p><p>Your GST invoice <b>${esc(o.number)}</b> is ready. Download it any time from Invoices in your account.</p><p><a href="${esc(link)}">Open my invoices</a></p><p>${esc(o.universityName)}</p>`;
  return { subject, text, html };
}

/**
 * After payment.confirmed: renders and stores the invoice PDF, then emails the student a
 * link to it, exactly once (even when two deliveries race). Runs inside the event
 * handler's tenant transaction.
 */
export async function renderAndEmailInvoice(tx: Tx, actor: Actor, orderId: string): Promise<"no_invoice" | "already_emailed" | "emailed"> {
  const [invoice] = await tx.select().from(invoices).where(eq(invoices.orderId, orderId));
  if (!invoice) return "no_invoice";
  await ensureInvoiceDocument(tx, actor, invoice);
  const [claimed] = await tx
    .update(payInvoiceDocuments)
    .set({ emailedAt: new Date() })
    .where(and(eq(payInvoiceDocuments.invoiceId, invoice.id), isNull(payInvoiceDocuments.emailedAt)))
    .returning({ id: payInvoiceDocuments.id });
  if (!claimed) return "already_emailed";
  const u = await universityRow(tx);
  const { course } = splitDescription(invoice.description, "");
  const mail = invoiceEmail({ universityName: u.name, slug: u.slug, number: invoice.number, course, totalPaise: invoice.totalPaise, name: invoice.buyerName });
  await sendEmail({ to: invoice.buyerEmail, ...mail, kind: "payments.invoice", universityId: invoice.universityId });
  await audit(tx, actor, "invoice.emailed", "invoice", invoice.id, { number: invoice.number });
  return "emailed";
}
