"use client";

import Link from "next/link";
import { useState } from "react";
import { cx } from "@/components/ui";
import { addDays, formatDate, formatTime, isoWeekday, toMinutes, weekdayLabel } from "@/server/lib/dates";
import type { Session } from "@/server/services/schedule";

/**
 * The week strip on the learner home: one button per day. Tapping a day shows that day's
 * classes in the card below ("Today", "Tomorrow", or the date). `children` sits beside it.
 */
export function DayAgenda({
  days,
  today,
  nowMin,
  sessions,
  dotFor,
  timetableHref,
  children,
}: {
  days: string[];
  today: string;
  nowMin: number;
  sessions: Session[];
  dotFor: Record<string, string>;
  timetableHref: string;
  children?: React.ReactNode;
}) {
  const [picked, setPicked] = useState(today);
  const items = sessions.filter((s) => s.date === picked);
  const title = picked === today ? "Today" : picked === addDays(today, 1) ? "Tomorrow" : formatDate(picked, { weekday: true });
  const empty =
    picked === today
      ? "No classes today. Use the time to catch up on lessons."
      : picked < today
        ? "No classes that day."
        : "Nothing scheduled that day.";

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
          const isToday = d === today;
          const selected = d === picked;
          return (
            <button
              key={d}
              id={`day-${d}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="day-panel"
              aria-label={`${formatDate(d, { weekday: true })}${isToday ? ", today" : ""}, ${count.length} class${count.length === 1 ? "" : "es"}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setPicked(d)}
              className={cx(
                "rounded-[18px] border px-1 py-3 text-center [transition-property:background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.96]",
                selected
                  ? "border-brand bg-brand text-canvas shadow-[0_6px_16px_-6px_rgb(11_94_76/0.55)]"
                  : isToday
                    ? "border-gold bg-surface ring-2 ring-gold-soft hover:border-gold-strong"
                    : "border-line bg-surface/70 hover:border-faint hover:bg-surface",
              )}
            >
              <div
                className={cx(
                  "text-[12px]",
                  selected ? "text-canvas/75" : isToday ? "font-medium text-gold-strong" : "text-muted",
                )}
              >
                {weekdayLabel(isoWeekday(d))}
              </div>
              <div className="tabular text-[20px] font-semibold leading-tight">{Number(d.slice(8))}</div>
              <div className="mt-1.5 flex h-2 justify-center gap-1">
                {count.slice(0, 4).map((s, i) => (
                  <span key={i} className={cx("h-1.5 w-1.5 rounded-full", selected ? "bg-canvas" : dotFor[s.courseId] ?? "bg-brand")} />
                ))}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section id="day-panel" role="tabpanel" aria-label={title} className="rounded-[var(--radius-board)] border border-line bg-surface p-6">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-[17px] font-medium">{title}</h2>
            <div className="flex items-baseline gap-3 text-[13px]">
              {items.length > 0 && (
                <span className="text-muted">
                  {items.length} class{items.length === 1 ? "" : "es"}
                </span>
              )}
              {picked !== today && (
                <button type="button" onClick={() => setPicked(today)} className="text-brand hover:underline">
                  Back to today
                </button>
              )}
            </div>
          </div>
          {items.length === 0 ? (
            <p className="text-[14px] text-muted">{empty}</p>
          ) : (
            <ol className="relative space-y-4 border-l border-line pl-5">
              {items.map((s, i) => {
                const isToday = picked === today;
                const done = picked < today || (isToday && toMinutes(s.endTime) <= nowMin);
                const now = isToday && !done && toMinutes(s.startTime) <= nowMin;
                return (
                  <li key={i} className={cx("relative", done && "opacity-55")}>
                    <span
                      className={cx(
                        "absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface",
                        now ? "now-dot bg-gold" : dotFor[s.courseId] ?? "bg-brand",
                      )}
                    />
                    <div className="tabular text-[13px] text-muted">
                      {formatTime(s.startTime)}–{formatTime(s.endTime)}
                      {now && <span className="ml-2 font-medium text-gold-strong">Now</span>}
                      {s.kind === "extra" && <span className="ml-2">Extra class</span>}
                      {s.kind === "rescheduled" && <span className="ml-2">Moved here</span>}
                    </div>
                    <div className="font-medium">{s.courseTitle}</div>
                    <div className="text-[13px] text-muted">
                      {s.batchName}
                      {s.faculty.length > 0 && `, with ${s.faculty.join(" and ")}`}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <Link href={timetableHref} className="mt-5 inline-block text-[13px] text-brand hover:underline">
            See the full timetable
          </Link>
        </section>
        {children}
      </div>
    </>
  );
}
