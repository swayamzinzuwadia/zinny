/** Calendar helpers for this module. Dates are "YYYY-MM-DD" strings (contracts rule 4). */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Today in a time zone, "YYYY-MM-DD". */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "2026-11-08" → "8 Nov 2026"; with weekday → "Sun, 8 Nov". */
export function formatDate(date: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(opts.year !== false && !opts.weekday && { year: "numeric" }),
    ...(opts.weekday && { weekday: "short" }),
  }).format(new Date(`${date}T00:00:00Z`));
}

/** A moment shown in the university's time zone: "8 Nov 2026, 6:05 pm". */
export function formatMoment(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", or the date when older. */
export function relativeDay(at: Date, timezone: string, now = new Date()): string {
  const days = daysBetween(todayIn(timezone, at), todayIn(timezone, now));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return formatDate(todayIn(timezone, at));
}

/** "9 am", "7:30 pm" from "HH:MM[:SS]". */
export function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}
