/**
 * Pure time rules for live classes: no database, so they are easy to test exhaustively.
 *
 * Class times are wall-clock times in the university's time zone. Everything that
 * compares "now" with a class works on real instants (Date), converted with the zone,
 * so a class near midnight or in a zone with daylight saving behaves correctly.
 */

/** Faculty may start a class this many minutes before it begins. */
export const START_OPENS_MINUTES = 60;
/** Students can join from this many minutes before the start… */
export const JOIN_OPENS_MINUTES = 15;
/** …and are late when they join more than this many minutes after it. */
export const LATE_AFTER_MINUTES = 10;
/** The learner home card shows a class starting within this many minutes. */
export const JOIN_NEXT_WINDOW_MINUTES = 120;
/** Default attendance threshold when a university hasn't set one. */
export const DEFAULT_THRESHOLD_PERCENT = 75;
/** Weekly alerts go out only once a student has had at least this many classes in the batch. */
export const MIN_CLASSES_FOR_ALERT = 3;

const MINUTE = 60_000;
const DAY = 86_400_000;

export type AttendanceStatus = "present" | "late" | "absent";
export const ATTENDANCE_STATUSES: readonly AttendanceStatus[] = ["present", "late", "absent"];
export const STATUS_LABEL: Record<AttendanceStatus, string> = { present: "Present", late: "Late", absent: "Absent" };

/* ─────────────── Parsing ─────────────── */

/** "09:00:00" or "9:00" → "09:00". */
export function hhmm(t: string): string {
  const [h, m] = t.split(":");
  return `${(h ?? "0").padStart(2, "0")}:${(m ?? "0").padStart(2, "0")}`;
}

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isClockTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string): boolean {
  return UUID.test(s);
}

/* ─────────────── Calendar dates ("YYYY-MM-DD") ─────────────── */

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

export function minDate(a: string, b: string) {
  return a < b ? a : b;
}
export function maxDate(a: string, b: string) {
  return a > b ? a : b;
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/* ─────────────── Display ─────────────── */

/** "09:00" → "9 am", "19:30" → "7:30 pm". */
export function formatTime(t: string): string {
  const mins = toMinutes(t);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "2026-11-07" → "Sat, 7 Nov" (default), or "7 Nov 2026" with `{ year: true }`. */
export function formatDay(date: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const weekday = opts.weekday ?? !opts.year;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(opts.year && { year: "numeric" }),
    ...(weekday && { weekday: "short" }),
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "Today", "Tomorrow", "Yesterday" or "Sat, 7 Nov". */
export function relativeDay(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatDay(date);
}

/** The same inside a sentence: "today", "tomorrow", "yesterday" or "on Sat, 7 Nov". */
export function relativeDayInline(date: string, today: string): string {
  const d = relativeDay(date, today);
  return d === "Today" || d === "Tomorrow" || d === "Yesterday" ? d.toLowerCase() : `on ${d}`;
}

/* ─────────────── Instants in a time zone ─────────────── */

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string) {
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

/** The wall-clock date and time ("YYYY-MM-DD", "HH:MM") of an instant in a time zone. */
export function localParts(at: Date, tz: string): { date: string; time: string; seconds: number } {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, seconds: Number(p.second) };
}

/** Today, "YYYY-MM-DD", in a time zone. */
export function localDate(at: Date, tz: string): string {
  return localParts(at, tz).date;
}

function offsetMs(tz: string, at: Date): number {
  const { date, time, seconds } = localParts(at, tz);
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, seconds) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a wall-clock date and time happens in a time zone. */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(tz, new Date(guess));
  // A second pass settles instants near a daylight-saving change.
  return new Date(guess - offsetMs(tz, new Date(first)));
}

/** "9:42 am" for an instant, in the university's time zone. */
export function clockIn(at: Date, tz: string): string {
  return formatTime(localParts(at, tz).time);
}

/* ─────────────── Sessions ─────────────── */

export type SessionTimes = { date: string; startTime: string; endTime: string };
export type SessionWindow = { opensAt: Date; startsAt: Date; endsAt: Date };

export function sessionWindow(s: SessionTimes, tz: string): SessionWindow {
  const startsAt = zonedInstant(s.date, hhmm(s.startTime), tz);
  const endsAt = zonedInstant(s.date, hhmm(s.endTime), tz);
  return {
    opensAt: new Date(startsAt.getTime() - JOIN_OPENS_MINUTES * MINUTE),
    startsAt,
    // A class that ends "before" it starts runs past midnight.
    endsAt: endsAt.getTime() <= startsAt.getTime() ? new Date(endsAt.getTime() + DAY) : endsAt,
  };
}

/**
 * Where a class is relative to now: upcoming (join not open yet), open (joinable, not
 * started), live (started, not ended), ended.
 */
export type SessionState = "upcoming" | "open" | "live" | "ended";

export function sessionState(w: SessionWindow, now: Date): SessionState {
  const t = now.getTime();
  if (t < w.opensAt.getTime()) return "upcoming";
  if (t < w.startsAt.getTime()) return "open";
  if (t < w.endsAt.getTime()) return "live";
  return "ended";
}

/** Students may join from 15 minutes before the start until the end. */
export function canJoinAt(w: SessionWindow, now: Date): boolean {
  const s = sessionState(w, now);
  return s === "open" || s === "live";
}

/** Faculty can start a class from an hour before it begins until it ends. */
export function startable(s: { state: SessionState; window: SessionWindow }, now = new Date()): boolean {
  return s.state !== "ended" && s.window.startsAt.getTime() - now.getTime() <= START_OPENS_MINUTES * 60_000;
}

/** Present, or late when joining more than 10 minutes after the start. */
export function statusForJoin(w: SessionWindow, joinedAt: Date): "present" | "late" {
  return joinedAt.getTime() - w.startsAt.getTime() > LATE_AFTER_MINUTES * MINUTE ? "late" : "present";
}

/**
 * Picks the class a link means when a batch has more than one class on a date: the one
 * asked for (by start time), else the one joinable now, else the next to open, else the
 * last one of the day.
 */
export function pickSession<T extends SessionTimes>(sessions: T[], now: Date, tz: string, start?: string | null): T | null {
  if (sessions.length === 0) return null;
  if (start) return sessions.find((s) => hhmm(s.startTime) === hhmm(start)) ?? null;
  const withWindow = sessions
    .map((s) => ({ s, w: sessionWindow(s, tz) }))
    .sort((a, b) => a.w.startsAt.getTime() - b.w.startsAt.getTime());
  const open = withWindow.find((x) => canJoinAt(x.w, now));
  if (open) return open.s;
  const next = withWindow.find((x) => x.w.opensAt.getTime() > now.getTime());
  if (next) return next.s;
  return withWindow[withWindow.length - 1].s;
}

/** Only web links are followed: anything else (javascript:, data:, a typo) counts as no link. */
export function safeMeetingUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Attended (present or late) as a whole percentage, or null when no class has been held. */
export function percent(attended: number, held: number): number | null {
  if (held <= 0) return null;
  return Math.round((attended / held) * 100);
}

/** "in 45 min", "in 1 h 20 min". */
export function startsIn(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / MINUTE));
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}
