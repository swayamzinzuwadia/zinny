/** Admin slot components: course Assignments tab, batch section and dashboard card. */
import Link from "next/link";
import { Badge, ButtonLink, Card, CardTitle, Empty, Table, Td } from "@/components/ui";
import type { BatchSectionProps, CourseTabProps, DashboardCardProps } from "@/contracts/module";
import { dueLabel, relative } from "../lib/time";
import { staffAssignment, staffBase } from "../links";
import { assignmentFormOptions, listBatchAssignments, listCourseAssignments, toGradeSummary, type StaffAssignmentSummary } from "../service/assignments";

function Handed({ a }: { a: StaffAssignmentSummary }) {
  return (
    <span className="tabular">
      {a.submitted}
      <span className="text-muted"> / {a.students}</span>
      {a.late > 0 && <span className="ml-1.5 text-[12px] text-warn">{a.late} late</span>}
    </span>
  );
}

function ToGrade({ n }: { n: number }) {
  return n > 0 ? <Badge tone="gold">{n} to grade</Badge> : <span className="text-[13px] text-faint">None</span>;
}

/** adminCourseTabs.assignments */
export async function CourseAssignmentsTab({ uni, actor, course, university }: CourseTabProps) {
  const [list, form] = await Promise.all([listCourseAssignments(actor, course.id), assignmentFormOptions(actor, course.id)]);
  const now = new Date();
  const newHref = `${staffBase(uni)}/new?course=${course.id}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-muted">
          {list.length ? `${list.length} assignment${list.length === 1 ? "" : "s"}. Open one to grade it.` : "Set work for every batch of this course, or for one batch."}
        </p>
        {form.canCreate && <ButtonLink href={newHref}>New assignment</ButtonLink>}
      </div>
      {list.length === 0 ? (
        <Empty title="No assignments yet">{form.canCreate ? "Students are told as soon as you add one." : "Faculty and the HOD add assignments here."}</Empty>
      ) : (
        <Table head={["Assignment", "For", "Due", "Handed in", "To grade"]}>
          {list.map((a) => (
            <tr key={a.id}>
              <Td>
                <Link href={staffAssignment(uni, a.id)} className="font-medium hover:text-brand">
                  {a.title}
                </Link>
                <div className="text-[12px] text-muted">
                  {a.points} points{a.allowLate ? `, late work ${a.latePenaltyPct ? `loses ${a.latePenaltyPct}%` : "accepted"}` : ""}
                </div>
              </Td>
              <Td className="text-[13px] text-muted">{a.allBatches ? "Every batch" : a.batches.map((b) => b.name).join(", ")}</Td>
              <Td className="whitespace-nowrap text-[13px]">
                <span className={a.dueAt > now ? "" : "text-muted"}>{dueLabel(a.dueAt, university.timezone, now)}</span>
              </Td>
              <Td>
                <Handed a={a} />
              </Td>
              <Td>
                <ToGrade n={a.toGrade} />
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/** adminBatchSections.assignments */
export async function BatchAssignmentsSection({ uni, actor, batch, course, university }: BatchSectionProps) {
  const list = await listBatchAssignments(actor, batch.id);
  const now = new Date();
  return (
    <Card>
      <CardTitle hint={list.length ? `${list.reduce((n, a) => n + a.toGrade, 0)} to grade` : undefined}>Assignments</CardTitle>
      {list.length === 0 ? (
        <p className="text-[14px] text-muted">
          No assignments for this batch yet.{" "}
          <Link className="text-brand hover:underline" href={`/${uni}/admin/products/courses/${course.id}?tab=assignments`}>
            Open the course&apos;s assignments
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <Link href={staffAssignment(uni, a.id, { batch: batch.id })} className="font-medium hover:text-brand">
                  {a.title}
                </Link>
                <div className="text-[13px] text-muted">{dueLabel(a.dueAt, university.timezone, now)}</div>
              </div>
              <div className="flex items-center gap-4 text-[14px]">
                <span className="text-muted">
                  <Handed a={a} /> handed in
                </span>
                <ToGrade n={a.toGrade} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** dashboardCards.to-grade-assignments: waiting work in the batches the viewer grades. */
export async function ToGradeCard({ uni, actor }: DashboardCardProps) {
  const items = await toGradeSummary(actor);
  const total = items.reduce((n, i) => n + i.count, 0);
  return (
    <Card>
      <CardTitle hint={total ? `${total} waiting` : undefined}>Assignments to grade</CardTitle>
      {items.length === 0 ? (
        <p className="rounded-2xl bg-canvas px-4 py-6 text-center text-[14px] text-muted">Nothing to grade. Handed-in work shows up here.</p>
      ) : (
        <ul className="space-y-2.5">
          {items.slice(0, 6).map((i) => (
            <li key={`${i.assignmentId}-${i.batchId}`}>
              <Link
                href={staffAssignment(uni, i.assignmentId, { batch: i.batchId })}
                className="flex items-center justify-between gap-3 rounded-2xl bg-canvas p-3.5 hover:bg-brand-soft"
              >
                <div className="min-w-0 text-[14px]">
                  <div className="truncate font-medium">{i.title}</div>
                  <div className="truncate text-[13px] text-muted">
                    {i.courseTitle}, {i.batchName}. Oldest handed in {relative(i.oldest)}.
                  </div>
                </div>
                <Badge tone="gold">{i.count}</Badge>
              </Link>
            </li>
          ))}
          {items.length > 6 && (
            <li>
              <Link href={staffBase(uni)} className="text-[13px] font-medium text-brand hover:underline">
                See all {items.length} assignments waiting
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
