import Link from "next/link";
import { Notice, buttonClass } from "@/components/ui";
import { WeekView } from "@/components/week-view";
import { spaceContext } from "@/server/context";
import { joinPath } from "@/server/lib/links";
import { addDays, formatDate, formatTime, weekStart } from "@/server/lib/dates";
import { studentTimetable } from "@/server/services/timetable";
import { sendParentsHome } from "../view";

export const metadata = { title: "Timetable" };

export default async function Timetable({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ week?: string; enrolled?: string }> }) {
  const { uni } = await params;
  const { week, enrolled } = await searchParams;
  const { actor } = await spaceContext(uni);
  sendParentsHome(actor, uni);
  const from = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(week) : undefined;
  const t = await studentTimetable(actor, from ? { from, to: addDays(from, 6) } : undefined);
  const base = `/${uni}/learn/timetable`;
  // Every class gets Join (a per-class link counts too); the join route explains a missing link or a closed window.
  const upcoming = t.sessions.filter((s) => s.date >= t.today).slice(0, 3);

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
            Previous
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={base}>
            This week
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={`${base}?week=${addDays(t.from, 7)}`}>
            Next
          </Link>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted">
        Week of {new Date(`${t.from}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
      </p>
      <WeekView from={t.from} today={t.today} sessions={t.sessions} />
      {upcoming.length > 0 && (
        <div className="mt-6 space-y-2">
          {upcoming.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
              <span className="min-w-0">
                <b>{s.courseTitle}</b> · {s.date === t.today ? "Today" : formatDate(s.date, { weekday: true })}, {formatTime(s.startTime)}
                {(s.section || s.sectionFaculty?.length || s.faculty.length > 0) && (
                  <span className="block truncate text-[13px] text-muted">
                    {[s.section, (s.sectionFaculty?.length ? s.sectionFaculty : s.faculty).join(" and ") && `with ${(s.sectionFaculty?.length ? s.sectionFaculty : s.faculty).join(" and ")}`, s.topic].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              {/* A plain link, never prefetched: the join route records attendance, then redirects to the meeting. */}
              <a href={joinPath(uni, s.batchId, s.date, s.startTime)} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
                Join
              </a>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
