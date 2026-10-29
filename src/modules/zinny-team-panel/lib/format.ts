/**
 * Dates, times and money for the Zinny team panel. The Zinny team works in India time:
 * cross-university numbers (weeks, months, "today") use Asia/Kolkata.
 * Dates are "YYYY-MM-DD" strings; money is integer paise.
 */

export const ZINNY_TZ = "Asia/Kolkata";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in "YYYY-MM-DD" form. */
export function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function todayIST(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZINNY_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const [y, m, day] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, day === 0 ? -6 : 1 - day);
}

/** "2026-10" for a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Indian financial year (April to March): 2026-10-28 → "26-27". */
export function financialYear(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** First day of the financial year containing `date`. */
export function financialYearStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** "2026-11-08" → "8 Nov 2026". */
export function formatDate(date: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(opts.year !== false && { year: "numeric" }),
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "2026-10" → "Oct 2026" (or "Oct" without the year). */
export function formatMonth(month: string, opts: { year?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short", ...(opts.year !== false && { year: "numeric" }) }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
}

/** A moment in India time: "29 Oct 2026, 3:42 pm". */
export function formatDateTime(at: Date | null | undefined): string {
  if (!at) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: ZINNY_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(at)
    .replace(/\b(AM|PM)\b/, (s) => s.toLowerCase());
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function timeAgo(at: Date, now = new Date()): string {
  const mins = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

/** "in 45 min", "in 2 h". For a moment in the future. */
export function timeUntil(at: Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((at.getTime() - now.getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const INR_PAISE = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 12_000_00 → "₹12,000"; 1_234_56 → "₹1,234.56". */
export function formatINR(paise: number): string {
  return paise % 100 === 0 ? INR.format(paise / 100) : INR_PAISE.format(paise / 100);
}

/** Large amounts in lakh and crore: 4_80_000_00 → "₹4.8 L". For stat tiles. */
export function formatINRShort(paise: number): string {
  const rupees = paise / 100;
  if (rupees >= 1_00_00_000) return `₹${trim(rupees / 1_00_00_000)} Cr`;
  if (rupees >= 1_00_000) return `₹${trim(rupees / 1_00_000)} L`;
  return INR.format(Math.round(rupees));
}

function trim(n: number) {
  return n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2).replace(/\.?0+$/, "");
}

/** "1,234" in Indian grouping. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

/** "₹12,000.50" or "12000" → paise. Throws on anything that isn't a plain amount. */
export function parseRupees(v: string): number {
  const clean = v.replace(/[,₹\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return Number.NaN;
  return Math.round(Number(clean) * 100);
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
