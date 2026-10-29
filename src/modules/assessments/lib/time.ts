/**
 * Moments in a university's time zone. Test windows are stored as timestamps; staff type
 * them as local date and time ("2026-11-03T10:00") in the university's own zone.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** How far the zone is ahead of UTC at this instant, in milliseconds. */
function offsetMs(at: Date, timezone: string): number {
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
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2})?$/;

/** "2026-11-03T10:00" in the zone → the instant. Null for an empty or malformed value. */
export function zonedToUtc(local: string, timezone: string): Date | null {
  const m = LOCAL_RE.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMs(new Date(guess), timezone);
  const second = guess - offsetMs(new Date(first), timezone);
  return new Date(second);
}

/** The instant as "YYYY-MM-DDTHH:MM" in the zone, for a datetime-local input. */
export function utcToZonedInput(at: Date | null | undefined, timezone: string): string {
  if (!at) return "";
  const local = new Date(at.getTime() + offsetMs(at, timezone));
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** "YYYY-MM-DD" of the instant in the zone. */
export function zonedDate(at: Date, timezone: string): string {
  return utcToZonedInput(at, timezone).slice(0, 10);
}

/** "Tue 3 Nov, 10:00 am" (the year only when it isn't this year). */
export function formatMoment(at: Date | null | undefined, timezone: string, now = new Date()): string {
  if (!at) return "";
  const sameYear = zonedDate(at, timezone).slice(0, 4) === zonedDate(now, timezone).slice(0, 4);
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const time = `${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
  return `${get("weekday")} ${get("day")} ${get("month")}${sameYear ? "" : ` ${get("year")}`}, ${time}`;
}

/** "45 min", "1 h", "1 h 30 min". */
export function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
