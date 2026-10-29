/**
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
  };
  buyer: { name: string; email: string };
  line: { course: string; batch: string; sac: string; basePaise: number };
  tax: { cgstPaise: number; sgstPaise: number; igstPaise: number; ratePercent: number };
  totalPaise: number;
  payment: { paidOn: string | null; reference: string | null; orderRef: string };
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

  doc.setTitle(`Tax invoice ${d.invoice.number}`);
  doc.setAuthor(clean(d.seller.legalName));
  doc.setSubject(clean(`${d.line.course}, ${d.line.batch}`));
  doc.setCreator("Zinny");
  doc.setProducer("Zinny");
  doc.setLanguage("en-IN");

  const page = doc.addPage(A4);
  const w = new Writer(page, { regular, bold }, clean);
  const R = A4[0] - M;
  const contentW = R - M;

  // Brand bar and title.
  page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: BRAND });
  w.text("Tax invoice", M, w.y - 14, { size: 22, bold: true });
  w.text("Original for recipient", R, w.y - 4, { size: 8.5, color: MUTED, align: "right" });
  w.text(d.invoice.number, R, w.y - 18, { size: 12, bold: true, align: "right" });
  w.text(`Date ${invoiceDate(d.invoice.date)}`, R, w.y - 31, { size: 9.5, color: MUTED, align: "right" });
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
  w.para(d.seller.gstin ? `GSTIN: ${d.seller.gstin}` : "GSTIN: not registered", M, colW, { bold: !!d.seller.gstin });
  const sellerBottom = w.y;

  // Buyer.
  const bx = M + contentW / 2 + 12;
  w.y = top;
  w.text("Bill to", bx, w.y, { size: 8.5, color: MUTED });
  w.y -= 15;
  w.para(d.buyer.name, bx, colW, { size: 11, bold: true });
  w.para(d.buyer.email, bx, colW);
  w.para(`Place of supply: ${stateLabel(d.invoice.placeOfSupply)}`, bx, colW);
  w.para("Reverse charge: No", bx, colW);
  w.y = Math.min(w.y, sellerBottom) - 14;

  // Line items table.
  const cols = { no: M + 10, desc: M + 34, sac: R - 170, amt: R - 10 };
  page.drawRectangle({ x: M, y: w.y - 8, width: contentW, height: 24, color: SOFT });
  w.text("#", cols.no, w.y, { size: 8.5, color: MUTED });
  w.text("Description", cols.desc, w.y, { size: 8.5, color: MUTED });
  w.text("SAC", cols.sac, w.y, { size: 8.5, color: MUTED });
  w.text("Taxable value (₹)", cols.amt, w.y, { size: 8.5, color: MUTED, align: "right" });
  w.y -= 30;
  const rowTop = w.y;
  w.text("1", cols.no, w.y, {});
  w.text(amount(d.line.basePaise), cols.amt, w.y, { align: "right" });
  w.text(d.line.sac, cols.sac, w.y, {});
  w.para(d.line.course, cols.desc, cols.sac - cols.desc - 16, { bold: true });
  w.para(`Batch: ${d.line.batch}`, cols.desc, cols.sac - cols.desc - 16, { color: MUTED });
  w.y = Math.min(w.y, rowTop - 14) - 6;
  w.rule(w.y + 6);
  w.y -= 14;

  // Totals.
  const labelX = R - 230;
  const totalRow = (label: string, paise: number, o: { bold?: boolean; size?: number } = {}) => {
    w.text(label, labelX, w.y, { size: o.size ?? 9.5, bold: o.bold, color: o.bold ? INK : MUTED });
    w.text(amount(paise), cols.amt, w.y, { size: o.size ?? 9.5, bold: o.bold, align: "right" });
    w.y -= (o.size ?? 9.5) * 1.9;
  };
  totalRow("Taxable value", d.line.basePaise);
  if (d.tax.igstPaise > 0) {
    totalRow(`IGST @ ${pct(d.tax.ratePercent)}`, d.tax.igstPaise);
  } else {
    totalRow(`CGST @ ${pct(d.tax.ratePercent / 2)}`, d.tax.cgstPaise);
    totalRow(`SGST @ ${pct(d.tax.ratePercent / 2)}`, d.tax.sgstPaise);
  }
  w.rule(w.y + 10, labelX, R);
  w.y -= 6;
  totalRow("Total (₹)", d.totalPaise, { bold: true, size: 12 });
  w.y -= 4;

  // Amount in words.
  w.text("Amount in words", M, w.y, { size: 8.5, color: MUTED });
  w.y -= 14;
  w.para(rupeesInWords(d.totalPaise), M, contentW, { bold: true });
  w.y -= 12;

  // Payment.
  page.drawRectangle({ x: M, y: w.y - 40, width: contentW, height: 52, color: SOFT });
  w.text("Payment", M + 14, w.y - 4, { size: 8.5, color: MUTED });
  w.y -= 20;
  const paid = d.payment.paidOn ? `Paid in full on ${invoiceDate(d.payment.paidOn)}` : "Paid in full";
  w.text(paid, M + 14, w.y, { bold: true });
  w.text(`Order reference ${d.payment.orderRef}`, R - 14, w.y, { align: "right", color: MUTED });
  w.y -= 14;
  if (d.payment.reference) w.text(`Payment reference ${d.payment.reference}`, M + 14, w.y, { color: MUTED });
  w.y -= 34;

  // Signature and footer.
  w.text(`For ${d.seller.legalName}`, R, w.y, { align: "right", bold: true });
  w.y -= 14;
  w.text("Authorised signatory", R, w.y, { align: "right", color: MUTED, size: 8.5 });

  let fy = M + 40;
  const footerLines = d.footer.trim() ? wrap(clean(d.footer.trim()), regular, 8.5, contentW).slice(0, 6) : [];
  fy += footerLines.length * 12;
  w.rule(fy + 8);
  for (const l of footerLines) {
    w.text(l, M, fy - 8, { size: 8.5, color: MUTED });
    fy -= 12;
  }
  w.text("This is a computer-generated invoice and needs no physical signature.", M, M + 12, { size: 8, color: MUTED });

  return doc.save({ useObjectStreams: true });
}
