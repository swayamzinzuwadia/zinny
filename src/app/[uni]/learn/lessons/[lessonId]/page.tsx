import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClass, Card, cx, Empty, Notice } from "@/components/ui";
import { Icon, ProgressBar, PROSE, StateDot } from "@/modules/content-progress/components/bits";
import { LessonOpened } from "@/modules/content-progress/components/lesson-opened";
import { MarkLessonComplete } from "@/modules/content-progress/components/mark-lesson-complete";
import { PdfViewer } from "@/modules/content-progress/components/pdf-viewer";
import { VideoPlayer } from "@/modules/content-progress/components/video-player";
import { formatDate, formatTime } from "@/modules/content-progress/lib/dates";
import { formatMinutes, KIND_LABEL } from "@/modules/content-progress/lib/kinds";
import { lessonForLearner, NOT_ENROLLED } from "@/modules/content-progress/learn";
import { courseHubPath, joinPath, lessonFilePath, lessonPath, lessonProgressPath } from "@/modules/content-progress/paths";
import { spaceContext } from "@/server/context";
import { ForbiddenError, NotFoundError } from "@/server/errors";

export const metadata = { title: "Lesson" };

/**
 * The lesson player (mobile first): video, PDF, text, link or live lesson, with next and
 * previous, the course outline, and the learner's progress. Locked lessons show when they open.
 */
export default async function LessonPage({ params }: { params: Promise<{ uni: string; lessonId: string }> }) {
  const { uni, lessonId } = await params;
  const { actor } = await spaceContext(uni);
  let data;
  try {
    data = await lessonForLearner(actor, lessonId);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof ForbiddenError) {
      return (
        <Empty title="This lesson isn't open to you">
          {e.message === NOT_ENROLLED ? NOT_ENROLLED : "Your account can't open lessons."}{" "}
          <Link className="text-brand" href={`/${uni}/learn/courses`}>
            Browse courses
          </Link>
        </Empty>
      );
    }
    throw e;
  }
  const { lesson, content, progress, outline, prev, next, course, enrolment, locked, unlockOn, sessions, today } = data;
  const hub = courseHubPath(uni, enrolment.enrolmentId);
  const manual = lesson.kind !== "video";

  return (
    <div className="pb-6">
      {!locked && <LessonOpened uni={uni} lessonId={lesson.id} />}
      <nav className="mb-3 flex items-center gap-2 text-[13px] text-muted" aria-label="Breadcrumb">
        <Link href={hub} className="truncate hover:text-ink">
          {course.title}
        </Link>
        <span aria-hidden>/</span>
        <span className="truncate">{data.sectionTitle}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="min-w-0">
          <header className="mb-4">
            <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Icon name={lesson.kind} size={15} />
                {KIND_LABEL[lesson.kind]}
              </span>
              {lesson.durationMinutes > 0 && <span>· {formatMinutes(lesson.durationMinutes)}</span>}
              {!lesson.required && <span>· Optional</span>}
              {progress.completed && <span className="font-medium text-brand">· Completed</span>}
            </div>
            <h1 className="text-[24px] font-semibold leading-tight tracking-tight sm:text-[28px]">{lesson.title}</h1>
          </header>

          {locked ? (
            <Card className="py-10 text-center">
              <span className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-canvas text-muted ring-1 ring-line">
                <Icon name="locked" size={22} />
              </span>
              <p className="text-[17px] font-medium">Opens on {formatDate(unlockOn!, { weekday: true })}</p>
              <p className="mx-auto mt-1 max-w-sm text-[14px] text-muted">
                This lesson unlocks {formatDate(unlockOn!)}. Carry on with the lessons that are open until then.
              </p>
              {outline.next && outline.next.id !== lesson.id && (
                <Link href={lessonPath(uni, outline.next.id)} className={cx(buttonClass("primary"), "mt-5")}>
                  Go to {outline.next.title}
                </Link>
              )}
            </Card>
          ) : (
            <>
              {content?.kind === "video" && content.video && (
                <VideoPlayer
                  video={content.video.source === "upload" ? { source: "upload", src: lessonFilePath(uni, lesson.id) } : content.video}
                  title={lesson.title}
                  progressUrl={lessonProgressPath(uni, lesson.id)}
                  initial={{ completed: progress.completed, percent: progress.percent, position: progress.positionSeconds }}
                  nextHref={next && next.state !== "locked" ? lessonPath(uni, next.id) : null}
                />
              )}
              {content?.kind === "pdf" && content.pdf && (
                <PdfViewer src={lessonFilePath(uni, lesson.id)} downloadHref={`${lessonFilePath(uni, lesson.id)}?download=1`} fileName={content.pdf.fileName} />
              )}
              {content?.kind === "text" && (
                <Card className="px-5 py-6 sm:px-8 sm:py-8">
                  <div className={PROSE} dangerouslySetInnerHTML={{ __html: content.html }} />
                </Card>
              )}
              {content?.kind === "link" && content.url && (
                <Card>
                  <p className="text-[15px]">This lesson is on another website. It opens in a new tab; come back here to mark it complete.</p>
                  <a href={content.url} target="_blank" rel="noopener noreferrer" className={cx(buttonClass("primary"), "mt-4")}>
                    Open the lesson
                  </a>
                  <div className="mt-3 break-all text-[13px] text-muted">{new URL(content.url).host}</div>
                </Card>
              )}
              {content?.kind === "live" && (
                <Card>
                  <p className="text-[15px]">This lesson happens in your batch&apos;s live classes.</p>
                  {sessions.length === 0 ? (
                    <p className="mt-3 text-[14px] text-muted">No live classes in the next four weeks.</p>
                  ) : (
                    <ul className="mt-4 divide-y divide-line">
                      {sessions.map((s) => {
                        const isToday = s.date === today;
                        return (
                          <li key={`${s.date}-${s.startTime}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                            <div>
                              <div className={cx("font-medium", isToday && "text-gold-strong")}>{isToday ? "Today" : formatDate(s.date, { weekday: true })}</div>
                              <div className="tabular text-[13px] text-muted">
                                {formatTime(s.startTime)} to {formatTime(s.endTime)}
                                {s.kind !== "regular" && ` · ${s.kind === "extra" ? "Extra class" : "Moved"}`}
                              </div>
                            </div>
                            {isToday && (
                              // A plain link (never prefetched): the join route records attendance.
                              <a href={joinPath(uni, enrolment.batchId, s.date)} target="_blank" rel="noreferrer" className={buttonClass("gold", "sm")}>
                                Join class
                              </a>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <Link href={`/${uni}/learn/timetable`} className="mt-3 inline-block text-[14px] text-brand hover:underline">
                    See the full timetable
                  </Link>
                </Card>
              )}

              {manual && (
                <div className="mt-5">
                  <MarkLessonComplete uni={uni} lessonId={lesson.id} completed={progress.completed} nextHref={next && next.state !== "locked" ? lessonPath(uni, next.id) : null} />
                </div>
              )}
            </>
          )}

          <div className="mt-6 grid grid-cols-2 gap-3">
            {prev ? (
              <Link href={lessonPath(uni, prev.id)} className="group rounded-[18px] border border-line bg-surface px-4 py-3 hover:border-brand/40">
                <div className="text-[12px] text-muted">Previous</div>
                <div className="truncate text-[14px] font-medium group-hover:text-brand">{prev.title}</div>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={lessonPath(uni, next.id)} className="group rounded-[18px] border border-line bg-surface px-4 py-3 text-right hover:border-brand/40">
                <div className="text-[12px] text-muted">{next.state === "locked" ? `Next, opens ${formatDate(next.unlockOn!, { year: false })}` : "Next"}</div>
                <div className="truncate text-[14px] font-medium group-hover:text-brand">{next.title}</div>
              </Link>
            ) : (
              <Link href={hub} className="group rounded-[18px] border border-line bg-surface px-4 py-3 text-right hover:border-brand/40">
                <div className="text-[12px] text-muted">That&apos;s the last lesson</div>
                <div className="truncate text-[14px] font-medium group-hover:text-brand">Back to the course</div>
              </Link>
            )}
          </div>
        </article>

        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <details className="group rounded-[22px] border border-line bg-surface lg:open:block" open>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 lg:cursor-default">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[15px] font-medium">Course progress</span>
                  <span className="tabular text-[14px] font-medium">{outline.percent}%</span>
                </div>
                <ProgressBar percent={outline.percent} className="mt-2" />
                <div className="mt-1.5 text-[12.5px] text-muted">
                  {outline.done} of {outline.total} required lessons
                  {enrolment.status === "completed" && " · Course completed"}
                </div>
              </div>
            </summary>
            <div className="max-h-[60vh] overflow-y-auto border-t border-line px-3 py-3 lg:max-h-[calc(100dvh-14rem)]">
              {outline.sections.map((s) => (
                <div key={s.id} className="mb-3 last:mb-0">
                  <div className="px-2 pb-1 pt-1 text-[12px] text-muted">{s.title}</div>
                  <ul>
                    {s.lessons.map((l) => {
                      const current = l.id === lesson.id;
                      return (
                        <li key={l.id}>
                          <Link
                            href={lessonPath(uni, l.id)}
                            aria-current={current ? "page" : undefined}
                            className={cx("flex items-center gap-3 rounded-xl px-2 py-2 text-[14px]", current ? "bg-brand-soft" : "hover:bg-canvas")}
                          >
                            <StateDot state={l.state} kind={l.kind} />
                            <span className="min-w-0 flex-1">
                              <span className={cx("block truncate", current && "font-medium", l.state === "locked" && "text-muted")}>{l.title}</span>
                              <span className="block text-[12px] text-muted">
                                {l.state === "locked" ? `Opens ${formatDate(l.unlockOn!, { year: false })}` : KIND_LABEL[l.kind]}
                                {l.durationMinutes > 0 && ` · ${formatMinutes(l.durationMinutes)}`}
                                {!l.required && " · Optional"}
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </details>
          {outline.percent === 100 && enrolment.status !== "completed" && (
            <div className="mt-3">
              <Notice tone="brand">You&apos;ve finished every required lesson. Your course is being marked complete.</Notice>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
