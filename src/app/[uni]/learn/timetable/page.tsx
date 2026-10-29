import Link from "next/link";
import { Notice, buttonClass } from "@/components/ui";
import { WeekView } from "@/components/week-view";
import { spaceContext } from "@/server/context";
import { joinPath } from "@/server/lib/links";
import { addDays, formatDate, formatTime, weekStart } from "@/server/lib/dates";
import { studentTimetable } from "@/server/services/timetable";

export const metadata = { title: "Timetable" };

export default async function Timetable({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ week?: string; enrolled?: string }> }) {
  const { uni } = await params;
  const { week, enrolled } = await searchParams;
  const { actor } = await spaceContext(uni);
  const from = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(week) : undefined;
  const t = await studentTimetable(actor, from ? { from, to: addDays(from, 6) } : undefined);
  const base = `/${uni}/learn/timetable`;
  const upcoming = t.sessions.filter((s) => s.date >= t.today && s.joinUrl).slice(0, 3);

  return (
    <>
      {enrolled && (
        <div className="mb-5">
          <Notice>You&apos;re enrolled. Your classes are on the timetable below.</Notice>
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight">Timetable</h1>
        <div className="flex items-center gap-2 text-sm">
          <Link className={buttonClass("secondary", "sm")} href={`${base}?week=${addDays(t.from, -7)}`}>
            ← Previous
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={base}>
            This week
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={`${base}?week=${addDays(t.from, 7)}`}>
            Next →
          </Link>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted">
        Week of {new Date(`${t.from}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}. Built from the batches you picked, and updated when anything changes.
      </p>
      <WeekView from={t.from} today={t.today} sessions={t.sessions} />
      {upcoming.length > 0 && (
        <div className="mt-6 space-y-2">
          {upcoming.map((s, i) => (
            <div key={i} className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
              <span>
                <b>{s.courseTitle}</b> · {s.date === t.today ? "Today" : formatDate(s.date, { weekday: true })}, {formatTime(s.startTime)}
              </span>
              {/* A plain link, never prefetched: the join route records attendance, then redirects to the meeting. */}
              <a href={joinPath(uni, s.batchId, s.date)} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
                Join
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
