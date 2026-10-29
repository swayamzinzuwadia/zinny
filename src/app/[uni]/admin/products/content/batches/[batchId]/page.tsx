import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Badge, Empty, PageHeader, Stat, Table, Td } from "@/components/ui";
import { ProgressBar } from "@/modules/content-progress/components/bits";
import { MarkCompleteButton } from "@/modules/content-progress/components/mark-complete-button";
import { formatDate, formatMoment, relativeDay } from "@/modules/content-progress/lib/dates";
import { curriculumPath, progressOverviewPath } from "@/modules/content-progress/paths";
import { batchProgress } from "@/modules/content-progress/staff";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";

export const metadata = { title: "Batch progress" };

/**
 * One batch: every student with their %, last activity, and "Mark complete" for courses
 * finished offline (needs enrolment.complete: Admin, HOD). Viewing needs content.view_progress.
 */
export default async function BatchProgressPage({ params }: { params: Promise<{ uni: string; batchId: string }> }) {
  const { uni, batchId } = await params;
  const { actor } = await spaceContext(uni);
  const data = await batchProgress(actor, batchId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { batch, course, students, summary, totalRequired, canMarkComplete, university } = data;
  const tz = university.timezone;

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={progressOverviewPath(uni)} className="hover:text-ink">
          Learning progress
        </Link>{" "}
        /{" "}
        <Link href={curriculumPath(uni, course.id)} className="hover:text-ink">
          {course.title}
        </Link>
      </div>
      <PageHeader title={`${batch.name} progress`} subtitle={`${course.title} · ${formatDate(batch.startDate)} to ${formatDate(batch.endDate)}`} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Students" value={summary.students} />
        <Stat label="Average progress" value={`${summary.average}%`} hint={`${totalRequired} required lesson${totalRequired === 1 ? "" : "s"}`} />
        <Stat label="Completed" value={summary.completed} />
        <Stat label="Not started" value={summary.notStarted} />
      </div>

      {students.length === 0 ? (
        <Empty title="No students in this batch yet">Students show here once they enrol.</Empty>
      ) : (
        <Table head={canMarkComplete ? ["Student", "Progress", "Required lessons", "Last activity", ""] : ["Student", "Progress", "Required lessons", "Last activity"]}>
          {students.map((s) => (
            <tr key={s.enrolmentId}>
              <Td>
                <div className="flex items-center gap-3">
                  <Avatar name={s.name} size={32} />
                  <div className="min-w-0">
                    <div className="font-medium">{s.name}</div>
                    <div className="truncate text-[12.5px] text-muted">{s.email}</div>
                  </div>
                </div>
              </Td>
              <Td className="w-64">
                {s.status === "completed" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="brand">Completed</Badge>
                    {s.completedOffline && <span className="text-[12.5px] text-muted">Marked complete by staff ({s.percent}% online)</span>}
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <ProgressBar percent={s.percent} className="flex-1" label={`${s.name}: ${s.percent}%`} />
                    <span className="tabular w-10 text-right text-[13px]">{s.percent}%</span>
                  </div>
                )}
              </Td>
              <Td className="tabular text-muted">
                {s.done} of {s.total}
              </Td>
              <Td className="text-muted">
                {s.lastActivityAt ? <span title={formatMoment(s.lastActivityAt, tz)}>{relativeDay(s.lastActivityAt, tz)}</span> : "Not started"}
              </Td>
              {canMarkComplete && (
                <Td className="text-right">
                  {s.status === "active" && <MarkCompleteButton uni={uni} batchId={batch.id} enrolmentId={s.enrolmentId} name={s.name} percent={s.percent} />}
                </Td>
              )}
            </tr>
          ))}
        </Table>
      )}
      {canMarkComplete && (
        <p className="mt-4 max-w-2xl text-[13px] text-muted">
          Courses complete on their own when a student finishes every required lesson. Use Mark complete for students who finished the course offline; it can&apos;t be undone.
        </p>
      )}
    </>
  );
}
