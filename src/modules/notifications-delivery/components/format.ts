/** "29 Oct, 9:41 pm" in the university's time zone. */
export function formatWhen(at: Date | null | undefined, timezone: string, now = new Date()): string {
  if (!at) return "";
  const sameYear = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, year: "numeric" });
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(sameYear.format(at) !== sameYear.format(now) && { year: "numeric" }),
  };
  return new Intl.DateTimeFormat("en-IN", opts).format(at).replace(/\b(AM|PM)\b/g, (m) => m.toLowerCase());
}
