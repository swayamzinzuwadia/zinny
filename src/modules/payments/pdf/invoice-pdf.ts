/**
 * Invoice as an A4 PDF: a GST tax invoice, or a plain invoice when the institute doesn't
 * charge GST (`gst: false`: no GSTIN, SAC code or tax rows). Order invoices have one line
 * (course and batch); invoices the institute raises itself have `items`, and may carry a
 * category, due date, discount, notes and their payment status.
 *
 * GST tax invoice as an A4 PDF (PRD pages 8 and 9: a GST invoice for every paid order).
 * Pure: takes the invoice data, returns the PDF bytes. No database, no network.
 *
 * Contents (CGST Rules, rule 46, for a service):
 *   seller legal name, address and GSTIN · invoice number and date · buyer · place of
 *   supply · description (course and batch) · SAC code · taxable value · CGST and SGST
 *   (or IGST) with rates · total in figures and in words · reverse charge: no.
 */
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { amount, rupeesInWords, stateLabel } from "../money";
import { LEXEND_REGULAR_TTF_BASE64, LEXEND_SEMIBOLD_TTF_BASE64 } from "./fonts";

export type InvoicePdfData = {
  seller: {
    /** Legal name as registered for GST (falls back to the university's name). */
    legalName: string;
    /** The name people know, shown under the legal name when it differs. */
    tradeName: string;
    address: string | null;
    gstin: string | null;
    stateCode: string;
  };
  invoice: {
    number: string;
    /** "YYYY-MM-DD" in the university's time zone. */
    date: string;
    /** GST state code of the place of supply, e.g. "27". */
    placeOfSupply: string;
    /** "YYYY-MM-DD"; shown under the date when set. */
    dueDate?: string | null;
    /** Invoice category, e.g. "Exam fees". */
    category?: string | null;
  };
  buyer: { name: string; email: string | null; phone?: string | null; address?: string | null; gstin?: string | null };
  /** False for an institute that doesn't charge GST: titled "Invoice", with no GSTIN, SAC or tax rows. Default true. */
  gst?: boolean;
  /** The single line of an order invoice. With `items`, only `sac` and `basePaise` (the taxable value) are used. */
  line: { course: string; batch: string; sac: string; basePaise: number };
  /** Lines of an invoice the institute raised itself. */
  items?: { description: string; quantity: number; unitPricePaise: number; amountPaise: number }[];
  /** Taken off the sum of the items before tax. */
  discount?: { paise: number; note: string };
  tax: { cgstPaise: number; sgstPaise: number; igstPaise: number; ratePercent: number };
  totalPaise: number;
  payment: { paidOn: string | null; reference: string | null; orderRef: string };
  /** Payment status of an invoice the institute raised itself; replaces the "Paid in full" box. */
  manual?: { status: "unpaid" | "paid" | "cancelled"; overdue: boolean; paidOn: string | null; mode: string | null; reference: string | null; cancelReason: string | null };
  notes?: string;
  footer: string;
};

const A4: [number, number] = [595.28, 841.89];
const M = 48; // page margin
const INK = rgb(0x14 / 255, 0x26 / 255, 0x1f / 255);
const MUTED = rgb(0x5d / 255, 0x6b / 255, 0x64 / 255);
const LINE = rgb(0xe8 / 255, 0xe0 / 255, 0xcc / 255);
const BRAND = rgb(0x0b / 255, 0x5e / 255, 0x4c / 255);
const SOFT = rgb(0xf6 / 255, 0xf2 / 255, 0xe4 / 255);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-29" → "29 Oct 2026". */
export function invoiceDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}

/** Percent with at most two decimals: 9 → "9", 2.5 → "2.5". */
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

type Fonts = { regular: PDFFont; bold: PDFFont };

/** Replaces characters the embedded font can't draw (e.g. Devanagari) so the PDF never shows boxes. */
function makeSanitiser(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  return (s: string) =>
    [...s.replace(/\s+/g, " ")]
      .map((ch) => {
        const cp = ch.codePointAt(0)!;
        if (supported.has(cp)) return ch;
        const plain = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
        return [...plain].every((c) => supported.has(c.codePointAt(0)!)) ? plain : "?";
      })
      .join("");
}

/** Greedy word wrap; long words are broken by character. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let line = "";
    for (const word of para.split(" ").filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let i = w.length;
        while (i > 1 && font.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
        out.push(w.slice(0, i));
        w = w.slice(i);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}

class Writer {
  y: number;
  constructor(
    public page: PDFPage,
    public f: Fonts,
    public clean: (s: string) => string,
  ) {
    this.y = A4[1] - M;
  }
  text(s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) {
    const size = o.size ?? 9.5;
    const font = o.bold ? this.f.bold : this.f.regular;
    const t = this.clean(s);
    const dx = o.align === "right" ? font.widthOfTextAtSize(t, size) : 0;
    this.page.drawText(t, { x: x - dx, y, size, font, color: o.color ?? INK });
  }
  /** Wrapped paragraph from the current y; returns the lines drawn. */
  para(s: string, x: number, width: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; leading?: number } = {}) {
    const size = o.size ?? 9.5;
    const font = o.bold ? this.f.bold : this.f.regular;
    const lines = wrap(this.clean(s), font, size, width);
    for (const l of lines) {
      this.text(l, x, this.y, { ...o, size });
      this.y -= o.leading ?? size * 1.45;
    }
    return lines.length;
  }
  rule(y: number, x1 = M, x2 = A4[0] - M, color = LINE, thickness = 0.8) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }
}

export async function renderInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(Buffer.from(LEXEND_REGULAR_TTF_BASE64, "base64"), { subset: true });
  const bold = await doc.embedFont(Buffer.from(LEXEND_SEMIBOLD_TTF_BASE64, "base64"), { subset: true });
  const clean = makeSanitiser(regular);

  const gst = d.gst !== false;
  const title = gst ? "Tax invoice" : "Invoice";
  doc.setTitle(`${title} ${d.invoice.number}`);
  doc.setAuthor(clean(d.seller.legalName));
  doc.setSubject(clean(d.items ? (d.invoice.category ?? d.items[0]?.description ?? title) : `${d.line.course}, ${d.line.batch}`));
  doc.setCreator("Zinny");
  doc.setProducer("Zinny");
  doc.setLanguage("en-IN");

  const w = new Writer(doc.addPage(A4), { regular, bold }, clean);
  const R = A4[0] - M;
  const contentW = R - M;

  // A long invoice (many lines, long descriptions) runs onto a second page: content never
  // goes below the footer, and what must stay together moves to the next page as a block.
  const footerLines = d.footer.trim() ? wrap(clean(d.footer.trim()), regular, 8.5, contentW).slice(0, 6) : [];
  const bottom = M + 56 + footerLines.length * 12;
  const need = (height: number) => {
    if (w.y - height >= bottom) return;
    w.page = doc.addPage(A4);
    w.page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: BRAND });
    w.y = A4[1] - M;
    w.text(`${title} ${d.invoice.number}`, M, w.y - 6, { size: 11, bold: true });
    w.text("Continued", R, w.y - 6, { size: 8.5, color: MUTED, align: "right" });
    w.y -= 34;
  };

  // Brand bar and title.
  w.page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: BRAND });
  w.text(title, M, w.y - 14, { size: 22, bold: true });
  if (d.invoice.category) w.text(d.invoice.category, M, w.y - 31, { size: 9.5, color: MUTED });
  w.text("Original for recipient", R, w.y - 4, { size: 8.5, color: MUTED, align: "right" });
  w.text(d.invoice.number, R, w.y - 18, { size: 12, bold: true, align: "right" });
  w.text(`Date ${invoiceDate(d.invoice.date)}`, R, w.y - 31, { size: 9.5, color: MUTED, align: "right" });
  if (d.invoice.dueDate) {
    w.text(`Due ${invoiceDate(d.invoice.dueDate)}`, R, w.y - 44, { size: 9.5, color: MUTED, align: "right" });
    w.y -= 13;
  }
  w.y -= 58;

  // Seller.
  const colW = contentW / 2 - 12;
  const top = w.y;
  w.text("From", M, w.y, { size: 8.5, color: MUTED });
  w.y -= 15;
  w.para(d.seller.legalName, M, colW, { size: 11, bold: true });
  if (d.seller.tradeName && d.seller.tradeName !== d.seller.legalName) w.para(d.seller.tradeName, M, colW, { color: MUTED });
  if (d.seller.address) w.para(d.seller.address, M, colW);
  w.para(`State: ${stateLabel(d.seller.stateCode)}`, M, colW);
  if (gst) w.para(d.seller.gstin ? `GSTIN: ${d.seller.gstin}` : "GSTIN: not registered", M, colW, { bold: !!d.seller.gstin });
  const sellerBottom = w.y;

  // Buyer.
  const bx = M + contentW / 2 + 12;
  w.y = top;
  w.text("Bill to", bx, w.y, { size: 8.5, color: MUTED });
  w.y -= 15;
  w.para(d.buyer.name, bx, colW, { size: 11, bold: true });
  if (d.buyer.email) w.para(d.buyer.email, bx, colW);
  if (d.buyer.phone) w.para(d.buyer.phone, bx, colW);
  if (d.buyer.address) w.para(d.buyer.address, bx, colW);
  if (gst) {
    if (d.buyer.gstin) w.para(`GSTIN: ${d.buyer.gstin}`, bx, colW);
    w.para(`Place of supply: ${stateLabel(d.invoice.placeOfSupply)}`, bx, colW);
    w.para("Reverse charge: No", bx, colW);
  }
  w.y = Math.min(w.y, sellerBottom) - 14;

  // Line items table.
  const cols = { no: M + 10, desc: M + 34, sac: R - 170, amt: R - 10 };
  const labelX = R - 230;
  const totalRow = (label: string, paise: number, o: { bold?: boolean; size?: number } = {}) => {
    w.text(label, labelX, w.y, { size: o.size ?? 9.5, bold: o.bold, color: o.bold ? INK : MUTED });
    w.text(amount(paise), cols.amt, w.y, { size: o.size ?? 9.5, bold: o.bold, align: "right" });
    w.y -= (o.size ?? 9.5) * 1.9;
  };
  w.page.drawRectangle({ x: M, y: w.y - 8, width: contentW, height: 24, color: SOFT });
  w.text("#", cols.no, w.y, { size: 8.5, color: MUTED });
  w.text("Description", cols.desc, w.y, { size: 8.5, color: MUTED });
  if (d.items) {
    // Institute-raised invoice: description, (SAC), quantity, rate, amount.
    const c = { sac: R - 232, qty: R - 150, rate: R - 84 };
    const descW = (gst ? c.sac : c.qty - 30) - cols.desc - 12;
    if (gst) w.text("SAC", c.sac, w.y, { size: 8.5, color: MUTED });
    w.text("Qty", c.qty, w.y, { size: 8.5, color: MUTED, align: "right" });
    w.text("Rate (₹)", c.rate, w.y, { size: 8.5, color: MUTED, align: "right" });
    w.text("Amount (₹)", cols.amt, w.y, { size: 8.5, color: MUTED, align: "right" });
    w.y -= 30;
    d.items.forEach((it, i) => {
      need(wrap(clean(it.description), bold, 9.5, descW).length * 13.8 + 10);
      const rowTop = w.y;
      w.text(String(i + 1), cols.no, w.y, {});
      if (gst) w.text(d.line.sac, c.sac, w.y, {});
      w.text(String(it.quantity), c.qty, w.y, { align: "right" });
      w.text(amount(it.unitPricePaise), c.rate, w.y, { align: "right" });
      w.text(amount(it.amountPaise), cols.amt, w.y, { align: "right" });
      w.para(it.description, cols.desc, descW, { bold: true });
      w.y = Math.min(w.y, rowTop - 14) - 4;
      w.rule(w.y + 8);
      w.y -= 6;
    });
    w.y -= 6;
    need((gst ? 87 : 27) + (d.discount && d.discount.paise > 0 ? 50 : 0));
    const subtotal = d.items.reduce((n, it) => n + it.amountPaise, 0);
    if (d.discount && d.discount.paise > 0) {
      totalRow("Subtotal", subtotal);
      totalRow("Discount", -d.discount.paise);
      if (d.discount.note) {
        w.y += 5;
        w.text(d.discount.note.slice(0, 60), labelX, w.y, { size: 8, color: MUTED });
        w.y -= 14;
      }
    }
  } else {
    if (gst) w.text("SAC", cols.sac, w.y, { size: 8.5, color: MUTED });
    w.text(gst ? "Taxable value (₹)" : "Amount (₹)", cols.amt, w.y, { size: 8.5, color: MUTED, align: "right" });
    w.y -= 30;
    const rowTop = w.y;
    w.text("1", cols.no, w.y, {});
    w.text(amount(d.line.basePaise), cols.amt, w.y, { align: "right" });
    if (gst) w.text(d.line.sac, cols.sac, w.y, {});
    w.para(d.line.course, cols.desc, cols.sac - cols.desc - 16, { bold: true });
    w.para(`Batch: ${d.line.batch}`, cols.desc, cols.sac - cols.desc - 16, { color: MUTED });
    w.y = Math.min(w.y, rowTop - 14) - 6;
    w.rule(w.y + 6);
    w.y -= 14;
  }

  // Totals.
  if (gst) {
    totalRow("Taxable value", d.line.basePaise);
    if (d.tax.igstPaise > 0) {
      totalRow(`IGST @ ${pct(d.tax.ratePercent)}`, d.tax.igstPaise);
    } else {
      totalRow(`CGST @ ${pct(d.tax.ratePercent / 2)}`, d.tax.cgstPaise);
      totalRow(`SGST @ ${pct(d.tax.ratePercent / 2)}`, d.tax.sgstPaise);
    }
    w.rule(w.y + 10, labelX, R);
    w.y -= 6;
  }
  totalRow("Total (₹)", d.totalPaise, { bold: true, size: 12 });
  w.y -= 4;

  // Amount in words, payment and signature stay together.
  need(170);
  w.text("Amount in words", M, w.y, { size: 8.5, color: MUTED });
  w.y -= 14;
  w.para(rupeesInWords(d.totalPaise), M, contentW, { bold: true });
  w.y -= 12;

  // Payment.
  w.page.drawRectangle({ x: M, y: w.y - 40, width: contentW, height: 52, color: SOFT });
  w.text("Payment", M + 14, w.y - 4, { size: 8.5, color: MUTED });
  w.y -= 20;
  if (d.manual) {
    const m = d.manual;
    const head =
      m.status === "paid"
        ? `Paid in full${m.paidOn ? ` on ${invoiceDate(m.paidOn)}` : ""}`
        : m.status === "cancelled"
          ? "Cancelled: nothing is payable"
          : d.invoice.dueDate
            ? `${m.overdue ? "Overdue: payment was due on" : "Payment due by"} ${invoiceDate(d.invoice.dueDate)}`
            : "Payment due";
    w.text(head, M + 14, w.y, { bold: true });
    if (m.status === "paid" && m.mode) w.text(`Paid by ${m.mode}`, R - 14, w.y, { align: "right", color: MUTED });
    w.y -= 14;
    const second = m.status === "paid" ? (m.reference ? `Payment reference ${m.reference}` : "") : m.status === "cancelled" ? (m.cancelReason ?? "") : `Amount due ₹${amount(d.totalPaise)}`;
    if (second) w.text(wrap(clean(second), regular, 9.5, contentW - 28)[0] ?? "", M + 14, w.y, { color: MUTED });
  } else {
    const paid = d.payment.paidOn ? `Paid in full on ${invoiceDate(d.payment.paidOn)}` : "Paid in full";
    w.text(paid, M + 14, w.y, { bold: true });
    w.text(`Order reference ${d.payment.orderRef}`, R - 14, w.y, { align: "right", color: MUTED });
    w.y -= 14;
    if (d.payment.reference) w.text(`Payment reference ${d.payment.reference}`, M + 14, w.y, { color: MUTED });
  }
  w.y -= 34;

  // Notes (institute-raised invoices), beside the signature.
  if (d.notes?.trim()) {
    const top = w.y;
    w.text("Notes", M, w.y, { size: 8.5, color: MUTED });
    w.y -= 14;
    for (const l of wrap(clean(d.notes.trim()), regular, 9.5, contentW - 200).slice(0, 5)) {
      w.text(l, M, w.y, {});
      w.y -= 13.5;
    }
    w.y = top;
  }

  // Signature and footer.
  w.text(`For ${d.seller.legalName}`, R, w.y, { align: "right", bold: true });
  w.y -= 14;
  w.text("Authorised signatory", R, w.y, { align: "right", color: MUTED, size: 8.5 });

  let fy = M + 40;
  fy += footerLines.length * 12;
  w.rule(fy + 8);
  for (const l of footerLines) {
    w.text(l, M, fy - 8, { size: 8.5, color: MUTED });
    fy -= 12;
  }
  w.text("This is a computer-generated invoice and needs no physical signature.", M, M + 12, { size: 8, color: MUTED });

  return doc.save({ useObjectStreams: true });
}
