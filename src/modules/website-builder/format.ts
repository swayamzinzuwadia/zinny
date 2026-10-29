/** Display helpers for the website (dates are "YYYY-MM-DD", times "HH:MM[:SS]", money integer paise). */

export function formatINR(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
  }).format(rupees);
}

/** "2026-11-08" → "8 Nov 2026"; with `{ year: false }` → "8 Nov". */
export function formatDate(date: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...(opts.year !== false && { year: "numeric" }),
    ...(opts.weekday && { weekday: "short" }),
  }).format(new Date(`${date}T00:00:00Z`));
}

/** A moment, in the university's time zone: "29 Oct 2026, 3:40 pm". */
export function formatMoment(at: Date | string, timezone: string, opts: { time?: boolean } = { time: true }): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(opts.time !== false && { hour: "numeric", minute: "2-digit", hour12: true }),
  })
    .format(d)
    .replace(/\b(am|pm)\b/i, (m) => m.toLowerCase());
}

/** "YYYY-MM-DD" for a moment in a time zone. */
export function dateIn(at: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    typeof at === "string" ? new Date(at) : at,
  );
}

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** "09:00" → "9 am", "19:30" → "7:30 pm". */
export function formatTime(t: string): string {
  const mins = toMinutes(t);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

const WEEKDAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Weekly timings in words: "Mon to Fri, 9 am to 11 am" or "Sat 10 am–1 pm, Sun 2 pm–5 pm". */
export function describeSlots(slots: { weekday: number; startTime: string; endTime: string }[]): string {
  if (slots.length === 0) return "Timings to be announced";
  const sorted = [...slots].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
  const same = sorted.every((s) => s.startTime === sorted[0].startTime && s.endTime === sorted[0].endTime);
  if (same) {
    const days = sorted.map((s) => s.weekday);
    const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
    const dayText =
      consecutive && days.length > 2
        ? `${WEEKDAYS[days[0]]} to ${WEEKDAYS[days[days.length - 1]]}`
        : days.map((d) => WEEKDAYS[d]).join(days.length === 2 ? " and " : ", ");
    return `${dayText}, ${formatTime(sorted[0].startTime)} to ${formatTime(sorted[0].endTime)}`;
  }
  return sorted.map((s) => `${WEEKDAYS[s.weekday]} ${formatTime(s.startTime)}–${formatTime(s.endTime)}`).join(", ");
}

/** "1 review", "3 reviews". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A short plain-text preview. */
export function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}

/** Initials for a monogram: "Demo University" → "DU". */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !["of", "and", "the", "for"].includes(w.toLowerCase()))
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 3)
    .join("");
}
