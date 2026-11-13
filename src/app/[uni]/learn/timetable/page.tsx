import Link from "next/link";
import { MonthView, monthRange, monthTitle, shiftMonth } from "@/components/month-view";
import { Notice, buttonClass, cx } from "@/components/ui";
import { WeekView } from "@/components/week-view";
import { spaceContext } from "@/server/context";
import { joinPath } from "@/server/lib/links";
import { addDays, formatDate, formatTime, weekStart } from "@/server/lib/dates";
import type { Session } from "@/server/services/schedule";
import { studentTimetable } from "@/server/services/timetable";
import { sendParentsHome } from "../view";

export const metadata = { title: "Timetable" };

/** "Data Analytics and Machine Learning on Mon 16 Nov at 9 am": one line per pair of clashing classes. */
function clashLinesFor(sessions: Session[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sessions) {
    for (const c of s.clashesWith ?? []) {
      const key = [s.date, ...[s.batchId, c.batchId].sort()].join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${s.courseTitle} (${s.batchName}) and ${c.courseTitle} (${c.batchName}), ${formatDate(s.date, { weekday: true })} at ${formatTime(s.startTime < c.startTime ? c.startTime : s.startTime)}`);
    }
  }
  return out;
}

export default async function Timetable({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ week?: string; month?: string; enrolled?: string }> }) {
  const { uni } = await params;
  const { week, month, enrolled } = await searchParams;
  const { actor } = await spaceContext(uni);
  sendParentsHome(actor, uni);
  const base = `/${uni}/learn/timetable`;
  const monthMode = !!month && /^\d{4}-\d{2}$/.test(month);
  const grid = monthMode ? monthRange(month) : null;
  const from = !monthMode && week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(week) : undefined;
  const t = await studentTimetable(actor, grid ? { from: grid.gridFrom, to: grid.gridTo } : from ? { from, to: addDays(from, 6) } : undefined);
  const shown = grid ? t.sessions.filter((s) => s.date.slice(0, 7) === month) : t.sessions;
  const clashes = clashLinesFor(shown);
  // Every class gets Join (a per-class link counts too); the join route explains a missing link or a closed window.
  const upcoming = shown.filter((s) => s.date >= t.today).slice(0, 3);
  const thisMonth = t.today.slice(0, 7);

  return (
    <>
      {enrolled && (
        <div className="mb-5">
          <Notice>You&apos;re enrolled. Your classes are on the timetable below.</Notice>
        </div>
      )}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-tight">Timetable</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link className={buttonClass("secondary", "sm")} href={monthMode ? `${base}?month=${shiftMonth(month, -1)}` : `${base}?week=${addDays(t.from, -7)}`}>
            Previous
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={monthMode ? `${base}?month=${thisMonth}` : base}>
            {monthMode ? "This month" : "This week"}
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={monthMode ? `${base}?month=${shiftMonth(month, 1)}` : `${base}?week=${addDays(t.from, 7)}`}>
            Next
          </Link>
          <Link className={buttonClass("ghost", "sm")} href={monthMode ? `${base}?week=${month === thisMonth ? weekStart(t.today) : `${month}-01`}` : `${base}?month=${t.from.slice(0, 7)}`}>
            {monthMode ? "Show week" : "Show month"}
          </Link>
        </div>
      </div>
      <p className="mb-4 text-sm text-muted">
        {monthMode
          ? monthTitle(month)
          : `Week of ${new Date(`${t.from}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`}
      </p>

      {clashes.length > 0 && (
        <div className="mb-5 rounded-2xl border border-gold/60 bg-gold-soft px-4 py-3 text-[14px] text-brand-deep" role="status">
          <div className="font-semibold">
            {clashes.length === 1 ? "Two of your classes are at the same time" : `${clashes.length} times when two of your classes meet together`}
          </div>
          <ul className="mt-1 list-disc pl-5">
            {clashes.slice(0, 5).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          {clashes.length > 5 && <p className="mt-1">And {clashes.length - 5} more, marked in gold below.</p>}
          <p className="mt-1 text-[13px]">Ask to switch batch from the course page if you can&apos;t be at both.</p>
        </div>
      )}

      {grid ? <MonthView month={month!} today={t.today} sessions={t.sessions} weekHref={(w) => `${base}?week=${w}`} /> : <WeekView from={t.from} today={t.today} sessions={t.sessions} />}
      {upcoming.length > 0 && (
        <div className="mt-6 space-y-2">
          {upcoming.map((s, i) => (
            <div key={i} className={cx("flex items-center justify-between gap-3 rounded-2xl border bg-surface px-4 py-3 text-sm", s.clashesWith ? "border-gold" : "border-line")}>
              <span className="min-w-0">
                <b>{s.courseTitle}</b> · {s.date === t.today ? "Today" : formatDate(s.date, { weekday: true })}, {formatTime(s.startTime)}
                {(s.section || s.sectionFaculty?.length || s.faculty.length > 0) && (
                  <span className="block truncate text-[13px] text-muted">
                    {[s.section, (s.sectionFaculty?.length ? s.sectionFaculty : s.faculty).join(" and ") && `with ${(s.sectionFaculty?.length ? s.sectionFaculty : s.faculty).join(" and ")}`, s.topic].filter(Boolean).join(" · ")}
                  </span>
                )}
                {s.clashesWith && (
                  <span className="block text-[13px] font-medium text-gold-strong">Clashes with {[...new Set(s.clashesWith.map((c) => c.courseTitle))].join(" and ")}</span>
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
