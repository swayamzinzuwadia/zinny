"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, cx } from "@/components/ui";
import { addDays, formatDate, formatTime, isoWeekday, toMinutes, weekdayLabel } from "@/server/lib/dates";
import type { Session } from "@/server/services/schedule";

/** The section's own faculty when the day is planned, otherwise the batch's. */
const teachers = (s: Session) => (s.sectionFaculty?.length ? s.sectionFaculty : s.faculty);
const keyOf = (s: Session) => `${s.date} ${s.batchId} ${s.startTime}`;

/**
 * The week strip on the learner home: one button per day. Tapping a day lists that day's
 * classes below it. For today the list leaves out `onBoard` (the class the board above
 * already shows), and disappears when nothing else is left.
 */
export function DayAgenda({
  days,
  today,
  nowMin,
  sessions,
  onBoard,
  dotFor,
  timetableHref,
}: {
  days: string[];
  today: string;
  nowMin: number;
  sessions: Session[];
  onBoard: string | null;
  dotFor: Record<string, string>;
  timetableHref: string;
}) {
  const [picked, setPicked] = useState(today);
  const isToday = picked === today;
  const items = sessions.filter((s) => s.date === picked && !(isToday && keyOf(s) === onBoard));
  const title = isToday ? "Also today" : picked === addDays(today, 1) ? "Tomorrow" : formatDate(picked, { weekday: true });
  const empty = picked < today ? "No classes that day." : "Nothing scheduled that day.";

  function onKey(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = days.indexOf(picked);
    const next = days[(i + step + days.length) % days.length];
    setPicked(next);
    document.getElementById(`day-${next}`)?.focus();
  }

  return (
    <>
      <div role="tablist" aria-label="Days this week" onKeyDown={onKey} className="grid grid-cols-7 gap-1.5 sm:gap-3">
        {days.map((d) => {
          const count = sessions.filter((s) => s.date === d);
          const dayIsToday = d === today;
          const selected = d === picked;
          return (
            <button
              key={d}
              id={`day-${d}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="day-panel"
              aria-label={`${formatDate(d, { weekday: true })}${dayIsToday ? ", today" : ""}, ${count.length} class${count.length === 1 ? "" : "es"}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setPicked(d)}
              className={cx(
                "rounded-2xl border px-1 py-2 text-center [transition-property:background-color,border-color,transform] duration-150 active:scale-[0.96]",
                selected
                  ? "border-brand bg-brand text-canvas"
                  : dayIsToday
                    ? "border-gold bg-surface hover:border-gold-strong"
                    : "border-line bg-surface/70 hover:border-faint hover:bg-surface",
              )}
            >
              <div className={cx("text-[12px]", selected ? "text-canvas/75" : dayIsToday ? "font-medium text-gold-strong" : "text-muted")}>
                {weekdayLabel(isoWeekday(d))}
              </div>
              <div className="tabular text-[18px] font-medium leading-tight">{Number(d.slice(8))}</div>
              <div className="mt-1 flex h-1.5 justify-center gap-1">
                {count.slice(0, 4).map((s, i) => (
                  <span key={i} className={cx("h-1.5 w-1.5 rounded-full", selected ? "bg-canvas" : dotFor[s.courseId] ?? "bg-brand")} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      {isToday && items.length === 0 ? null : (
        <Card id="day-panel" role="tabpanel" aria-label={title} className="p-5">
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <h2 className="text-[16px] font-medium">{title}</h2>
            <div className="flex items-baseline gap-4 text-[13px]">
              {!isToday && (
                <button type="button" onClick={() => setPicked(today)} className="py-1 text-brand hover:underline">
                  Back to today
                </button>
              )}
              <Link href={timetableHref} className="py-1 font-medium text-brand hover:underline">
                Full timetable
              </Link>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="py-2 text-[14px] text-muted">{empty}</p>
          ) : (
            <ul className="-mb-3 divide-y divide-line">
              {items.map((s, i) => {
                const done = picked < today || (isToday && toMinutes(s.endTime) <= nowMin);
                const now = isToday && !done && toMinutes(s.startTime) <= nowMin;
                return (
                  <li key={i} className={cx("flex gap-3 py-3", done && "opacity-60")}>
                    <span
                      aria-hidden
                      className={cx("mt-[7px] h-2 w-2 shrink-0 rounded-full", now ? "now-dot bg-gold" : dotFor[s.courseId] ?? "bg-brand")}
                    />
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium">{s.courseTitle}</div>
                      <div className="tabular text-[13px] text-muted">
                        {formatTime(s.startTime)}–{formatTime(s.endTime)}
                        {now && <span className="ml-2 font-medium text-gold-strong">Now</span>}
                        {s.kind === "extra" && " · Extra class"}
                        {s.kind === "rescheduled" && " · Moved here"}
                        {" · "}
                        {s.batchName}
                        {teachers(s).length > 0 && `, with ${teachers(s).join(" and ")}`}
                      </div>
                      {s.section && (
                        <div className="text-[13px]">
                          {s.section}
                          {s.topic && <span className="text-muted">: {s.topic}</span>}
                        </div>
                      )}
                      {s.clashesWith && (
                        <div className="mt-0.5 text-[13px] font-medium text-gold-strong">
                          Clashes with {[...new Set(s.clashesWith.map((c) => c.courseTitle))].join(" and ")}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
