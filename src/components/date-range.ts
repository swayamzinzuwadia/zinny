/**
 * Date ranges for filters: presets (Today, Last 7 days, ...) and custom From-To, as plain
 * "YYYY-MM-DD" strings. Pure, so server pages, services and tests all use the same maths.
 * The caller passes "today" in the time zone the numbers are reported in.
 */

export const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "last-7-days", label: "Last 7 days" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "last-3-months", label: "Last 3 months" },
  { key: "this-year", label: "This year" },
] as const;

export type PresetKey = (typeof RANGE_PRESETS)[number]["key"];
export type RangeKey = PresetKey | "custom";
export const DEFAULT_RANGE: PresetKey = "this-month";

/** The longest custom range accepted, so a typo can't ask for a century of data. */
export const MAX_RANGE_DAYS = 1830;

export type DateRange = {
  key: RangeKey;
  label: string;
  /** First and last day, both included. */
  from: string;
  to: string;
  days: number;
  /** The period to compare with. */
  prev: { from: string; to: string };
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Moves by whole months, keeping the day where the month is long enough (31 Mar - 1 month = 28 Feb). */
export function shiftMonths(date: string, months: number): string {
  const [y, m, day] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

export function spanDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

const fmt = (date: string, year: boolean) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", ...(year && { year: "numeric" }) }).format(new Date(`${date}T00:00:00Z`));

/** "12 Oct to 3 Nov 2026", or "3 Nov 2026" for one day. */
export function describeSpan(from: string, to: string): string {
  if (from === to) return fmt(from, true);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${fmt(from, !sameYear)} to ${fmt(to, true)}`;
}

function build(key: RangeKey, from: string, to: string, prev: { from: string; to: string }, label?: string): DateRange {
  return { key, label: label ?? describeSpan(from, to), from, to, days: spanDays(from, to), prev };
}

/** The period right before a range, of the same length. */
function precedingSpan(from: string, to: string) {
  const days = spanDays(from, to);
  const prevTo = shiftDays(from, -1);
  return { from: shiftDays(prevTo, -(days - 1)), to: prevTo };
}

export function presetRange(key: PresetKey, today: string): DateRange {
  const label = RANGE_PRESETS.find((p) => p.key === key)!.label;
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (key) {
    case "today":
      return build(key, today, today, precedingSpan(today, today), label);
    case "last-7-days": {
      const from = shiftDays(today, -6);
      return build(key, from, today, precedingSpan(from, today), label);
    }
    case "this-month":
      // Compared with the same stretch of the month before (1 to 19 Nov against 1 to 19 Oct).
      return build(key, monthStart, today, { from: shiftMonths(monthStart, -1), to: shiftMonths(today, -1) }, label);
    case "last-month": {
      const from = shiftMonths(monthStart, -1);
      const to = shiftDays(monthStart, -1);
      return build(key, from, to, { from: shiftMonths(from, -1), to: shiftDays(from, -1) }, label);
    }
    case "last-3-months": {
      const from = shiftDays(shiftMonths(today, -3), 1);
      return build(key, from, today, precedingSpan(from, today), label);
    }
    case "this-year": {
      const from = `${today.slice(0, 4)}-01-01`;
      return build(key, from, today, { from: shiftMonths(from, -12), to: shiftMonths(today, -12) }, label);
    }
  }
}

/**
 * Reads `?range=` or `?from=&to=` from the address. A custom range wins when a date is
 * real; anything unreadable falls back to the default preset, so a bad link still opens.
 */
export function resolveRange(input: { range?: string | null; from?: string | null; to?: string | null }, today: string): DateRange {
  const { range, from, to } = input;
  if (isIsoDate(from) || isIsoDate(to)) {
    let a = isIsoDate(from) ? from : (to as string);
    let b = isIsoDate(to) ? to : today;
    if (a > b) [a, b] = [b, a];
    if (b > today) b = today;
    if (a > b) a = b;
    if (spanDays(a, b) <= MAX_RANGE_DAYS) return build("custom", a, b, precedingSpan(a, b));
  }
  const preset = RANGE_PRESETS.find((p) => p.key === range);
  return presetRange(preset?.key ?? DEFAULT_RANGE, today);
}

/** The address query for a range: presets use `range=`, a custom range uses `from=&to=`. */
export function rangeQuery(r: { key: RangeKey; from: string; to: string }): string {
  return r.key === "custom" ? `from=${r.from}&to=${r.to}` : `range=${r.key}`;
}

export type Granularity = "day" | "week" | "month";

/** Charts show days up to about a month, weeks up to four months, then months. */
export function granularityFor(days: number): Granularity {
  return days <= 31 ? "day" : days <= 125 ? "week" : "month";
}

function bucketStart(date: string, g: Granularity): string {
  if (g === "day") return date;
  if (g === "month") return `${date.slice(0, 7)}-01`;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return shiftDays(date, dow === 0 ? -6 : 1 - dow);
}

/** The start date of every bucket a range touches, in order. */
export function bucketsFor(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  let cur = bucketStart(from, g);
  while (cur <= to) {
    out.push(cur);
    cur = g === "day" ? shiftDays(cur, 1) : g === "week" ? shiftDays(cur, 7) : shiftMonths(cur, 1);
  }
  return out;
}

/** A short axis label for a bucket. */
export function bucketLabel(start: string, g: Granularity): string {
  if (g === "month") return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "short" }).format(new Date(`${start}T00:00:00Z`));
  return fmt(start, false);
}
