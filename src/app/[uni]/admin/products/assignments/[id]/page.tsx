import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, ButtonLink, Empty, PageHeader, Tabs } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { FileLinks, Instructions } from "@/modules/assignments-polls/components/bits";
import { GradingView } from "@/modules/assignments-polls/components/grading";
import { dueLabel } from "@/modules/assignments-polls/lib/time";
import { courseTab, staffAssignment } from "@/modules/assignments-polls/links";
import { one, orNotFound } from "@/modules/assignments-polls/pages";
import { getStaffAssignment, gradingQueue } from "@/modules/assignments-polls/service/assignments";

export const metadata = { title: "Assignment" };

type Search = Record<string, string | string[] | undefined>;

const HANDED_IN: Record<string, string> = { text: "A written answer", files: "Files", both: "A written answer or files" };

/** One assignment for staff: what was set, and the grading queue for one batch at a time. */
export default async function StaffAssignmentPage({ params, searchParams }: { params: Promise<{ uni: string; id: string }>; searchParams: Promise<Search> }) {
  const { uni, id } = await params;
  const search = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const d = await orNotFound(getStaffAssignment(actor, id));
  const a = d.assignment;
  const tz = university.timezone;
  const visible = d.batches.filter((b) => b.canView);
  const wanted = one(search.batch);
  const batch = visible.find((b) => b.id === wanted) ?? visible.find((b) => b.toGrade > 0) ?? visible[0];
  if (wanted && !visible.some((b) => b.id === wanted)) notFound();
  const queue = batch ? await orNotFound(gradingQueue(actor, a.id, batch.id)) : null;
  const toGrade = visible.reduce((n, b) => n + b.toGrade, 0);

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={`/${uni}/admin/products/courses/${a.courseId}`} className="hover:text-ink">
          {d.courseTitle}
        </Link>{" "}
        /{" "}
        <Link href={courseTab(uni, a.courseId, "assignments")} className="hover:text-ink">
          Assignments
        </Link>
      </div>
      <PageHeader
        title={a.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{dueLabel(a.dueAt, tz)}</span>
            <span aria-hidden>·</span>
            <span>{a.points} points</span>
            <span aria-hidden>·</span>
            <span>{a.allowLate ? (a.latePenaltyPct ? `Late work loses ${a.latePenaltyPct}%` : "Late work accepted") : "No late work"}</span>
            {toGrade > 0 && <Badge tone="gold">{toGrade} to grade</Badge>}
          </span>
        }
        actions={d.canManage ? <ButtonLink href={`${staffAssignment(uni, a.id)}/edit`} variant="secondary">Edit assignment</ButtonLink> : null}
      />

      <details className="mb-6 rounded-[22px] border border-line bg-surface p-5 [&[open]>summary]:mb-3">
        <summary className="cursor-pointer text-[15px] font-medium">
          Instructions and files
          <span className="ml-2 text-[13px] font-normal text-muted">
            {HANDED_IN[a.submissionType]}
            {a.submissionType !== "text" && `, up to ${a.maxFiles} file${a.maxFiles === 1 ? "" : "s"} of ${a.maxFileMb} MB`}
            {" · "}
            {a.allBatches ? "Every batch" : d.batches.map((b) => b.name).join(", ")}
          </span>
        </summary>
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <Instructions html={a.instructionsHtml} />
          <FileLinks uni={uni} area="admin" files={d.attachments} empty="No files attached." />
        </div>
      </details>

      {visible.length === 0 || !batch || !queue ? (
        <Empty title="No batches to grade">This assignment isn&apos;t set for a batch you can see yet.</Empty>
      ) : (
        <>
          {visible.length > 1 && (
            <Tabs
              active={batch.id}
              tabs={visible.map((b) => ({ key: b.id, label: b.name, href: staffAssignment(uni, a.id, { batch: b.id }), count: b.toGrade || undefined }))}
            />
          )}
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-[14px] text-muted">
            <span>
              <span className="tabular font-medium text-ink">{queue.rows.filter((r) => r.submittedAt).length}</span> of {queue.counts.students} handed in
            </span>
            <span>
              <span className="tabular font-medium text-ink">{queue.counts.graded}</span> graded
            </span>
            {queue.counts.late > 0 && (
              <span>
                <span className="tabular font-medium text-ink">{queue.counts.late}</span> late
              </span>
            )}
            {!queue.canGrade && <span>You can see this batch&apos;s work but not grade it.</span>}
          </div>
          <GradingView uni={uni} q={queue} selected={one(search.student)} tz={tz} />
        </>
      )}
    </>
  );
}
