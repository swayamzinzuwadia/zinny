import Link from "next/link";
import { Badge, Empty, PageHeader, Table, Td } from "@/components/ui";
import { ProgressBar } from "@/modules/content-progress/components/bits";
import { formatDate } from "@/modules/content-progress/lib/dates";
import { batchProgressPath, curriculumPath } from "@/modules/content-progress/paths";
import { progressOverview } from "@/modules/content-progress/staff";
import { spaceContext } from "@/server/context";

export const metadata = { title: "Learning progress" };

/** Progress by course and batch for everything the viewer may see (content.view_progress). */
export default async function ProgressOverviewPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const rows = await progressOverview(actor);
  const courses = [...new Map(rows.map((r) => [r.courseId, r.courseTitle])).entries()];

  return (
    <>
      <PageHeader
        title="Learning progress"
        subtitle="How far students are through each course's required lessons, batch by batch. Open a batch to see every student."
      />
      {rows.length === 0 ? (
        <Empty title="No batches to show">Progress shows here for the batches you teach or manage.</Empty>
      ) : (
        <div className="space-y-8">
          {courses.map(([courseId, title]) => {
            const batches = rows.filter((r) => r.courseId === courseId);
            return (
              <section key={courseId}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[19px] font-semibold">{title}</h2>
                  <Link href={curriculumPath(uni, courseId)} className="text-[13px] text-brand hover:underline">
                    Curriculum · {batches[0].requiredLessons} required lesson{batches[0].requiredLessons === 1 ? "" : "s"}
                  </Link>
                </div>
                <Table head={["Batch", "Students", "Not started", "In progress", "Completed", "Average progress"]}>
                  {batches.map((b) => (
                    <tr key={b.batchId} className="hover:bg-canvas/60">
                      <Td>
                        <Link href={batchProgressPath(uni, b.batchId)} className="font-medium hover:text-brand">
                          {b.batchName}
                        </Link>
                        <div className="text-[12.5px] text-muted">
                          {formatDate(b.startDate)} to {formatDate(b.endDate)}
                          {b.batchStatus !== "open" && (
                            <span className="ml-2">
                              <Badge>{b.batchStatus}</Badge>
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td className="tabular">{b.students}</Td>
                      <Td className="tabular">{b.notStarted}</Td>
                      <Td className="tabular">{b.inProgress}</Td>
                      <Td className="tabular">
                        {b.completed}
                        {b.students > 0 && <span className="text-muted"> ({b.completionRate}%)</span>}
                      </Td>
                      <Td className="w-56">
                        <div className="flex items-center gap-3">
                          <ProgressBar percent={b.averagePercent} className="flex-1" label={`${b.batchName}: ${b.averagePercent}% average`} />
                          <span className="tabular w-10 text-right text-[13px]">{b.averagePercent}%</span>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </Table>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
