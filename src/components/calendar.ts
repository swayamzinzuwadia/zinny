/** Date and time arithmetic for the pickers, on Zinny's `YYYY-MM-DD` and `HH:mm` strings. */

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const pad = (n: number) => String(n).padStart(2, "0");

/** `month` counts from 0, as in Date. */
export const ymd = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

export function parseDay(s: string | undefined | null): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  return m ? { year: +m[1], month: +m[2] - 1, day: +m[3] } : null;
}

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Monday is 0. */
function weekday(year: number, month: number, day: number) {
  return (new Date(Date.UTC(year, month, day)).getUTCDay() + 6) % 7;
}

export function addDays(s: string, by: number): string {
  const d = parseDay(s);
  if (!d) return s;
  const t = new Date(Date.UTC(d.year, d.month, d.day + by));
  return ymd(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

/** The same day in another month, or that month's last day if it is shorter. */
export function addMonths(s: string, by: number): string {
  const d = parseDay(s);
  if (!d) return s;
  const first = new Date(Date.UTC(d.year, d.month + by, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  return ymd(year, month, Math.min(d.day, daysIn(year, month)));
}

export function startOfWeek(s: string): string {
  const d = parseDay(s);
  return d ? addDays(s, -weekday(d.year, d.month, d.day)) : s;
}

/** One month as calendar cells, Monday first, with nulls before the 1st. */
export function monthCells(year: number, month: number): (string | null)[] {
  const blanks: null[] = Array.from({ length: weekday(year, month, 1) }, () => null);
  return [...blanks, ...Array.from({ length: daysIn(year, month) }, (_, i) => ymd(year, month, i + 1))];
}

/** "2 Nov 2026" */
export function showDay(s: string): string {
  const d = parseDay(s);
  return d ? `${d.day} ${MONTHS[d.month].slice(0, 3)} ${d.year}` : "";
}

/** "Monday, 2 November 2026", for screen readers. */
export function longDay(s: string): string {
  const d = parseDay(s);
  return d ? `${WEEKDAY_NAMES[weekday(d.year, d.month, d.day)]}, ${d.day} ${MONTHS[d.month]} ${d.year}` : "";
}

/** Today on this device. */
export function deviceToday(): string {
  const now = new Date();
  return ymd(now.getFullYear(), now.getMonth(), now.getDate());
}

export type Clock = { hour: number; minute: number; pm: boolean };

/** "14:30" → 2:30 PM. Hours run 1 to 12. */
export function parseClock(s: string | undefined | null): Clock | null {
  const m = /^(\d{2}):(\d{2})/.exec(s ?? "");
  if (!m) return null;
  const h = +m[1];
  return { hour: h % 12 || 12, minute: +m[2], pm: h >= 12 };
}

export const clockValue = ({ hour, minute, pm }: Clock) => `${pad((hour % 12) + (pm ? 12 : 0))}:${pad(minute)}`;

/** "2:30 PM" */
export function showClock(s: string): string {
  const c = parseClock(s);
  return c ? `${c.hour}:${pad(c.minute)} ${c.pm ? "PM" : "AM"}` : "";
}

/** Five-minute steps, plus the saved minute when it falls between them. */
export function minuteSteps(saved?: number): number[] {
  const steps = Array.from({ length: 12 }, (_, i) => i * 5);
  return saved === undefined || steps.includes(saved) ? steps : [...steps, saved].sort((a, b) => a - b);
}
