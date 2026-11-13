import Link from "next/link";
import { buttonClass, cx } from "@/components/ui";
import { addDays, formatDate, formatTime, isoWeekday, weekStart, weekdayLabel } from "@/server/lib/dates";
import type { BatchTimetable, OffDay, TimetableDay } from "@/server/services/schedule";
import { toneOf } from "./plan-tab";

export type CalendarView = { mode: "week"; from: string } | { mode: "month"; month: string };

const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Which week or month to show. Without a choice: the week with today in it while the batch
 * runs, else its first week (not started) or its last week (finished).
 */
export function calendarView(q: { week?: string; month?: string }, batch: { startDate: string; endDate: string }, today: string): CalendarView {
  if (q.month && MONTH_RE.test(q.month)) return { mode: "month", month: q.month };
  if (q.week && DAY_RE.test(q.week)) return { mode: "week", from: weekStart(q.week) };
  const anchor = today < batch.startDate ? batch.startDate : today > batch.endDate ? batch.endDate : today;
  return { mode: "week", from: weekStart(anchor) };
}

const monthOf = (d: string) => d.slice(0, 7);
function addMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthName(month: string) {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`));
}

/** One class in a day: time, day number, sections with their faculty and topic. */
function ClassChip({ day, entry, index, fallbackFaculty, dense }: { day: TimetableDay; entry: TimetableDay["entries"][number]; index: Map<string, number>; fallbackFaculty: string[]; dense?: boolean }) {
  const faculty = entry.sections.length > 0 ? [...new Set(entry.sections.map((s) => s.facultyName).filter(Boolean))] : fallbackFaculty;
  const tone = entry.sections[0] ? toneOf(index.get(entry.sections[0].id) ?? 0) : null;
  return (
    <div className={cx("rounded-[12px] px-2.5 py-2 text-[12px] leading-snug", tone?.chip ?? "border border-line bg-surface")}>
      <div className="tabular opacity-80">
        {formatTime(entry.startTime)}–{formatTime(entry.endTime)} · Day {day.dayNumber}
      </div>
      {entry.sections.length > 0 ? (
        <div className="font-medium">{entry.sections.map((s) => s.title).join(" and ")}</div>
      ) : (
        <div className="font-medium text-warn">Nothing planned</div>
      )}
      {!dense && faculty.length > 0 && <div className="opacity-85">with {faculty.join(" and ")}</div>}
      {!dense && entry.sections.some((s) => s.topic) && <div className="opacity-75">{entry.sections.map((s) => s.topic).filter(Boolean).join(" · ")}</div>}
      {entry.kind !== "regular" && <div className="mt-0.5 text-[11px] opacity-75">{entry.kind === "extra" ? "Extra class" : "Moved here"}</div>}
    </div>
  );
}

function OffChip({ off }: { off: OffDay }) {
  return (
    <div className="rounded-[12px] border border-dashed border-line px-2.5 py-2 text-[12px] leading-snug text-muted">
      <span className="line-through">No class</span>
      <div>{off.kind === "moved" && off.movedTo ? `Moved to ${formatDate(off.movedTo, { weekday: true })}` : "Cancelled"}</div>
      {off.note && <div>{off.note}</div>}
    </div>
  );
}

/**
 * The batch's dated calendar on its overview: a week or a whole month, worked out from the
 * batch's dates, weekly timings, one-off changes and the day-number plan, with each class's
 * section and the faculty who teach it. Today is gold.
 */
export function BatchCalendar({
  base,
  view,
  timetable,
  sections,
  today,
  batch,
  fallbackFaculty,
}: {
  base: string;
  view: CalendarView;
  timetable: BatchTimetable;
  sections: { id: string }[];
  today: string;
  batch: { startDate: string; endDate: string };
  fallbackFaculty: string[];
}) {
  const index = new Map(sections.map((s, i) => [s.id, i]));
  const byDate = new Map(timetable.days.map((d) => [d.date, d]));
  const offByDate = new Map(timetable.offDays.map((d) => [d.date, d]));
  const link = (q: string) => `${base}?${q}`;

  let days: string[];
  let title: string;
  let prev: string;
  let next: string;
  let other: { label: string; href: string };
  let current: string;
  if (view.mode === "week") {
    days = Array.from({ length: 7 }, (_, i) => addDays(view.from, i));
    title = `Week of ${formatDate(view.from)}`;
    prev = link(`week=${addDays(view.from, -7)}`);
    next = link(`week=${addDays(view.from, 7)}`);
    other = { label: "Month", href: link(`month=${monthOf(view.from)}`) };
    current = link(`week=${weekStart(today)}`);
  } else {
    const first = `${view.month}-01`;
    const last = addDays(`${addMonth(view.month, 1)}-01`, -1);
    days = [];
    for (let d = weekStart(first); d <= last || isoWeekday(d) !== 1; d = addDays(d, 1)) days.push(d);
    title = monthName(view.month);
    prev = link(`month=${addMonth(view.month, -1)}`);
    next = link(`month=${addMonth(view.month, 1)}`);
    other = { label: "Week", href: link(`week=${weekStart(first <= today && today <= last ? today : first)}`) };
    current = link(`month=${monthOf(today)}`);
  }
  const inView = days.filter((d) => byDate.has(d) && (view.mode === "week" || monthOf(d) === view.month));
  const classes = inView.reduce((n, d) => n + byDate.get(d)!.entries.length, 0);
  const outside = (d: string) => d < batch.startDate || d > batch.endDate;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold">{title}</h2>
          <p className="text-[13px] text-muted">
            {classes === 0 ? "No classes" : `${classes} ${classes === 1 ? "class" : "classes"}`}
            {inView.length > 0 && ` · Days ${byDate.get(inView[0])!.dayNumber}${inView.length > 1 ? `–${byDate.get(inView[inView.length - 1])!.dayNumber}` : ""} of ${timetable.classDays}`}
          </p>
        </div>
        <nav aria-label="Calendar" className="flex flex-wrap items-center gap-2">
          <Link href={prev} className={buttonClass("secondary", "sm")} scroll={false}>
            Previous
          </Link>
          <Link href={current} className={buttonClass("secondary", "sm")} scroll={false}>
            {view.mode === "week" ? "This week" : "This month"}
          </Link>
          <Link href={next} className={buttonClass("secondary", "sm")} scroll={false}>
            Next
          </Link>
          <Link href={other.href} className={buttonClass("ghost", "sm")} scroll={false}>
            Show {other.label.toLowerCase()}
          </Link>
        </nav>
      </div>

      {view.mode === "week" ? (
        // One row per day: the classes read in full whatever the width of the column.
        <ul className="space-y-1.5">
          {days.map((d) => {
            const day = byDate.get(d);
            const off = offByDate.get(d);
            const isToday = d === today;
            return (
              <li
                key={d}
                className={cx(
                  "flex min-w-0 flex-col gap-2 rounded-[18px] border p-2 sm:flex-row sm:items-start",
                  isToday ? "border-gold bg-surface ring-2 ring-gold-soft" : "border-line bg-surface/70",
                  outside(d) && !day && "opacity-60",
                )}
              >
                <div className={cx("shrink-0 px-1 pt-1 text-[13px] font-medium sm:w-24", isToday ? "text-gold-strong" : "text-muted")}>
                  {weekdayLabel(isoWeekday(d))} <span className="font-normal">{Number(d.slice(8))}</span>
                  {isToday && <span className="block font-normal">Today</span>}
                </div>
                <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                  {day?.entries.map((e, i) => <ClassChip key={i} day={day} entry={e} index={index} fallbackFaculty={fallbackFaculty} />)}
                  {off && <OffChip off={off} />}
                  {!day && !off && <div className="px-1 pt-1 text-xs text-faint">No class</div>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          {/* Phones: the month as a list of class days. */}
          <ul className="space-y-2 sm:hidden">
            {days
              .filter((d) => monthOf(d) === view.month && (byDate.has(d) || offByDate.has(d)))
              .map((d) => {
                const day = byDate.get(d);
                const off = offByDate.get(d);
                return (
                  <li key={d} className={cx("rounded-[18px] border p-3", d === today ? "border-gold ring-2 ring-gold-soft" : "border-line bg-surface/70")}>
                    <div className={cx("mb-2 text-[13px] font-medium", d === today ? "text-gold-strong" : "text-muted")}>{formatDate(d, { weekday: true })}</div>
                    <div className="space-y-1.5">
                      {day?.entries.map((e, i) => <ClassChip key={i} day={day} entry={e} index={index} fallbackFaculty={fallbackFaculty} />)}
                      {off && <OffChip off={off} />}
                    </div>
                  </li>
                );
              })}
            {!days.some((d) => monthOf(d) === view.month && (byDate.has(d) || offByDate.has(d))) && <li className="text-[14px] text-muted">No classes this month.</li>}
          </ul>
          {/* Wider screens: the month grid. */}
          <div className="hidden sm:block">
            <div className="grid grid-cols-7 gap-1.5 pb-1.5 text-center text-[12px] text-muted">
              {[1, 2, 3, 4, 5, 6, 7].map((w) => (
                <div key={w}>{weekdayLabel(w)}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {days.map((d) => {
                const day = byDate.get(d);
                const off = offByDate.get(d);
                const inMonth = monthOf(d) === view.month;
                const isToday = d === today;
                return (
                  <Link
                    key={d}
                    href={link(`week=${weekStart(d)}`)}
                    scroll={false}
                    aria-label={`${formatDate(d, { weekday: true })}${day ? `, Day ${day.dayNumber}` : ""}: open this week`}
                    className={cx(
                      "block min-h-[86px] min-w-0 rounded-[14px] border p-1.5 text-[11.5px] leading-snug transition hover:border-brand/50",
                      isToday ? "border-gold bg-surface ring-2 ring-gold-soft" : "border-line bg-surface/70",
                      !inMonth && "opacity-45",
                    )}
                  >
                    <div className={cx("mb-1 flex justify-between gap-1", isToday ? "font-medium text-gold-strong" : "text-muted")}>
                      <span>{Number(d.slice(8))}</span>
                      {day && <span className="tabular">Day {day.dayNumber}</span>}
                    </div>
                    {day?.entries.map((e, i) => {
                      const tone = e.sections[0] ? toneOf(index.get(e.sections[0].id) ?? 0) : null;
                      return (
                        <div key={i} className="mb-0.5 flex min-w-0 items-start gap-1" title={`${formatTime(e.startTime)}–${formatTime(e.endTime)} ${e.sections.map((s) => s.title).join(", ")}`}>
                          <span className={cx("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", tone?.dot ?? "bg-faint")} aria-hidden />
                          <span className="min-w-0 truncate">
                            {day.entries.length > 1 && `${formatTime(e.startTime)} `}
                            {e.sections.length ? e.sections.map((s) => s.title).join(", ") : "Not planned"}
                          </span>
                        </div>
                      );
                    })}
                    {off && <div className="text-muted line-through">{off.kind === "moved" ? "Moved" : "Cancelled"}</div>}
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
