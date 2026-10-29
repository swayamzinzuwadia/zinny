/**
 * A small, dependency-light XLSX writer (Office Open XML, zipped with fflate) for report
 * downloads. One sheet, a bold frozen header row with filters, and real cell types:
 * money in rupees with a ₹ format, dates as Excel dates, percents as Excel percents,
 * numbers as numbers (negatives included). Text is written as inline strings, which a
 * spreadsheet never evaluates, so a value like "=SUM(A1)" stays text.
 */
import { strToU8, zipSync } from "fflate";
import type { ReportColumn } from "@/contracts/module";
import { isBlank, toDateString, toNumber } from "./format";

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Style indexes into cellXfs below. */
const STYLE = { text: 0, header: 1, money: 2, date: 3, percent: 4 } as const;

/** Excel's limit for one cell. */
const MAX_CELL_TEXT = 32_767;

// eslint-disable-next-line no-control-regex
const MAYBE_INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF￾￿]/;

/** Drops what XML 1.0 forbids: control characters, lone surrogates, U+FFFE and U+FFFF. Keeps emoji (surrogate pairs). */
export function stripInvalidXml(text: string): string {
  if (!MAYBE_INVALID_XML.test(text)) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i++;
      }
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) continue;
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff) continue;
    out += text[i];
  }
  return out;
}

export function escapeXml(text: string): string {
  return stripInvalidXml(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Days since 1899-12-30, Excel's day zero (this also skips Excel's 1900 leap-year bug for modern dates). */
export function excelDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/** A sheet name Excel accepts: at most 31 characters, none of []:*?/\ and no apostrophe at either end. */
export function sheetName(label: string): string {
  const clean = label.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "");
  return (clean || "Report").slice(0, 31).trim();
}

function numberText(n: number): string {
  if (Object.is(n, -0)) return "0";
  return String(n);
}

function textCell(ref: string, text: string, style: number = STYLE.text): string {
  const t = escapeXml(text.length > MAX_CELL_TEXT ? text.slice(0, MAX_CELL_TEXT) : text);
  const space = /^\s|\s$/.test(t) ? ' xml:space="preserve"' : "";
  return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t${space}>${t}</t></is></c>`;
}

function numberCell(ref: string, n: number, style: number): string {
  return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${numberText(n)}</v></c>`;
}

/** One value as an XLSX cell, or "" for a blank. Values that don't fit their column type are kept as text. */
function cell(ref: string, value: unknown, type: ReportColumn["type"]): string {
  if (isBlank(value)) return "";
  if (type === "money" || type === "number" || type === "percent") {
    const n = toNumber(value);
    if (n !== null) {
      if (type === "money") return numberCell(ref, n / 100, STYLE.money);
      if (type === "percent") return numberCell(ref, n / 100, STYLE.percent);
      return numberCell(ref, n, STYLE.text);
    }
  }
  if (type === "date") {
    const d = toDateString(value);
    if (d !== null) return numberCell(ref, excelDate(d), STYLE.date);
  }
  return textCell(ref, value instanceof Date ? value.toISOString() : String(value));
}

function displayLength(value: unknown, type: ReportColumn["type"]): number {
  if (isBlank(value)) return 0;
  if (type === "date") return 11;
  if (type === "money") return String(Math.round(Math.abs(toNumber(value) ?? 0) / 100)).length + 6;
  return String(value).length;
}

function columnWidths(columns: ReportColumn[], rows: Record<string, unknown>[]): number[] {
  const sample = rows.slice(0, 500);
  return columns.map((c) => {
    const longest = Math.max(c.label.length + 2, ...sample.map((r) => displayLength(r[c.key], c.type)));
    return Math.min(60, Math.max(9, longest + 2));
  });
}

function worksheetXml(columns: ReportColumn[], rows: Record<string, unknown>[]): string {
  const last = columnLetter(Math.max(columns.length, 1) - 1);
  const lastRow = rows.length + 1;
  const widths = columnWidths(columns, rows);
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const header = `<row r="1">${columns.map((c, i) => textCell(`${columnLetter(i)}1`, c.label, STYLE.header)).join("")}</row>`;
  const body = rows
    .map((row, r) => {
      const n = r + 2;
      return `<row r="${n}">${columns.map((c, i) => cell(`${columnLetter(i)}${n}`, row[c.key], c.type)).join("")}</row>`;
    })
    .join("");
  return (
    XML_HEAD +
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<dimension ref="A1:${last}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (columns.length ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${header}${body}</sheetData>` +
    (columns.length ? `<autoFilter ref="A1:${last}${lastRow}"/>` : "") +
    `</worksheet>`
  );
}

function workbookXml(name: string, columns: number, lastRow: number): string {
  const last = columnLetter(Math.max(columns, 1) - 1);
  const quoted = `'${name.replace(/'/g, "''")}'`;
  const filter = columns
    ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${escapeXml(quoted)}!$A$1:$${last}$${lastRow}</definedName></definedNames>`
    : "";
  return (
    XML_HEAD +
    `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<sheets><sheet name="${escapeXml(name)}" sheetId="1" r:id="rId1"/></sheets>` +
    filter +
    `</workbook>`
  );
}

const STYLES_XML =
  XML_HEAD +
  `<styleSheet xmlns="${MAIN_NS}">` +
  `<numFmts count="3">` +
  `<numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0.00;-&quot;₹&quot;#,##0.00"/>` +
  `<numFmt numFmtId="165" formatCode="d mmm yyyy"/>` +
  `<numFmt numFmtId="166" formatCode="0.0%"/>` +
  `</numFmts>` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="5">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

const CONTENT_TYPES =
  XML_HEAD +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  XML_HEAD +
  `<Relationships xmlns="${PKG_REL_NS}">` +
  `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const WORKBOOK_RELS =
  XML_HEAD +
  `<Relationships xmlns="${PKG_REL_NS}">` +
  `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/>` +
  `</Relationships>`;

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The workbook's parts before zipping, for tests and debugging. */
export function xlsxParts(label: string, columns: ReportColumn[], rows: Record<string, unknown>[]): Record<string, string> {
  const name = sheetName(label);
  return {
    "[Content_Types].xml": CONTENT_TYPES,
    "_rels/.rels": ROOT_RELS,
    "xl/workbook.xml": workbookXml(name, columns.length, rows.length + 1),
    "xl/_rels/workbook.xml.rels": WORKBOOK_RELS,
    "xl/styles.xml": STYLES_XML,
    "xl/worksheets/sheet1.xml": worksheetXml(columns, rows),
  };
}

export function toXlsx(label: string, columns: ReportColumn[], rows: Record<string, unknown>[]): Uint8Array {
  const parts = xlsxParts(label, columns, rows);
  // A fixed timestamp keeps the file byte-for-byte reproducible for the same data.
  const mtime = new Date("2020-01-01T00:00:00Z");
  return zipSync(
    Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, [strToU8(xml), { level: 6, mtime }]])),
  );
}
