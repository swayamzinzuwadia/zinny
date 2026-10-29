/**
 * Calendar helpers for reports and insights. Pure, no database. Dates are "YYYY-MM-DD"
 * strings in the university's time zone; weeks start on Monday; the Indian financial
 * year starts on 1 April.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in "YYYY-MM-DD" form (rejects 2026-02-30 and friends). */
export function isDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** First day of the month containing `date`. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** First day of the month `n` months after the month containing `date` (n may be negative). */
export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

/** Last day of the month containing `date`. */
export function monthEnd(date: string): string {
  return addDays(addMonths(date, 1), -1);
}

/** 1 April of the Indian financial year containing `date`. */
export function financialYearStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** Minutes east of UTC for `timezone` at the instant `at`. */
function offsetMinutes(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** The instant a wall-clock date and time happens in `timezone` ("2026-10-29", "09:00"). */
export function zonedInstant(date: string, time: string, timezone: string): Date {
  const [h, mi] = time.split(":").map(Number);
  const [y, mo, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset across a daylight-saving change.
  let at = guess - offsetMinutes(timezone, new Date(guess)) * 60_000;
  at = guess - offsetMinutes(timezone, new Date(at)) * 60_000;
  return new Date(at);
}

/** "09:00" or "09:00:00" → minutes since midnight. */
export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...opts });
const DAY_MONTH_YEAR = fmt({ day: "numeric", month: "short", year: "numeric" });
const DAY_MONTH = fmt({ day: "numeric", month: "short" });
const MONTH = fmt({ month: "short" });
const MONTH_YEAR = fmt({ month: "short", year: "numeric" });

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** "2026-10-29" → "29 Oct 2026". */
export function formatDay(date: string): string {
  return DAY_MONTH_YEAR.format(utc(date));
}

/** "2026-10-26" → "26 Oct". */
export function formatDayShort(date: string): string {
  return DAY_MONTH.format(utc(date));
}

/** "2026-10-01" → "Oct", or "Oct 2026" with the year. */
export function formatMonth(date: string, withYear = false): string {
  return (withYear ? MONTH_YEAR : MONTH).format(utc(date));
}

/** "26 Oct to 1 Nov 2026" for a week starting on `start`. */
export function formatWeek(start: string): string {
  return `${formatDayShort(start)} to ${formatDay(addDays(start, 6))}`;
}

/** "1 Oct to 29 Oct 2026", collapsing the first year when both dates share it. */
export function formatRange(from: string, to: string): string {
  if (from === to) return formatDay(from);
  return `${from.slice(0, 4) === to.slice(0, 4) ? formatDayShort(from) : formatDay(from)} to ${formatDay(to)}`;
}
