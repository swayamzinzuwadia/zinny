import Link from "next/link";
import { Empty, PageHeader, Table, Td } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { gradingQueue } from "@/modules/assessments/attempts";
import { fmtMarks } from "@/modules/assessments/lib/labels";
import { formatMoment } from "@/modules/assessments/lib/time";
import { timezoneOf } from "@/modules/assessments/results";

export const metadata = { title: "Grading" };

/** Short answers waiting for whoever holds assess.grade on the student's batch. */
export default async function GradingPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const [queue, timezone] = await Promise.all([gradingQueue(actor), timezoneOf(actor)]);
  const byAttempt = new Map<string, (typeof queue)[number][]>();
  for (const q of queue) byAttempt.set(q.attemptId, [...(byAttempt.get(q.attemptId) ?? []), q]);

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/tests`} className="hover:text-ink">
          Tests
        </Link>{" "}
        / Grading
      </div>
      <PageHeader title="Grading" subtitle="Short answers from your batches, oldest first. Students get their result once every answer in the attempt is graded." />
      {byAttempt.size === 0 ? (
        <Empty title="Nothing to grade">New short answers show up here as students submit.</Empty>
      ) : (
        <Table head={["Student", "Test", "Waiting", "Submitted", ""]}>
          {[...byAttempt.values()].map((items) => {
            const first = items[0];
            return (
              <tr key={first.attemptId}>
                <Td className="font-medium">{first.studentName}</Td>
                <Td>{first.testTitle}</Td>
                <Td>
                  {items.length} answer{items.length === 1 ? "" : "s"}, {fmtMarks(items.reduce((s, i) => s + i.marks, 0))} marks
                </Td>
                <Td className="text-muted">{first.submittedAt ? formatMoment(first.submittedAt, timezone) : ""}</Td>
                <Td>
                  <Link href={`/${uni}/admin/products/tests/attempts/${first.attemptId}`} className="font-medium text-brand">
                    Grade
                  </Link>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
