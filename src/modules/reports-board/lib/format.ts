/**
 * How report values look on screen. Pure, so the page, the charts and the tests share it.
 * Money is integer paise, percent is 0–100, dates are "YYYY-MM-DD". Any number may be
 * negative (negative marking in tests), and a value that doesn't match its column type is
 * shown as plain text rather than hidden.
 */
import type { ReportColumn } from "@/contracts/module";
import { formatDay } from "./dates";

export type ColumnType = ReportColumn["type"];

const DASH = "—";

const NUMBER = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const PERCENT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const RUPEES = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const RUPEES_PAISE = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A finite number from a number or a numeric string ("12", "-3.5"); otherwise null. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

/** "YYYY-MM-DD" from a date string, an ISO timestamp or a Date; otherwise null. */
export function toDateString(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return null;
}

export const isBlank = (value: unknown) => value === null || value === undefined || value === "";

/** ₹12,000 or ₹12,000.50 (paise shown only when there are any); negative as -₹500. */
export function formatMoney(paise: number): string {
  const rupees = paise / 100;
  return (Number.isInteger(rupees) ? RUPEES : RUPEES_PAISE).format(rupees);
}

/** Short money for chart axes: ₹950, ₹45K, ₹1.2L, ₹3.4Cr. */
export function formatMoneyShort(paise: number): string {
  const r = paise / 100;
  const sign = r < 0 ? "-" : "";
  const a = Math.abs(r);
  const trim = (n: number) => (Math.round(n * 10) / 10).toString();
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)}Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)}L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

export function formatNumber(n: number): string {
  return NUMBER.format(n);
}

export function formatPercent(n: number): string {
  return `${PERCENT.format(n)}%`;
}

/** 1 hour, 1.5 hours, 26 hours. */
export function formatHours(hours: number): string {
  const n = Math.round(hours * 10) / 10;
  return `${formatNumber(n)} ${n === 1 ? "hour" : "hours"}`;
}

/** One cell of a report table, as text. */
export function formatCell(value: unknown, type: ColumnType): string {
  if (isBlank(value)) return DASH;
  switch (type) {
    case "money": {
      const n = toNumber(value);
      return n === null ? String(value) : formatMoney(n);
    }
    case "number": {
      const n = toNumber(value);
      return n === null ? String(value) : formatNumber(n);
    }
    case "percent": {
      const n = toNumber(value);
      return n === null ? String(value) : formatPercent(n);
    }
    case "date": {
      const d = toDateString(value);
      return d === null ? String(value) : formatDay(d);
    }
    default:
      return value instanceof Date ? value.toISOString() : String(value);
  }
}

/** Numbers line up on the right; text and dates on the left. */
export const isNumericType = (type: ColumnType) => type === "money" || type === "number" || type === "percent";

/** Sum of a money or number column, ignoring blanks; null when nothing is numeric. */
export function columnTotal(rows: Record<string, unknown>[], key: string): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const n = toNumber(r[key]);
    if (n !== null) {
      total += n;
      any = true;
    }
  }
  return any ? total : null;
}
