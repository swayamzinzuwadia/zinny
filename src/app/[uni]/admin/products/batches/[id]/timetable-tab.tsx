import Link from "next/link";
import { Badge, Card, Empty, Select, buttonClass, cx } from "@/components/ui";
import { formatDate, formatTime } from "@/server/lib/dates";
import type { getBatchPlan } from "@/server/services/batch-plan";
import { toneOf } from "./plan-tab";
import { PrintButton } from "./print-button";
import { KIND_LABEL, timetableRows, weekdayName } from "./timetable-rows";

type Plan = Awaited<ReturnType<typeof getBatchPlan>>;

/** When printing, only the timetable goes on paper: no sidebar, tabs, filters or buttons. */
const PRINT_CSS = `
@media print {
  @page { margin: 14mm; }
  body * { visibility: hidden !important; }
  #batch-timetable, #batch-timetable * { visibility: visible !important; }
  #batch-timetable { position: absolute; left: 0; top: 0; width: 100%; }
  #batch-timetable .timetable-scroll { overflow: visible !important; border: 0 !important; border-radius: 0 !important; }
  #batch-timetable table { min-width: 0 !important; font-size: 11px; }
  #batch-timetable th, #batch-timetable td { padding: 5px 8px !important; }
  #batch-timetable tr { break-inside: avoid; background: transparent !important; opacity: 1 !important; }
  #batch-timetable .print-only { display: block !important; }
}`;

export function TimetableTab({
  uni,
  plan,
  heading,
  filter,
  viewerUserId,
  canEdit,
}: {
  uni: string;
  plan: Plan;
  /** Printed above the table: course, batch, dates, incharge. */
  heading: { title: string; detail: string };
  filter: { section?: string; faculty?: string };
  viewerUserId: string;
  canEdit: boolean;
}) {
  const { timetable, sections, today, nextClassDate } = plan;
  const base = `/${uni}/admin/products/batches/${plan.batchId}`;
  const sectionId = sections.some((s) => s.id === filter.section) ? filter.section : undefined;
  const faculty = [...new Map(sections.filter((s) => s.facultyUserId).map((s) => [s.facultyUserId!, s.facultyName ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const facultyUserId = faculty.some(([id]) => id === filter.faculty) ? filter.faculty : undefined;
  const rows = timetableRows(timetable, { sectionId, facultyUserId });
  const filtering = !!sectionId || !!facultyUserId;
  const index = new Map(sections.map((s, i) => [s.id, i]));
  const query = new URLSearchParams({ ...(sectionId && { section: sectionId }), ...(facultyUserId && { faculty: facultyUserId }) }).toString();
  const planned = timetable.days.filter((d) => d.planned).length;
  const teachesHere = sections.some((s) => s.facultyUserId === viewerUserId);
  // Gold marks one thing only: today's class, or else the next one.
  const goldDate = timetable.days.some((d) => d.date === today) ? today : nextClassDate;

  return (
    <div className="space-y-6">
      <style>{PRINT_CSS}</style>

      {timetable.problems.length > 0 && (
        <Card className="border-gold/60 bg-warn-soft/50">
          <h2 className="mb-3 text-[17px] font-medium">
            {timetable.problems.length === 1 ? "1 thing needs attention" : `${timetable.problems.length} things need attention`}
          </h2>
          <ul className="space-y-3">
            {timetable.problems.map((p, i) => (
              <li key={i} className="flex gap-3 text-[14px]">
                <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
                <div>
                  <div className="font-medium text-ink">{p.message}</div>
                  <div className="text-muted">{p.fix}</div>
                </div>
              </li>
            ))}
          </ul>
          {canEdit && (
            <Link href={`${base}?tab=plan`} className="mt-4 inline-block text-[14px] font-medium text-brand hover:underline">
              Open Sections and plan
            </Link>
          )}
        </Card>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <form method="get" action={base} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="timetable" />
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">Section</span>
            <Select name="section" defaultValue={sectionId ?? ""} className="w-52">
              <option value="">All sections</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">Faculty</span>
            <Select name="faculty" defaultValue={facultyUserId ?? ""} className="w-52">
              <option value="">All faculty</option>
              {faculty.map(([id, name]) => (
                <option key={id} value={id}>
                  {id === viewerUserId ? `${name} (you)` : name}
                </option>
              ))}
            </Select>
          </label>
          <button type="submit" className={buttonClass("secondary")}>
            Show classes
          </button>
          {filtering && (
            <Link href={`${base}?tab=timetable`} className="pb-2.5 text-[14px] text-brand hover:underline">
              Clear filters
            </Link>
          )}
          {teachesHere && facultyUserId !== viewerUserId && (
            <Link href={`${base}?tab=timetable&faculty=${viewerUserId}`} className="pb-2.5 text-[14px] text-brand hover:underline">
              Only my classes
            </Link>
          )}
        </form>
        <div className="flex gap-2">
          <PrintButton>Print timetable</PrintButton>
          {/* A plain link, not prefetched: it answers with a file. */}
          <a href={`${base}/timetable.csv${query ? `?${query}` : ""}`} className={buttonClass("secondary", "sm")}>
            Download CSV
          </a>
        </div>
      </div>

      <div id="batch-timetable">
        <div className="print-only mb-4 hidden">
          <div className="text-[18px] font-semibold">{heading.title}</div>
          <div className="text-[12px]">{heading.detail}</div>
        </div>
        <p className="mb-3 text-[13px] text-muted">
          {timetable.classDays} class {timetable.classDays === 1 ? "day" : "days"}
          {timetable.classDays > 0 && `, ${formatDate(timetable.days[0].date)} to ${formatDate(timetable.days[timetable.days.length - 1].date)}`}
          {sections.length > 0 && ` · ${planned} planned`}
          {filtering && ` · showing ${rows.length} ${rows.length === 1 ? "class" : "classes"}`}
        </p>
        {rows.length === 0 ? (
          <Empty title={filtering ? "No classes match these filters" : "No class days yet"}>
            {filtering ? "Clear the filters to see the whole batch." : "Set the batch's dates and weekly timings under Batch details, and the timetable fills in."}
          </Empty>
        ) : (
          <div className="timetable-scroll relative overflow-x-auto rounded-[22px] border border-line bg-surface">
            <table className="w-full min-w-[860px] text-left text-[14px]">
              <thead className="border-b border-line text-[13px] text-muted">
                <tr>
                  {["Day", "Date", "Weekday", "Time", "Section", "Faculty", "Topic", ""].map((h, i) => (
                    <th key={i} className="px-4 py-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => {
                  if (r.type === "off") {
                    return (
                      <tr key={i} className="text-muted">
                        <td className="px-4 py-2.5">—</td>
                        <td className="tabular px-4 py-2.5 whitespace-nowrap line-through">{formatDate(r.date)}</td>
                        <td className="px-4 py-2.5">{weekdayName(r.weekday)}</td>
                        <td className="px-4 py-2.5" colSpan={4}>
                          {r.kind === "moved" && r.movedTo ? `No class: moved to ${formatDate(r.movedTo, { weekday: true })}` : "No class"}
                          {r.note && ` · ${r.note}`}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Badge>{r.kind === "moved" ? "Moved" : "Cancelled"}</Badge>
                        </td>
                      </tr>
                    );
                  }
                  const gold = r.date === goldDate;
                  const past = r.date < today;
                  const mine = r.sections.some((s) => s.facultyUserId === viewerUserId);
                  return (
                    <tr key={i} className={cx(gold && "bg-gold-soft/60", past && "opacity-60")}>
                      <td className="tabular px-4 py-3 align-top font-medium whitespace-nowrap">{r.first ? `Day ${r.dayNumber}` : ""}</td>
                      <td className="tabular px-4 py-3 align-top whitespace-nowrap">{r.first ? formatDate(r.date) : ""}</td>
                      <td className="px-4 py-3 align-top">{r.first ? weekdayName(r.weekday) : ""}</td>
                      <td className="tabular px-4 py-3 align-top whitespace-nowrap">
                        {formatTime(r.startTime)}–{formatTime(r.endTime)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {r.sections.length === 0 ? (
                          <span className="font-medium text-warn">Nothing planned</span>
                        ) : (
                          <div className="space-y-1">
                            {r.sections.map((s) => (
                              <div key={s.id} className="flex items-center gap-2 font-medium">
                                <span className={cx("h-2.5 w-2.5 shrink-0 rounded-full", toneOf(index.get(s.id) ?? 0).dot)} aria-hidden />
                                {s.title}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-1">
                          {r.sections.map((s) => (
                            <div key={s.id} className={s.facultyName ? "" : "text-warn"}>
                              {s.facultyName ?? "No faculty"}
                              {s.facultyUserId === viewerUserId && <span className="text-muted"> (you)</span>}
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-muted">
                        <div className="space-y-1">
                          {r.sections.map((s) => (
                            <div key={s.id}>{s.topic ?? (r.sections.length > 1 ? "—" : "")}</div>
                          ))}
                        </div>
                        {r.note && <div className="text-[13px]">{r.note}</div>}
                      </td>
                      <td className="px-4 py-3 text-right align-top">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {gold && r.first && <Badge tone="gold">{r.date === today ? "Today" : "Next class"}</Badge>}
                          {r.kind !== "regular" && <Badge>{KIND_LABEL[r.kind]}</Badge>}
                          {mine && <Badge tone="brand">You teach</Badge>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
