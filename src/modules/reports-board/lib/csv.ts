/**
 * CSV export (RFC 4180, UTF-8 with a byte-order mark so Excel reads ₹ and Indian names).
 *
 * Formula injection: a spreadsheet treats a cell that starts with =, +, - or @ (or a tab or
 * carriage return) as a formula, so a student named "=HYPERLINK(...)" could run code on an
 * accountant's machine. Every text cell like that gets a leading apostrophe. Numeric columns
 * are written as plain numbers, so a negative mark such as -2.5 stays a number.
 */
import type { ReportColumn } from "@/contracts/module";
import { isBlank, toDateString, toNumber } from "./format";

// Also the full-width equals, plus, minus and at signs, which some spreadsheet apps normalise before parsing.
const DANGEROUS_START = /^[=+\-@\t\r\uFF1D\uFF0B\uFF0D\uFF20]/;

/** Prefix a text value with an apostrophe when a spreadsheet would read it as a formula. */
export function guardFormula(text: string): string {
  return DANGEROUS_START.test(text) || DANGEROUS_START.test(text.trimStart()) ? `'${text}` : text;
}

function quote(field: string): string {
  return /[",\r\n]/.test(field) || field !== field.trim() ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Plain number text without exponent or grouping: 12000.5, -3. */
function plainNumber(n: number): string {
  if (Object.is(n, -0)) return "0";
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(20).replace(/\.?0+$/, "") : s;
}

/** One value as CSV text. Money becomes rupees with two decimals; percent stays 0–100. */
export function csvValue(value: unknown, type: ReportColumn["type"]): string {
  if (isBlank(value)) return "";
  if (type === "money" || type === "number" || type === "percent") {
    const n = toNumber(value);
    if (n !== null) return type === "money" ? (n / 100).toFixed(2) : plainNumber(n);
  }
  if (type === "date") {
    const d = toDateString(value);
    if (d !== null) return d;
  }
  const text = value instanceof Date ? value.toISOString() : String(value);
  return guardFormula(text);
}

/** The header shown for a column: "Total (₹)", "Score (%)". */
export function csvHeader(col: ReportColumn): string {
  const unit = col.type === "money" ? " (₹)" : col.type === "percent" ? " (%)" : "";
  return guardFormula(`${col.label}${unit}`);
}

export function toCsv(columns: ReportColumn[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => quote(csvHeader(c))).join(",")];
  for (const row of rows) lines.push(columns.map((c) => quote(csvValue(row[c.key], c.type))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}
