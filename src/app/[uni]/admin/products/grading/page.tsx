import { ActionLink, Badge, Empty, PageHeader, Table, Td } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { gradingQueue } from "@/modules/assessments/attempts";
import { fmtMarks } from "@/modules/assessments/lib/labels";
import { relative } from "@/modules/assignments-polls/lib/time";
import { staffAssignment } from "@/modules/assignments-polls/links";
import { toGradeSummary } from "@/modules/assignments-polls/service/assignments";

export const metadata = { title: "Grading" };

type Row = { key: string; kind: "Test" | "Assignment"; title: string; from: string; waiting: string; since: Date | null; href: string };

/**
 * Everything waiting for a grade in one queue, oldest first: short answers from tests and
 * handed-in assignments. Each module still decides what its people may grade (assess.grade,
 * assignment.grade); someone who grades neither sees an empty queue.
 */
export default async function GradingPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const [answers, work] = await Promise.all([gradingQueue(actor), toGradeSummary(actor)]);

  // A test is graded one attempt at a time; an assignment one batch at a time.
  const byAttempt = new Map<string, (typeof answers)[number][]>();
  for (const a of answers) byAttempt.set(a.attemptId, [...(byAttempt.get(a.attemptId) ?? []), a]);
  const rows: Row[] = [
    ...[...byAttempt.values()].map((items): Row => {
      const first = items[0];
      return {
        key: `test-${first.attemptId}`,
        kind: "Test",
        title: first.testTitle,
        from: first.studentName,
        waiting: `${items.length} answer${items.length === 1 ? "" : "s"}, ${fmtMarks(items.reduce((s, i) => s + i.marks, 0))} marks`,
        since: first.submittedAt,
        href: `/${uni}/admin/products/tests/attempts/${first.attemptId}`,
      };
    }),
    ...work.map(
      (w): Row => ({
        key: `assignment-${w.assignmentId}-${w.batchId}`,
        kind: "Assignment",
        title: w.title,
        from: `${w.courseTitle}, ${w.batchName}`,
        waiting: `${w.count} handed in${w.late ? `, ${w.late} late` : ""}`,
        since: w.oldest,
        href: staffAssignment(uni, w.assignmentId, { batch: w.batchId }),
      }),
    ),
  ].sort((a, b) => (a.since?.getTime() ?? 0) - (b.since?.getTime() ?? 0));

  return (
    <>
      <PageHeader title="Grading" subtitle="Test answers and handed-in assignments from your batches, oldest first. Students see their result once it is graded." />
      {rows.length === 0 ? (
        <Empty title="Nothing to grade">Short answers and handed-in work show up here as students submit.</Empty>
      ) : (
        <Table head={["Work", "From", "Waiting", "Since", ""]}>
          {rows.map((r) => (
            <tr key={r.key} className="hover:bg-canvas/60">
              <Td>
                <div className="font-medium">{r.title}</div>
                <div className="mt-1">
                  <Badge tone={r.kind === "Test" ? "brand" : "neutral"}>{r.kind}</Badge>
                </div>
              </Td>
              <Td className="text-muted">{r.from}</Td>
              <Td className="whitespace-nowrap">{r.waiting}</Td>
              <Td className="whitespace-nowrap text-muted">{r.since ? relative(r.since) : ""}</Td>
              <Td className="text-right">
                <ActionLink href={r.href}>Grade</ActionLink>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
