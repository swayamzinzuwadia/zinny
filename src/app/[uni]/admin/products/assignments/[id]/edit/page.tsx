import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, CardTitle, Notice, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { deleteAssignmentAction, updateAssignmentAction } from "@/modules/assignments-polls/actions";
import { AssignmentForm } from "@/modules/assignments-polls/components/assignment-form";
import { ACCEPT, MAX_UPLOAD_MB } from "@/modules/assignments-polls/lib/files";
import { instantToZoned } from "@/modules/assignments-polls/lib/time";
import { fileHref, staffAssignment, uploadHref } from "@/modules/assignments-polls/links";
import { orNotFound } from "@/modules/assignments-polls/pages";
import { assignmentFormOptions, getStaffAssignment } from "@/modules/assignments-polls/service/assignments";

export const metadata = { title: "Edit assignment" };

export default async function EditAssignment({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor, university } = await spaceContext(uni);
  const d = await orNotFound(getStaffAssignment(actor, id));
  const a = d.assignment;
  const opts = await orNotFound(assignmentFormOptions(actor, a.courseId));
  const due = instantToZoned(a.dueAt, university.timezone);
  const today = instantToZoned(new Date(), university.timezone).date;
  const submitted = d.batches.reduce((n, b) => n + b.submitted, 0);

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={staffAssignment(uni, a.id)} className="hover:text-ink">
          {d.courseTitle} / {a.title}
        </Link>
      </div>
      <PageHeader title="Edit assignment" subtitle="Students already set this work aren't told again; students in batches you add are." />
      {!d.canManage ? (
        <Notice tone="warn">Only staff who teach every batch of this assignment can change it.</Notice>
      ) : (
        <>
          <AssignmentForm
            action={updateAssignmentAction}
            uni={uni}
            courseId={a.courseId}
            assignmentId={a.id}
            batches={opts.batches.map((b) => ({ id: b.id, name: b.name, note: b.endDate < today ? "ended" : undefined }))}
            canAll={opts.canAll}
            values={{
              title: a.title,
              instructionsHtml: a.instructionsHtml,
              dueDate: due.date,
              dueTime: due.time,
              points: a.points,
              allowLate: a.allowLate,
              latePenaltyPct: a.latePenaltyPct || 10,
              submissionType: a.submissionType,
              maxFiles: a.maxFiles,
              maxFileMb: a.maxFileMb,
              scope: a.allBatches ? "all" : "some",
              batchIds: d.batches.map((b) => b.id),
            }}
            attachments={d.attachments.map((f) => ({ ...f, href: fileHref(uni, f.id, "admin") }))}
            uploadEndpoint={uploadHref(uni, "admin")}
            accept={ACCEPT}
            maxUploadMb={MAX_UPLOAD_MB}
            submitLabel="Save changes"
            timezoneNote={`Times are in ${university.timezone.replace("_", " ")}. Moving the due date re-checks which ungraded work was late.`}
            lockedPoints={d.gradedCount ? `${d.gradedCount} student${d.gradedCount === 1 ? " is" : "s are"} already graded, so points can't change.` : undefined}
          />
          <Card className="mt-8 max-w-xl border-danger/30">
            <CardTitle>Delete assignment</CardTitle>
            <p className="mb-4 text-[14px] text-muted">
              {submitted
                ? `${submitted} student${submitted === 1 ? " has" : "s have"} handed in work. Deleting removes their work, files and grades for good.`
                : "Nobody has handed in work yet. Deleting can't be undone."}
            </p>
            <ActionForm action={deleteAssignmentAction} confirm={`Delete "${a.title}" and everything handed in for it? This can't be undone.`}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="assignmentId" value={a.id} />
              <input type="hidden" name="courseId" value={a.courseId} />
              <SubmitButton variant="danger">Delete assignment</SubmitButton>
            </ActionForm>
          </Card>
        </>
      )}
    </>
  );
}
