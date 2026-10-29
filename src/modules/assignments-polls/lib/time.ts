/**
 * Deadlines are instants; people enter and read them as a date and a time of day in the
 * university's time zone. These helpers convert between the two and word them for people.
 */
import { ValidationError } from "@/server/errors";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const formatters = new Map<string, Intl.DateTimeFormat>();
function zoned(tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

function wallClock(ms: number, tz: string) {
  const p = Object.fromEntries(zoned(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

/** How far the zone is ahead of UTC at this instant, in ms. */
function offsetAt(ms: number, tz: string) {
  const w = wallClock(ms, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

export function isDate(s: string) {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isTime(s: string) {
  return TIME.test(s);
}

/** "2026-11-14" + "23:59" in Asia/Kolkata → the instant. Throws a ValidationError naming `what` when malformed. */
export function zonedToInstant(date: string, time: string, tz: string, what = "date"): Date {
  if (!isDate(date)) throw new ValidationError(`Enter the ${what} as a date, like 2026-11-14.`);
  if (!isTime(time)) throw new ValidationError(`Enter the ${what} time as hours and minutes, like 23:59.`);
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ms = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(ms, tz);
  if (second !== ms) ms = second; // the offset changed between the guess and the answer (DST edge)
  return new Date(ms);
}

/** The instant as "YYYY-MM-DD" and "HH:MM" in the zone (for form defaults). */
export function instantToZoned(at: Date, tz: string): { date: string; time: string } {
  const w = wallClock(at.getTime(), tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${w.y}-${pad(w.mo)}-${pad(w.d)}`, time: `${pad(w.h)}:${pad(w.mi)}` };
}

function clock(at: Date, tz: string) {
  const { time } = instantToZoned(at, tz);
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function day(at: Date, tz: string, withYear = false) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withYear && { year: "numeric" }),
  }).format(at);
}

/** "Fri, 14 Nov, 11:59 pm" (the year is added when it isn't this year). */
export function formatWhen(at: Date, tz: string, now = new Date()): string {
  const withYear = instantToZoned(at, tz).date.slice(0, 4) !== instantToZoned(now, tz).date.slice(0, 4);
  return `${day(at, tz, withYear)}, ${clock(at, tz)}`;
}

function dayNumber(date: string) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Whole calendar days from `now` to `at` in the zone: 0 = today, 1 = tomorrow, -1 = yesterday. */
export function calendarDaysUntil(at: Date, tz: string, now = new Date()): number {
  return dayNumber(instantToZoned(at, tz).date) - dayNumber(instantToZoned(now, tz).date);
}

/** "Due today at 5 pm", "Due tomorrow at 11:59 pm", "Due Fri, 14 Nov, 11:59 pm", "Was due yesterday at 5 pm". */
export function dueLabel(at: Date, tz: string, now = new Date()): string {
  const days = calendarDaysUntil(at, tz, now);
  if (at.getTime() >= now.getTime()) {
    if (days === 0) return `Due today at ${clock(at, tz)}`;
    if (days === 1) return `Due tomorrow at ${clock(at, tz)}`;
    return `Due ${formatWhen(at, tz, now)}`;
  }
  if (days === 0) return `Was due today at ${clock(at, tz)}`;
  if (days === -1) return `Was due yesterday at ${clock(at, tz)}`;
  return `Was due ${formatWhen(at, tz, now)}`;
}

/** "in 3 days", "in 5 hours", "in 20 minutes", or "3 days ago" and so on. */
export function relative(at: Date, now = new Date()): string {
  const diff = at.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const text =
    mins < 60 ? `${Math.max(1, mins)} minute${mins === 1 ? "" : "s"}` : hours < 36 ? `${hours} hour${hours === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

/** "2026-11-14" plus n days. */
export function addDaysTo(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
