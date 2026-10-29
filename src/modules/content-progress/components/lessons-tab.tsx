import Link from "next/link";
import { buttonClass, Card, cx, Empty } from "@/components/ui";
import type { LearnerCourseTabProps } from "@/contracts/module";
import { learnerOutline } from "../learn";
import { formatDate } from "../lib/dates";
import { formatMinutes, KIND_LABEL } from "../lib/kinds";
import { lessonPath } from "../paths";
import { ProgressBar, StateDot } from "./bits";

/** Learner course hub → Lessons tab (learnerCourseTabs.lessons). */
export async function LessonsTab({ uni, actor, enrolment }: LearnerCourseTabProps) {
  const { outline } = await learnerOutline(actor, enrolment.enrolmentId);
  if (outline.lessons.length === 0) {
    return <Empty title="No lessons yet">Your faculty hasn&apos;t added lessons to this course yet. They&apos;ll show up here.</Empty>;
  }
  const completed = enrolment.status === "completed";
  const resume = outline.next;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-medium">{completed ? "Course completed" : "Your progress"}</span>
          <span className="tabular text-[22px] font-semibold">{outline.percent}%</span>
        </div>
        <ProgressBar percent={completed ? Math.max(outline.percent, 100) : outline.percent} className="mt-2" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px] text-muted">
            {outline.done} of {outline.total} required lessons
            {outline.totalMinutes > 0 && ` · ${formatMinutes(outline.totalMinutes)} in total`}
          </span>
          {resume && !completed && (
            <Link href={lessonPath(uni, resume.id)} className={cx(buttonClass("primary", "sm"), "w-full sm:w-auto")}>
              {resume.started ? "Continue" : outline.done === 0 ? "Start the first lesson" : "Next lesson"}
            </Link>
          )}
        </div>
        {!resume && !completed && outline.nextUnlock && (
          <p className="mt-3 text-[13px] text-muted">
            You&apos;re up to date. The next lesson opens on {formatDate(outline.nextUnlock.unlockOn!, { weekday: true })}.
          </p>
        )}
      </Card>

      {outline.sections.map((s, i) => {
        const done = s.lessons.filter((l) => l.state === "done").length;
        return (
          <section key={s.id}>
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h2 className="text-[16px] font-medium">
                <span className="text-muted">{i + 1}.</span> {s.title}
              </h2>
              <span className="tabular shrink-0 text-[12.5px] text-muted">
                {done}/{s.lessons.length}
              </span>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-[22px] border border-line bg-surface">
              {s.lessons.map((l) => {
                const isNext = resume?.id === l.id && !completed;
                return (
                  <li key={l.id}>
                    <Link href={lessonPath(uni, l.id)} className={cx("flex items-center gap-3 px-4 py-3.5 hover:bg-canvas/70 sm:px-5", isNext && "bg-gold-soft/40")}>
                      <StateDot state={l.state} kind={l.kind} />
                      <span className="min-w-0 flex-1">
                        <span className={cx("block truncate text-[15px]", l.state === "locked" ? "text-muted" : "font-medium")}>{l.title}</span>
                        <span className="block text-[12.5px] text-muted">
                          {l.state === "locked" ? `Opens ${formatDate(l.unlockOn!, { weekday: true })}` : KIND_LABEL[l.kind]}
                          {l.durationMinutes > 0 && ` · ${formatMinutes(l.durationMinutes)}`}
                          {!l.required && " · Optional"}
                          {l.state === "open" && l.kind === "video" && l.percent > 0 && ` · ${l.percent}% watched`}
                        </span>
                      </span>
                      {isNext && <span className="shrink-0 text-[12.5px] font-medium text-gold-strong">Up next</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
