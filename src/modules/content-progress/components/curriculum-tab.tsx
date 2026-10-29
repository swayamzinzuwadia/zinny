import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Input, Notice, Select, cx } from "@/components/ui";
import type { CourseTabProps } from "@/contracts/module";
import { can } from "@/server/core";
import { addLessonAction, addSectionAction } from "../actions";
import { describeDrip, formatMinutes, KIND_LABEL, LESSON_KINDS } from "../lib/kinds";
import { batchProgressPath, lessonEditorPath, progressOverviewPath } from "../paths";
import { canEditCurriculum, getCurriculum } from "../service";
import { courseProgressBatches } from "../staff";
import { Icon, ProgressBar } from "./bits";
import { DeleteButton, MoveButtons, RenameSection } from "./curriculum-controls";

/**
 * Admin course page → Curriculum tab (adminCourseTabs.curriculum).
 * Everyone who can see the course reads it; content.manage holders edit it
 * (admins, HODs of the department, faculty who teach one of its batches).
 */
export async function CurriculumTab({ uni, actor, course, target }: CourseTabProps) {
  const [curriculum, progress] = await Promise.all([
    getCurriculum(actor, course.id),
    can(actor, "content.view_progress", target) ? courseProgressBatches(actor, course.id) : Promise.resolve([]),
  ]);
  const canEdit = canEditCurriculum(actor, target);
  const lessons = curriculum.flatMap((s) => s.lessons);
  const ready = lessons.filter((l) => l.ready);
  const required = ready.filter((l) => l.required);
  const drafts = lessons.filter((l) => !l.ready);
  const minutes = ready.reduce((n, l) => n + l.durationMinutes, 0);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {lessons.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[14px] text-muted">
            <span>
              <span className="tabular font-medium text-ink">{ready.length}</span> lessons for students
            </span>
            <span>
              <span className="tabular font-medium text-ink">{required.length}</span> required
            </span>
            {minutes > 0 && <span>{formatMinutes(minutes)} in total</span>}
            {drafts.length > 0 && <Badge tone="gold">{drafts.length} without content</Badge>}
          </div>
        )}
        {drafts.length > 0 && canEdit && (
          <Notice tone="gold">
            Lessons without content are hidden from students and don&apos;t count toward progress. Open each one to add its video, PDF, text or link.
          </Notice>
        )}
        {curriculum.length === 0 && (
          <Empty title="No sections yet">
            {canEdit ? "Group lessons into sections, like Week 1 or Module 1. Add the first section on the right." : "The curriculum for this course hasn't been added yet."}
          </Empty>
        )}

        {curriculum.map((s, i) => (
          <Card key={s.id} className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
              <div className="min-w-0">
                <div className="text-[12px] text-muted">Section {i + 1}</div>
                {canEdit ? <RenameSection uni={uni} sectionId={s.id} title={s.title} /> : <h2 className="text-[17px] font-medium">{s.title}</h2>}
              </div>
              <div className="flex items-center gap-1">
                <span className="mr-2 text-[13px] text-muted">
                  {s.lessons.length} lesson{s.lessons.length === 1 ? "" : "s"}
                </span>
                {canEdit && (
                  <>
                    <MoveButtons kind="section" uni={uni} id={s.id} courseId={course.id} first={i === 0} last={i === curriculum.length - 1} label={s.title} />
                    <DeleteButton
                      kind="section"
                      uni={uni}
                      id={s.id}
                      courseId={course.id}
                      label={s.title}
                      confirm={
                        s.lessons.length
                          ? `Delete ${s.title} and its ${s.lessons.length} lesson${s.lessons.length === 1 ? "" : "s"}? Students lose their progress on them. This can't be undone.`
                          : `Delete ${s.title}?`
                      }
                    />
                  </>
                )}
              </div>
            </div>

            {s.lessons.length === 0 ? (
              <p className="px-5 py-4 text-[14px] text-muted sm:px-6">No lessons in this section yet.</p>
            ) : (
              <ol className="divide-y divide-line">
                {s.lessons.map((l, j) => {
                  const drip = describeDrip(l);
                  return (
                    <li key={l.id} className="flex items-center gap-3 px-5 py-3 sm:px-6">
                      <span className={cx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full", l.ready ? "bg-brand-soft text-brand-strong" : "bg-gold-soft text-gold-strong")}>
                        <Icon name={l.kind} size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <Link href={lessonEditorPath(uni, l.id)} className="block truncate font-medium hover:text-brand">
                          {l.title}
                        </Link>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-muted">
                          <span>{KIND_LABEL[l.kind]}</span>
                          {l.durationMinutes > 0 && <span>· {formatMinutes(l.durationMinutes)}</span>}
                          {!l.required && <span>· Optional</span>}
                          {drip && <span>· {drip}</span>}
                          {!l.ready && <span className="font-medium text-gold-strong">· Needs content</span>}
                        </div>
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 items-center gap-1">
                          <MoveButtons kind="lesson" uni={uni} id={l.id} courseId={course.id} first={j === 0} last={j === s.lessons.length - 1} label={l.title} />
                          <Link href={lessonEditorPath(uni, l.id)} className="hidden rounded-full px-3 py-1 text-[13px] text-brand hover:bg-brand-soft sm:inline-block">
                            Edit
                          </Link>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {canEdit && (
              <ActionForm action={addLessonAction} className="flex flex-wrap items-center gap-2 border-t border-line bg-canvas/50 px-5 py-3 sm:px-6">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="courseId" value={course.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <div className="min-w-0 flex-1 basis-56">
                  <Input name="title" placeholder="New lesson title" required minLength={2} maxLength={200} aria-label={`New lesson in ${s.title}`} />
                </div>
                <div className="w-32 shrink-0">
                  <Select name="kind" aria-label="Lesson type" defaultValue="video">
                    {LESSON_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-32 shrink-0">
                  <Select name="required" aria-label="Required or optional" defaultValue="required">
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                  </Select>
                </div>
                <SubmitButton size="sm" variant="secondary" pendingText="Adding…">
                  Add lesson
                </SubmitButton>
              </ActionForm>
            )}
          </Card>
        ))}
      </div>

      <div className="space-y-6">
        {canEdit && (
          <Card className="h-fit">
            <CardTitle>Add a section</CardTitle>
            <ActionForm action={addSectionAction} className="space-y-3">
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="courseId" value={course.id} />
              <Input name="title" placeholder="Module 1: Foundations" required minLength={2} maxLength={200} aria-label="Section title" />
              <SubmitButton variant="secondary">Add section</SubmitButton>
            </ActionForm>
            <p className="mt-4 text-[13px] leading-relaxed text-muted">
              Course progress counts required lessons only. Each lesson can open on a set day after the student&apos;s batch starts, or on a fixed date.
            </p>
          </Card>
        )}

        {progress.length > 0 && (
          <Card className="h-fit">
            <CardTitle hint="Required lessons">Progress by batch</CardTitle>
            <ul className="space-y-4">
              {progress.map((b) => (
                <li key={b.batchId}>
                  <Link href={batchProgressPath(uni, b.batchId)} className="group block">
                    <div className="flex items-baseline justify-between gap-2 text-[14px]">
                      <span className="font-medium group-hover:text-brand">{b.batchName}</span>
                      <span className="tabular text-muted">{b.averagePercent}% average</span>
                    </div>
                    <ProgressBar percent={b.averagePercent} className="mt-1.5" label={`${b.batchName}: ${b.averagePercent}% average progress`} />
                    <div className="mt-1 text-[12.5px] text-muted">
                      {b.students} student{b.students === 1 ? "" : "s"} · {b.completed} completed
                      {b.notStarted > 0 && ` · ${b.notStarted} not started`}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href={progressOverviewPath(uni)} className="mt-5 inline-block text-[13px] text-brand hover:underline">
              See progress for all courses
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
}
