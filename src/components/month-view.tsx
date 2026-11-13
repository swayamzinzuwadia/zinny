import Link from "next/link";
import type { Session } from "@/server/services/schedule";
import { addDays, formatDate, formatTime, isoWeekday, weekStart, weekdayLabel } from "@/server/lib/dates";
import { cx } from "./ui";

/** The same quiet course colours as the week view, as dots. No gold: it marks today and clashes. */
const DOTS = ["bg-brand", "bg-[#2f4a72]", "bg-[#7a3d66]", "bg-[#7a4a2d]"];

/** First and last day of a "YYYY-MM" month, and the grid's Monday-to-Sunday days around it. */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const next = new Date(Date.UTC(y, m, 1));
  const last = addDays(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`, -1);
  const days: string[] = [];
  for (let d = weekStart(first); d <= last || isoWeekday(d) !== 1; d = addDays(d, 1)) days.push(d);
  return { first, last, days, gridFrom: days[0], gridTo: days[days.length - 1] };
}

/** "2026-11" plus or minus some months. */
export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthTitle(month: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`));
}

/**
 * A month of classes. Wide screens get a grid (each day opens its week); phones get the
 * month's class days as a list. Today is gold; so is a class that clashes with another.
 */
export function MonthView({ month, today, sessions, weekHref }: { month: string; today: string; sessions: Session[]; weekHref: (from: string) => string }) {
  const { days } = monthRange(month);
  const courseIds = [...new Set(sessions.map((s) => s.courseId))];
  const dot = (id: string) => DOTS[courseIds.indexOf(id) % DOTS.length];
  const on = (d: string) => sessions.filter((s) => s.date === d);
  const inMonth = (d: string) => d.slice(0, 7) === month;
  const listDays = days.filter((d) => inMonth(d) && on(d).length > 0);

  return (
    <div>
      <ul className="space-y-2 sm:hidden">
        {listDays.map((d) => (
          <li key={d} className={cx("rounded-[18px] border p-3", d === today ? "border-gold bg-surface ring-2 ring-gold-soft" : "border-line bg-surface/70")}>
            <div className={cx("mb-1.5 text-[13px] font-medium", d === today ? "text-gold-strong" : "text-muted")}>{d === today ? "Today" : formatDate(d, { weekday: true })}</div>
            <ul className="space-y-1">
              {on(d).map((s, i) => (
                <li key={i} className={cx("flex items-start gap-2 text-[14px]", s.clashesWith && "rounded-lg bg-gold-soft px-2 py-1")}>
                  <span className={cx("mt-[7px] h-2 w-2 shrink-0 rounded-full", dot(s.courseId))} aria-hidden />
                  <span className="min-w-0">
                    <span className="tabular">{formatTime(s.startTime)}</span> {s.courseTitle}
                    {s.section && <span className="text-muted"> · {s.section}</span>}
                    {s.clashesWith && <span className="block text-[12.5px] font-medium text-gold-strong">Clashes with {[...new Set(s.clashesWith.map((c) => c.courseTitle))].join(" and ")}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {listDays.length === 0 && <li className="text-[14px] text-muted">No classes this month.</li>}
      </ul>

      <div className="hidden sm:block">
        <div className="grid grid-cols-7 gap-1.5 pb-1.5 text-center text-[12px] text-muted">
          {[1, 2, 3, 4, 5, 6, 7].map((w) => (
            <div key={w}>{weekdayLabel(w)}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((d) => {
            const items = on(d);
            const isToday = d === today;
            return (
              <Link
                key={d}
                href={weekHref(weekStart(d))}
                scroll={false}
                aria-label={`${formatDate(d, { weekday: true })}, ${items.length} ${items.length === 1 ? "class" : "classes"}: open this week`}
                className={cx(
                  "block min-h-[92px] min-w-0 rounded-[14px] border p-1.5 text-[11.5px] leading-snug transition hover:border-brand/50",
                  isToday ? "border-gold bg-surface ring-2 ring-gold-soft" : "border-line bg-surface/70",
                  !inMonth(d) && "opacity-45",
                )}
              >
                <div className={cx("mb-1", isToday ? "font-medium text-gold-strong" : "text-muted")}>{Number(d.slice(8))}</div>
                {items.slice(0, 3).map((s, i) => (
                  <div key={i} className={cx("mb-0.5 flex min-w-0 items-start gap-1", s.clashesWith && "rounded bg-gold-soft text-gold-strong")} title={`${formatTime(s.startTime)}–${formatTime(s.endTime)} ${s.courseTitle}`}>
                    <span className={cx("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", dot(s.courseId))} aria-hidden />
                    <span className="min-w-0 truncate">
                      {formatTime(s.startTime)} {s.courseTitle}
                    </span>
                  </div>
                ))}
                {items.length > 3 && <div className="text-muted">{items.length - 3} more</div>}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
