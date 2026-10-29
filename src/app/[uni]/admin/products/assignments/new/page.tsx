import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { createAssignmentAction } from "@/modules/assignments-polls/actions";
import { AssignmentForm } from "@/modules/assignments-polls/components/assignment-form";
import { ACCEPT, MAX_UPLOAD_MB } from "@/modules/assignments-polls/lib/files";
import { addDaysTo, instantToZoned } from "@/modules/assignments-polls/lib/time";
import { courseTab, uploadHref } from "@/modules/assignments-polls/links";
import { one, orNotFound } from "@/modules/assignments-polls/pages";
import { assignmentFormOptions } from "@/modules/assignments-polls/service/assignments";

export const metadata = { title: "New assignment" };

export default async function NewAssignment({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { uni } = await params;
  const courseId = one((await searchParams).course);
  if (!courseId) notFound();
  const { actor, university } = await spaceContext(uni);
  const opts = await orNotFound(assignmentFormOptions(actor, courseId));
  const today = instantToZoned(new Date(), university.timezone).date;

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={courseTab(uni, courseId, "assignments")} className="hover:text-ink">
          {opts.course.title} / Assignments
        </Link>
      </div>
      <PageHeader title="New assignment" subtitle="Students are told as soon as you save it." />
      {!opts.canCreate ? (
        <Notice tone="warn">You can add assignments only to courses where you teach a batch.</Notice>
      ) : (
        <AssignmentForm
          action={createAssignmentAction}
          uni={uni}
          courseId={courseId}
          batches={opts.batches.map((b) => ({ id: b.id, name: b.name, note: b.endDate < today ? "ended" : undefined }))}
          canAll={opts.canAll}
          values={{
            title: "",
            instructionsHtml: "",
            dueDate: addDaysTo(today, 7),
            dueTime: "23:59",
            points: 10,
            allowLate: false,
            latePenaltyPct: 10,
            submissionType: "both",
            maxFiles: 3,
            maxFileMb: 10,
            scope: opts.canAll ? "all" : "some",
            batchIds: [],
          }}
          uploadEndpoint={uploadHref(uni, "admin")}
          accept={ACCEPT}
          maxUploadMb={MAX_UPLOAD_MB}
          submitLabel="Add assignment"
          timezoneNote={`Times are in ${university.timezone.replace("_", " ")}.`}
        />
      )}
    </>
  );
}
