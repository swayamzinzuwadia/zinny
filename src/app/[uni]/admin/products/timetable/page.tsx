import Link from "next/link";
import { MonthView, monthRange, monthTitle, shiftMonth } from "@/components/month-view";
import { Card, Empty, PageHeader, buttonClass, cx } from "@/components/ui";
import { WeekView } from "@/components/week-view";
import { spaceContext } from "@/server/context";
import { addDays, formatDate, formatTime, weekStart } from "@/server/lib/dates";
import { facultyTimetable } from "@/server/services/timetable";

export const metadata = { title: "My timetable" };

/**
 * A faculty member's own classes: every batch they teach, week by week or a month at a time,
 * with the section of each class. Their own sections say "you teach"; classes of their batches
 * that another faculty member's section covers are still shown, so they see the whole batch.
 */
export default async function MyTimetable({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<{ week?: string; month?: string; mine?: string }> }) {
  const { uni } = await params;
  const { week, month, mine } = await searchParams;
  const { actor } = await spaceContext(uni);
  const base = `/${uni}/admin/products/timetable`;
  const monthMode = !!month && /^\d{4}-\d{2}$/.test(month);
  const grid = monthMode ? monthRange(month) : null;
  const from = !monthMode && week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(week) : undefined;
  const t = await facultyTimetable(actor, grid ? { from: grid.gridFrom, to: grid.gridTo } : from ? { from, to: addDays(from, 6) } : undefined);
  const onlyMine = mine === "1";
  // A class with no plan has no section: it counts as theirs, since they teach the batch.
  const sessions = onlyMine ? t.sessions.filter((s) => s.taughtByMe || !s.section) : t.sessions;
  const keep = (q: string) => `${base}?${q}${onlyMine ? "&mine=1" : ""}`;
  const thisMonth = t.today.slice(0, 7);
  const upcoming = sessions.filter((s) => s.date >= t.today && (!grid || s.date.slice(0, 7) === month)).slice(0, 5);
  const batches = new Map(t.sessions.map((s) => [s.batchId, `${s.courseTitle}: ${s.batchName}`]));

  return (
    <>
      <PageHeader
        title="My timetable"
        subtitle={batches.size > 0 ? `The classes of the ${batches.size === 1 ? "batch" : `${batches.size} batches`} you teach` : "The classes of the batches you teach"}
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {monthMode ? monthTitle(month) : `Week of ${formatDate(t.from)}`} · {sessions.length} {sessions.length === 1 ? "class" : "classes"}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link className={buttonClass("secondary", "sm")} href={monthMode ? keep(`month=${shiftMonth(month, -1)}`) : keep(`week=${addDays(t.from, -7)}`)}>
            Previous
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={monthMode ? keep(`month=${thisMonth}`) : keep(`week=${weekStart(t.today)}`)}>
            {monthMode ? "This month" : "This week"}
          </Link>
          <Link className={buttonClass("secondary", "sm")} href={monthMode ? keep(`month=${shiftMonth(month, 1)}`) : keep(`week=${addDays(t.from, 7)}`)}>
            Next
          </Link>
          <Link className={buttonClass("ghost", "sm")} href={monthMode ? keep(`week=${month === thisMonth ? weekStart(t.today) : `${month}-01`}`) : keep(`month=${t.from.slice(0, 7)}`)}>
            {monthMode ? "Show week" : "Show month"}
          </Link>
          <Link
            className={cx(buttonClass("ghost", "sm"), onlyMine && "bg-brand-soft")}
            href={`${base}?${monthMode ? `month=${month}` : `week=${t.from}`}${onlyMine ? "" : "&mine=1"}`}
          >
            {onlyMine ? "Show every class of my batches" : "Only the classes I teach"}
          </Link>
        </div>
      </div>

      {t.sessions.length === 0 && !grid && !from ? (
        <Empty title="No classes this week">When you teach a batch, its classes show up here.</Empty>
      ) : (
        <Card>
          {grid ? (
            <MonthView month={month!} today={t.today} sessions={sessions} weekHref={(w) => keep(`week=${w}`)} />
          ) : (
            <WeekView from={t.from} today={t.today} sessions={sessions} />
          )}
        </Card>
      )}

      {upcoming.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-[17px] font-semibold">Coming up</h2>
          <ul className="space-y-2">
            {upcoming.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
                <span className="min-w-0">
                  <b>{s.courseTitle}</b> · {s.batchName} · {s.date === t.today ? "Today" : formatDate(s.date, { weekday: true })}, {formatTime(s.startTime)}–{formatTime(s.endTime)}
                  {(s.section || s.dayNumber) && (
                    <span className="block text-[13px] text-muted">
                      {[s.dayNumber && `Day ${s.dayNumber}`, s.section, s.topic, s.section && !s.taughtByMe && s.sectionFaculty?.length ? `taught by ${s.sectionFaculty.join(" and ")}` : null].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <Link href={`/${uni}/admin/products/batches/${s.batchId}?tab=timetable`} className="text-[13px] font-medium text-brand hover:underline">
                  Open the batch timetable
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
