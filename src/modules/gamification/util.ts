/**
 * Small pure helpers: dates in a time zone, period starts, name display, ranking and
 * attendance streaks. No database access, so they're easy to test.
 *
 * Dates are "YYYY-MM-DD" strings. These are local to the module because core's date
 * helpers are not part of the public core API.
 */
import type { Period } from "./catalog";
import type { NameDisplay } from "./schema";

/* ───────────────────────────── Dates ───────────────────────────── */

/** The calendar date of `at` in a time zone. */
export function dateIn(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: string): boolean {
  return ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
}

/** "2026-11-08" → "8 Nov 2026" (or "8 Nov" without the year). */
export function formatDay(date: string, opts: { year?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(opts.year !== false && { year: "numeric" }),
  }).format(new Date(`${date}T00:00:00Z`));
}

/** First day of the period that contains `today`, or null for all time. Weeks start on Monday. */
export function periodStart(today: string, period: Period): string | null {
  if (period === "week") return weekStart(today);
  if (period === "month") return `${today.slice(0, 7)}-01`;
  return null;
}

/* ───────────────────────────── Names ───────────────────────────── */

/**
 * How a student's name shows to other students. "first_initial": "Riya Sharma" → "Riya S.".
 * A single name stays as it is.
 */
export function displayName(name: string, mode: NameDisplay): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name;
  if (mode === "full" || parts.length === 1) return parts.join(" ");
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.charAt(0).toLocaleUpperCase("en-IN")}.`;
}

/* ───────────────────────────── Ranking ───────────────────────────── */

/**
 * Highest points first. Ties share a rank and the next rank skips ("1, 2, 2, 4"),
 * the way sports tables count. Within a tie, rows are listed by name.
 */
export function rankRows<T extends { points: number; name: string; userId: string }>(rows: readonly T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "en-IN") || a.userId.localeCompare(b.userId));
  let rank = 0;
  let prev: number | null = null;
  return sorted.map((r, i) => {
    if (prev === null || r.points !== prev) {
      rank = i + 1;
      prev = r.points;
    }
    return { ...r, rank };
  });
}

/* ───────────────────────────── Attendance streaks ───────────────────────────── */

/**
 * Longest run of consecutive weeks (Monday to Sunday) in which the student attended
 * every class that was marked (present or late) and was marked for at least one.
 * An absence, or a week with no marked class, ends the run.
 * `marks` holds the latest mark of each class session.
 */
export function longestAttendanceStreak(marks: readonly { date: string; status: string }[]): number {
  const weeks = new Map<string, { attended: number; absent: number }>();
  for (const m of marks) {
    const w = weekStart(m.date);
    const cur = weeks.get(w) ?? { attended: 0, absent: 0 };
    if (m.status === "present" || m.status === "late") cur.attended++;
    else cur.absent++;
    weeks.set(w, cur);
  }
  const good = [...weeks.entries()]
    .filter(([, v]) => v.attended > 0 && v.absent === 0)
    .map(([w]) => w)
    .sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const w of good) {
    run = prev !== null && addDays(prev, 7) === w ? run + 1 : 1;
    best = Math.max(best, run);
    prev = w;
  }
  return best;
}

/* ───────────────────────────── Misc ───────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}
