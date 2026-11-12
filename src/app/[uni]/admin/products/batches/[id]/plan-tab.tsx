import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Field, Input, Select, Textarea, cx, inputClass } from "@/components/ui";
import { formatDate, formatTime } from "@/server/lib/dates";
import type { getBatchPlan, plansToCopy } from "@/server/services/batch-plan";
import { copyPlanAction, createSectionAction, deleteSectionAction, moveSectionAction, saveSectionAction } from "./plan-actions";

type Plan = Awaited<ReturnType<typeof getBatchPlan>>;
type CopyChoice = Awaited<ReturnType<typeof plansToCopy>>[number];
export type FacultyChoices = { onBatch: { userId: string; name: string }[]; department: { id: string; name: string }[] };

/**
 * One quiet colour per section, in order. No gold: gold only marks today and the next class.
 */
export const SECTION_TONES = [
  { dot: "bg-brand", chip: "bg-brand-soft text-brand-strong" },
  { dot: "bg-[#2f4a72]", chip: "bg-[#e6ebf3] text-[#2f4a72]" },
  { dot: "bg-[#7a3d66]", chip: "bg-[#f1e6ee] text-[#7a3d66]" },
  { dot: "bg-[#7a4a2d]", chip: "bg-[#f4e9e1] text-[#7a4a2d]" },
  { dot: "bg-[#2d5a6a]", chip: "bg-[#e3eef1] text-[#2d5a6a]" },
];
export const toneOf = (index: number) => SECTION_TONES[index % SECTION_TONES.length];

function FacultySelect({ choices, value }: { choices: FacultyChoices; value: string | null }) {
  const others = choices.department.filter((d) => !choices.onBatch.some((f) => f.userId === d.id));
  return (
    <Select name="facultyUserId" defaultValue={value ?? ""}>
      <option value="">No faculty yet</option>
      <optgroup label="On this batch">
        {choices.onBatch.map((f) => (
          <option key={f.userId} value={f.userId}>
            {f.name}
          </option>
        ))}
      </optgroup>
      {others.length > 0 && (
        <optgroup label="Department staff (joins this batch when picked)">
          {others.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

/** Day 1…N with the sections on each: gaps, shared days and days past the end date stand out. */
function DayGrid({ plan }: { plan: Plan }) {
  const { timetable, sections, today, nextClassDate } = plan;
  const total = Math.max(timetable.classDays, timetable.lastPlannedDay);
  if (total === 0) return null;
  const index = new Map(sections.map((s, i) => [s.id, i]));
  const cells = Array.from({ length: total }, (_, i) => {
    const n = i + 1;
    const day = timetable.days[i];
    const mine = sections.filter((s) => s.days.some((d) => d.dayNumber === n));
    return { n, day, mine };
  });
  const gaps = cells.filter((c) => c.day && c.mine.length === 0).length;
  const shared = cells.filter((c) => c.mine.length > 1).length;
  const beyond = cells.filter((c) => !c.day).length;

  return (
    <Card>
      <CardTitle
        hint={[`${timetable.classDays} class ${timetable.classDays === 1 ? "day" : "days"}`, gaps ? `${gaps} not planned` : "", shared ? `${shared} shared` : "", beyond ? `${beyond} past the end date` : ""]
          .filter(Boolean)
          .join(" · ")}
      >
        Day by day
      </CardTitle>
      <ol className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2">
        {cells.map(({ n, day, mine }) => {
          const isNext = !!day && (day.date === today || day.date === nextClassDate);
          const gap = !!day && mine.length === 0;
          return (
            <li
              key={n}
              className={cx(
                "min-h-[86px] rounded-[14px] border p-2.5 text-[12px] leading-snug",
                !day ? "border-danger/30 bg-danger-soft/60" : gap ? "border-dashed border-warn/50 bg-surface" : "border-line bg-surface",
                isNext && "ring-2 ring-gold",
              )}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="tabular font-semibold text-ink">Day {n}</span>
                {isNext && <span className="font-medium text-gold-strong">{day.date === today ? "Today" : "Next"}</span>}
              </div>
              <div className={cx("mb-1.5", day ? "text-muted" : "text-danger")}>{day ? formatDate(day.date, { weekday: true }) : "No class date"}</div>
              {gap && <div className="font-medium text-warn">Nothing planned</div>}
              <div className="space-y-1">
                {mine.map((s) => (
                  <div key={s.id} className={cx("truncate rounded-md px-1.5 py-0.5 font-medium", toneOf(index.get(s.id)!).chip)} title={s.title}>
                    {s.title}
                  </div>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-muted">
        {sections.map((s, i) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span className={cx("h-2.5 w-2.5 rounded-full", toneOf(i).dot)} />
            {s.title}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-warn/60" />
          Class day with nothing planned
        </span>
        {beyond > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-danger-soft ring-1 ring-danger/30" />
            Planned, but the dates run out
          </span>
        )}
      </div>
    </Card>
  );
}

function SectionCard({ uni, plan, section, index, canEdit, choices }: { uni: string; plan: Plan; section: Plan["sections"][number]; index: number; canEdit: boolean; choices: FacultyChoices }) {
  const { timetable } = plan;
  const dated = section.days.filter((d) => d.dayNumber <= timetable.classDays).map((d) => timetable.days[d.dayNumber - 1].date);
  const undated = section.days.length - dated.length;
  const span =
    section.days.length === 0
      ? "No days yet"
      : dated.length === 0
        ? "No class dates yet"
        : dated.length === 1
          ? formatDate(dated[0], { weekday: true })
          : `${formatDate(dated[0], { weekday: true })} to ${formatDate(dated[dated.length - 1], { weekday: true })}`;
  const hidden = (
    <>
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="batchId" value={plan.batchId} />
      <input type="hidden" name="sectionId" value={section.id} />
    </>
  );

  return (
    <Card data-section={section.title}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[17px] font-medium">
            <span className={cx("h-3 w-3 shrink-0 rounded-full", toneOf(index).dot)} />
            <span className="truncate">{section.title}</span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span>{section.facultyName ? `With ${section.facultyName}` : "No faculty yet"}</span>
            <span aria-hidden>·</span>
            <span>
              {section.days.length} {section.days.length === 1 ? "day" : "days"}
            </span>
            <span aria-hidden>·</span>
            <span>{span}</span>
            {!section.facultyUserId && <Badge tone="warn">Needs faculty</Badge>}
            {undated > 0 && timetable.classDays > 0 && (
              <Badge tone="danger">
                {undated} {undated === 1 ? "day" : "days"} past the end date
              </Badge>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-start gap-1.5">
            {(["up", "down"] as const).map((direction) => (
              <ActionForm key={direction} action={moveSectionAction}>
                {hidden}
                <input type="hidden" name="direction" value={direction} />
                <button
                  type="submit"
                  disabled={direction === "up" ? index === 0 : index === plan.sections.length - 1}
                  className="inline-flex h-8 items-center rounded-full border border-line bg-surface px-3 text-[13px] text-ink hover:border-brand/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Move {direction}
                </button>
              </ActionForm>
            ))}
            <ActionForm action={deleteSectionAction} confirm={`Remove ${section.title} and its ${section.days.length} planned ${section.days.length === 1 ? "day" : "days"}?`}>
              {hidden}
              <SubmitButton size="sm" variant="danger" pendingText="Removing…">
                Remove section
              </SubmitButton>
            </ActionForm>
          </div>
        )}
      </div>

      {!canEdit ? (
        <dl className="grid gap-3 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="text-muted">Days</dt>
            <dd className="tabular font-medium">{section.daysText || "None yet"}</dd>
          </div>
          {section.description && (
            <div>
              <dt className="text-muted">About</dt>
              <dd>{section.description}</dd>
            </div>
          )}
        </dl>
      ) : (
        <ActionForm action={saveSectionAction} resetOnSuccess={false} className="space-y-4">
          {hidden}
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Section name">
              <Input name="title" defaultValue={section.title} required maxLength={80} />
            </Field>
            <Field label="Faculty">
              <FacultySelect choices={choices} value={section.facultyUserId} />
            </Field>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Days" hint="Day numbers, like 1-5, 8, 10-12. Day 1 is the batch's first class.">
              <Input name="days" defaultValue={section.daysText} placeholder="1-5, 8, 10-12" autoComplete="off" className="tabular" />
            </Field>
            <Field label="About this section" hint="Optional. Students see the section name, not this note.">
              <Input name="description" defaultValue={section.description} maxLength={500} />
            </Field>
          </div>
          {section.days.length > 0 && (
            <details className="rounded-2xl border border-line bg-canvas/60 px-4 py-3">
              <summary className="cursor-pointer text-[14px] font-medium">
                Topics and times for each day
                <span className="ml-2 font-normal text-muted">
                  {section.days.filter((d) => d.topic).length} of {section.days.length} have a topic
                </span>
              </summary>
              <p className="mt-2 text-[12px] text-muted">A time is only needed when sections share a day and each has its own slot. Leave it empty to use the class time.</p>
              <div className="mt-3 space-y-2">
                {section.days.map((d) => {
                  const day = timetable.days[d.dayNumber - 1];
                  return (
                    <div key={d.dayNumber} className="grid items-center gap-2 md:grid-cols-[150px_1fr_112px_112px]">
                      <div className="text-[13px]">
                        <span className="tabular font-medium">Day {d.dayNumber}</span>{" "}
                        <span className={day ? "text-muted" : "text-danger"}>{day ? formatDate(day.date, { weekday: true }) : "no class date"}</span>
                      </div>
                      <input name={`topic-${d.dayNumber}`} defaultValue={d.topic ?? ""} placeholder="Topic" maxLength={200} aria-label={`Topic for day ${d.dayNumber}`} className={cx(inputClass, "h-9")} />
                      <input type="time" name={`start-${d.dayNumber}`} defaultValue={d.startTime?.slice(0, 5) ?? ""} aria-label={`Start time on day ${d.dayNumber}`} className={cx(inputClass, "tabular h-9")} />
                      <input type="time" name={`end-${d.dayNumber}`} defaultValue={d.endTime?.slice(0, 5) ?? ""} aria-label={`End time on day ${d.dayNumber}`} className={cx(inputClass, "tabular h-9")} />
                    </div>
                  );
                })}
              </div>
            </details>
          )}
          <SubmitButton>Save section</SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}

export function PlanTab({ uni, plan, canEdit, choices, copyChoices }: { uni: string; plan: Plan; canEdit: boolean; choices: FacultyChoices; copyChoices: CopyChoice[] }) {
  const { sections, timetable } = plan;
  const first = timetable.days[0];
  const lastDay = timetable.days[timetable.days.length - 1];
  return (
    <div className="grid gap-6 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        {sections.length === 0 ? (
          <Empty title="No sections yet">
            A section is a part of the syllabus with its own faculty, like Direct tax, GST or Revision.
            {canEdit ? " Add the first one, then give it its days." : ""}
          </Empty>
        ) : (
          <>
            <DayGrid plan={plan} />
            {sections.map((s, i) => (
              <SectionCard key={s.id} uni={uni} plan={plan} section={s} index={i} canEdit={canEdit} choices={choices} />
            ))}
          </>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardTitle>How the plan works</CardTitle>
          <ul className="space-y-2 text-[14px] text-muted">
            <li>
              Plan by day number, not by date. Day 1 is the first class
              {first ? ` (${formatDate(first.date, { weekday: true })})` : ""}, Day 2 the next one, and so on.
            </li>
            <li>The dates follow by themselves. Cancel a class, add an extra one or change the batch&apos;s dates, and every later day moves.</li>
            <li>
              {timetable.classDays > 0
                ? `These dates have ${timetable.classDays} class ${timetable.classDays === 1 ? "day" : "days"}, ending ${formatDate(lastDay.date, { weekday: true })} at ${formatTime(lastDay.entries[lastDay.entries.length - 1].endTime)}.`
                : "These dates and timings give no class days yet."}
            </li>
          </ul>
        </Card>

        {canEdit && (
          <Card>
            <CardTitle>Add a section</CardTitle>
            <ActionForm action={createSectionAction} className="space-y-4">
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="batchId" value={plan.batchId} />
              <Field label="Section name">
                <Input name="title" placeholder="Direct tax" required maxLength={80} />
              </Field>
              <Field label="Faculty">
                <FacultySelect choices={choices} value={null} />
              </Field>
              <Field label="Days" hint="Like 1-5, 8, 10-12. You can add them later.">
                <Input name="days" placeholder="1-5, 8, 10-12" autoComplete="off" className="tabular" />
              </Field>
              <Field label="About this section" hint="Optional.">
                <Textarea name="description" maxLength={500} className="min-h-16" />
              </Field>
              <SubmitButton>Add section</SubmitButton>
            </ActionForm>
          </Card>
        )}

        {canEdit && copyChoices.length > 0 && (
          <Card>
            <CardTitle>Copy the plan from another batch</CardTitle>
            <p className="mb-3 text-[14px] text-muted">
              Brings over the sections, their faculty and day numbers from another batch of this course.
              {sections.length > 0 ? " It replaces the plan this batch has now." : ""}
            </p>
            <ActionForm action={copyPlanAction} className="space-y-3" confirm={sections.length > 0 ? "This replaces this batch's sections and days. Copy the plan?" : undefined}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="batchId" value={plan.batchId} />
              <Select name="fromBatchId" defaultValue="">
                <option value="">Pick a batch…</option>
                {copyChoices.map((c) => (
                  <option key={c.batchId} value={c.batchId}>
                    {c.name} · {c.sections} {c.sections === 1 ? "section" : "sections"}, {c.days} {c.days === 1 ? "day" : "days"}
                  </option>
                ))}
              </Select>
              <SubmitButton variant="secondary" pendingText="Copying…">
                Copy plan
              </SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
    </div>
  );
}
