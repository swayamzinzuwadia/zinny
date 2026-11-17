import Link from "next/link";
import { Badge, ButtonLink, Empty, PageHeader, Table, Td } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { formatDate, todayIn } from "@/server/lib/dates";
import { listAllBatches } from "@/server/services/batches";

export const metadata = { title: "Batches" };

type Row = Awaited<ReturnType<typeof listAllBatches>>[number];

/** Where a batch is in its life: gold for the ones running now, quiet for the ones that are over. */
function stage(b: Row, today: string): { label: string; tone: "gold" | "brand" | "neutral" | "warn" } {
  if (b.status === "archived") return { label: "Archived", tone: "neutral" };
  if (b.endDate < today) return { label: "Ended", tone: "neutral" };
  if (b.status === "draft") return { label: "Draft", tone: "neutral" };
  if (b.startDate > today) return { label: `Starts ${formatDate(b.startDate, { year: false })}`, tone: "brand" };
  return { label: "Running", tone: "gold" };
}

/**
 * Every batch the person may open, across courses, so a batch is one click from the menu
 * instead of being found through its course. Running and upcoming batches come first.
 */
export default async function BatchesPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const today = todayIn(university.timezone);
  const all = await listAllBatches(actor);
  const over = (b: Row) => b.status === "archived" || b.endDate < today;
  // The service sorts by start date; batches that are over go below the ones still to teach.
  const batches = [...all.filter((b) => !over(b)), ...all.filter(over)];
  const base = `/${uni}/admin/products`;

  return (
    <>
      <PageHeader
        title="Batches"
        subtitle="Every batch across your courses, with its timings, seats and faculty. Open one for its timetable, students and attendance."
        actions={
          <ButtonLink href={`${base}/courses`} variant="secondary" icon="view">
            See courses
          </ButtonLink>
        }
      />
      {batches.length === 0 ? (
        <Empty title="No batches yet">A batch is added from its course: open a course, then its Batches tab. Batches you teach show here once you&apos;re added to them.</Empty>
      ) : (
        <Table head={["Batch", "Days and timings", "Dates", "Seats", "Faculty", "Status"]}>
          {batches.map((b) => {
            const s = stage(b, today);
            return (
              <tr key={b.batchId} className="hover:bg-canvas/60">
                <Td>
                  <Link href={`${base}/batches/${b.batchId}`} className="font-medium text-ink hover:text-brand">
                    {b.batchName}
                  </Link>
                  <div className="text-[13px] text-muted">{b.courseTitle}</div>
                </Td>
                <Td className="text-muted">{b.timings || "No timings yet"}</Td>
                <Td className="whitespace-nowrap text-muted tabular-nums">
                  {formatDate(b.startDate, { year: false })} to {formatDate(b.endDate)}
                </Td>
                <Td className="whitespace-nowrap tabular-nums">
                  {b.seatsTaken}/{b.seatLimit}
                  {b.seatsLeft === 0 && !over(b) && <span className="ml-2 text-[13px] text-warn">Full</span>}
                </Td>
                <Td className="text-muted">{b.faculty?.length ? b.faculty.join(", ") : "No faculty yet"}</Td>
                <Td>
                  <Badge tone={s.tone}>{s.label}</Badge>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
