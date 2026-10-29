import Link from "next/link";
import { Badge, Empty, PageHeader, Stat, Table, Td } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { calendarDaysUntil, dueLabel } from "@/modules/assignments-polls/lib/time";
import { staffAssignment } from "@/modules/assignments-polls/links";
import { listStaffAssignments } from "@/modules/assignments-polls/service/assignments";

export const metadata = { title: "Assignments" };

/** Every assignment the viewer can see across courses, work waiting for a grade first. */
export default async function AssignmentsIndex({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const list = await listStaffAssignments(actor);
  const tz = university.timezone;
  const now = new Date();
  const toGrade = list.reduce((n, a) => n + a.toGrade, 0);
  const thisWeek = list.filter((a) => a.dueAt > now && calendarDaysUntil(a.dueAt, tz, now) <= 7).length;
  const sorted = [...list].sort((x, y) => Number(y.toGrade > 0) - Number(x.toGrade > 0) || y.dueAt.getTime() - x.dueAt.getTime());

  return (
    <>
      <PageHeader title="Assignments" subtitle="Across the courses and batches you can see. Add new assignments from a course's Assignments tab." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="To grade" value={toGrade} hint={toGrade ? "Handed in and waiting" : "All caught up"} />
        <Stat label="Due in the next 7 days" value={thisWeek} />
        <Stat label="Assignments" value={list.length} />
      </div>
      {sorted.length === 0 ? (
        <Empty title="No assignments yet">Open a course and use its Assignments tab to set work.</Empty>
      ) : (
        <Table head={["Assignment", "Course", "Due", "Handed in", "To grade"]}>
          {sorted.map((a) => (
            <tr key={a.id}>
              <Td>
                <Link href={staffAssignment(uni, a.id)} className="font-medium hover:text-brand">
                  {a.title}
                </Link>
                <div className="text-[12px] text-muted">{a.allBatches ? "Every batch" : a.batches.map((b) => b.name).join(", ")}</div>
              </Td>
              <Td className="text-[13px]">
                <Link href={`/${uni}/admin/products/courses/${a.courseId}?tab=assignments`} className="hover:text-brand">
                  {a.courseTitle}
                </Link>
              </Td>
              <Td className="whitespace-nowrap text-[13px] text-muted">{dueLabel(a.dueAt, tz, now)}</Td>
              <Td className="tabular">
                {a.submitted}
                <span className="text-muted"> / {a.students}</span>
              </Td>
              <Td>{a.toGrade > 0 ? <Badge tone="gold">{a.toGrade} to grade</Badge> : <span className="text-[13px] text-faint">None</span>}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
