import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, cx } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { formatDate, formatTime, weekdayLabel } from "@/server/lib/dates";
import { myBatchTimetable } from "@/server/services/batch-plan";
import { sendParentsHome } from "../../../view";

export const metadata = { title: "Full timetable" };

const MONTH = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });
const monthOf = (date: string) => MONTH.format(new Date(`${date}T00:00:00Z`));

/**
 * The student's batch from first class to last: every class day with its date, time,
 * section, faculty and topic. Past days are muted and the next class is marked in gold.
 */
export default async function FullTimetable({ params }: { params: Promise<{ uni: string; enrolmentId: string }> }) {
  const { uni, enrolmentId } = await params;
  const { actor } = await spaceContext(uni);
  sendParentsHome(actor, uni);
  const t = await myBatchTimetable(actor, enrolmentId).catch((err) => {
    if (err instanceof NotFoundError) notFound();
    throw err;
  });
  const done = t.days.filter((d) => d.date < t.today).length;
  const next = t.days.find((d) => d.date === t.nextClassDate);

  // Class days and days without a class, in date order, under a heading per month.
  const items = [...t.days.map((d) => ({ date: d.date, day: d, off: null })), ...t.offDays.map((o) => ({ date: o.date, day: null, off: o }))].sort((a, b) => a.date.localeCompare(b.date));
  const months = [...new Set(items.map((i) => monthOf(i.date)))];

  return (
    <>
      <Link href={`/${uni}/learn/my/${enrolmentId}`} className="mb-2 inline-block py-1 text-sm text-brand hover:underline">
        Back to {t.courseTitle}
      </Link>
      <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Full timetable</h1>
      <p className="mt-1 text-[14px] text-muted">
        {t.courseTitle} · {t.batchName}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 rounded-[22px] border border-line bg-surface p-4 text-[14px] sm:grid-cols-4">
        <div>
          <dt className="text-muted">Class days</dt>
          <dd className="tabular font-medium">{t.days.length}</dd>
        </div>
        <div>
          <dt className="text-muted">Done</dt>
          <dd className="tabular font-medium">{done}</dd>
        </div>
        <div>
          <dt className="text-muted">Next class</dt>
          <dd className="font-medium">{next ? (next.date === t.today ? "Today" : formatDate(next.date, { weekday: true })) : "None left"}</dd>
        </div>
        <div>
          <dt className="text-muted">Batch incharge</dt>
          <dd className="font-medium">{t.incharge ?? "To be announced"}</dd>
        </div>
      </dl>

      {next && (
        <a href="#next-class" className="mt-3 inline-block py-1 text-[14px] text-brand hover:underline">
          Go to the next class
        </a>
      )}

      {t.days.length === 0 ? (
        <div className="mt-6">
          <Empty title="No classes scheduled yet">Your class dates will show here as soon as the batch has them.</Empty>
        </div>
      ) : (
        months.map((month) => (
          <section key={month} className="mt-6">
            <h2 className="mb-2 text-[15px] font-medium text-muted">{month}</h2>
            <ol className="space-y-2">
              {items
                .filter((i) => monthOf(i.date) === month)
                .map((i) => {
                  if (i.off) {
                    return (
                      <li key={`off-${i.date}`} className="rounded-2xl border border-dashed border-line px-4 py-2.5 text-[13px] text-muted">
                        <span className="tabular">{formatDate(i.date, { weekday: true })}</span> · No class
                        {i.off.kind === "moved" && i.off.movedTo ? `, moved to ${formatDate(i.off.movedTo, { weekday: true })}` : ""}
                        {i.off.note ? ` (${i.off.note})` : ""}
                      </li>
                    );
                  }
                  const d = i.day!;
                  const isNext = d.date === t.nextClassDate;
                  const past = d.date < t.today;
                  return (
                    <li
                      key={d.date}
                      id={isNext ? "next-class" : undefined}
                      className={cx(
                        "flex scroll-mt-24 gap-3 rounded-2xl border bg-surface px-3.5 py-3 sm:gap-4 sm:px-4",
                        isNext ? "border-gold ring-2 ring-gold-soft" : "border-line",
                        past && "opacity-55",
                      )}
                    >
                      <div className="w-[62px] shrink-0 text-center">
                        <div className={cx("text-[12px]", isNext ? "font-medium text-gold-strong" : "text-muted")}>{weekdayLabel(d.weekday)}</div>
                        <div className="tabular text-[22px] font-semibold leading-tight">{Number(d.date.slice(8))}</div>
                        <div className="tabular text-[12px] text-muted">Day {d.dayNumber}</div>
                      </div>
                      <div className="min-w-0 flex-1 space-y-2 border-l border-line pl-3 sm:pl-4">
                        {isNext && <div className="text-[12px] font-medium text-gold-strong">{d.date === t.today ? "Today" : "Next class"}</div>}
                        {d.entries.map((e, k) => {
                          const teachers = [...new Set(e.sections.map((s) => s.facultyName).filter(Boolean))];
                          const faculty = teachers.length > 0 ? teachers : e.sections.length === 0 ? t.batchFaculty : [];
                          const topics = e.sections.map((s) => s.topic).filter(Boolean);
                          return (
                            <div key={k}>
                              <div className="tabular text-[13px] text-muted">
                                {formatTime(e.startTime)}–{formatTime(e.endTime)}
                                {e.kind === "extra" && " · Extra class"}
                                {e.kind === "rescheduled" && " · Moved here"}
                              </div>
                              <div className="font-medium">{e.sections.length > 0 ? e.sections.map((s) => s.title).join(" and ") : t.courseTitle}</div>
                              <div className="text-[13px] text-muted">{faculty.length > 0 ? `with ${faculty.join(" and ")}` : "Faculty to be announced"}</div>
                              {topics.length > 0 && <div className="mt-0.5 text-[13px]">{topics.join(" · ")}</div>}
                              {e.note && <div className="text-[13px] text-muted">{e.note}</div>}
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
            </ol>
          </section>
        ))
      )}
    </>
  );
}
