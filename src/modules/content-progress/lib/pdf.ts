/**
 * A tiny PDF writer for the demo seed: A4 pages of plain text (Helvetica), a bold title,
 * headings and wrapped paragraphs. No dependencies; output opens in every PDF reader.
 */

export type PdfBlock = { heading?: string; text?: string };

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 56;
const BODY = 11;
const LEADING = 16;
const WRAP = 86;

/** Keeps printable ASCII only (Helvetica WinAnsi) and escapes PDF string characters. */
function pdfText(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/₹/g, "Rs ")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(text: string, width = WRAP): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out;
}

type Line = { font: "F1" | "F2"; size: number; text: string; gapBefore: number };

export function makePdf(title: string, blocks: PdfBlock[], footer = ""): Buffer {
  const lines: Line[] = [{ font: "F2", size: 20, text: title, gapBefore: 0 }];
  for (const b of blocks) {
    if (b.heading) lines.push({ font: "F2", size: 13, text: b.heading, gapBefore: 14 });
    if (b.text) wrap(b.text).forEach((t, i) => lines.push({ font: "F1", size: BODY, text: t, gapBefore: i === 0 ? 6 : 0 }));
  }

  // Lay lines out on pages.
  const pages: string[] = [];
  let ops: string[] = [];
  let y = PAGE_H - MARGIN - 20;
  const flush = () => {
    if (footer) ops.push(`BT /F1 9 Tf ${MARGIN} ${MARGIN - 24} Td (${pdfText(`${footer}  |  Page ${pages.length + 1}`)}) Tj ET`);
    pages.push(ops.join("\n"));
    ops = [];
    y = PAGE_H - MARGIN;
  };
  for (const l of lines) {
    const step = l.gapBefore + (l.size > BODY ? l.size + 6 : LEADING);
    if (y - step < MARGIN) flush();
    y -= step;
    if (l.text) ops.push(`BT /${l.font} ${l.size} Tf ${MARGIN} ${y} Td (${pdfText(l.text)}) Tj ET`);
  }
  flush();

  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then a page and its content per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, i) => {
    const pageId = pageIds[i];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info << /Title (${pdfText(title)}) /Producer (Zinny) >> >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
