/**
 * Quiet hours: no SMS or WhatsApp from 9 pm to 8 am in the university's time zone.
 * Security messages (sign-in codes, password resets) are exempt; callers decide that.
 */
export const QUIET_START_MINUTES = 21 * 60;
export const QUIET_END_MINUTES = 8 * 60;

/** Local wall-clock date and minutes since midnight in a time zone. */
export function localClock(timezone: string, at: Date): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Offset of a time zone from UTC at an instant, in milliseconds (IST → +19 800 000). */
function offsetMs(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a wall-clock time happens in a time zone ("2026-11-02", 8:00 in Asia/Kolkata → 02:30 UTC). */
export function zonedInstant(date: string, minutes: number, timezone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  let at = guess - offsetMs(timezone, new Date(guess));
  // Once more, in case the offset differs at the corrected instant (a daylight-saving change).
  at = guess - offsetMs(timezone, new Date(at));
  return new Date(at);
}

export function isQuietHours(timezone: string, at: Date): boolean {
  const { minutes } = localClock(timezone, at);
  return minutes >= QUIET_START_MINUTES || minutes < QUIET_END_MINUTES;
}

/** When quiet hours end next (8 am local), or `at` itself when it's not quiet hours. */
export function quietHoursEnd(timezone: string, at: Date): Date {
  const { date, minutes } = localClock(timezone, at);
  if (minutes >= QUIET_END_MINUTES && minutes < QUIET_START_MINUTES) return at;
  const day = minutes >= QUIET_START_MINUTES ? nextDate(date) : date;
  return zonedInstant(day, QUIET_END_MINUTES, timezone);
}

function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A valid IANA zone, or India's when the stored one is unusable. */
export function safeTimezone(tz: string | null | undefined): string {
  try {
    if (tz) {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    }
  } catch {
    /* fall through */
  }
  return "Asia/Kolkata";
}
