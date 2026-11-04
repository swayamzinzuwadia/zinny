import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Notice } from "@/components/ui";
import { hasRole } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { batchOptions } from "@/server/services/enrolment";
import { BatchPicker } from "../../batch-picker";
import { withdrawEnrolmentAction } from "../../actions";

export default async function CoursePage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor } = await spaceContext(uni);
  if (!hasRole(actor, ["student", "alumni"])) redirect("/marketplace");
  const { course, options, myEnrolment, myRequest } = await batchOptions(actor, id);

  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight">{course.title}</h1>
      {course.description && <p className="mt-1 max-w-2xl text-muted">{course.description}</p>}

      <h2 className="mb-3 mt-8 text-[17px] font-semibold">Pick your batch</h2>
      {myEnrolment?.status !== "active" && myRequest?.status === "approved" && (
        <div className="mb-4">
          <Notice>
            You&apos;re accepted into <b>{myRequest.batchName}</b>. Pick it below to join it; your seat is kept for you.
          </Notice>
        </div>
      )}
      {myEnrolment?.status !== "active" && myRequest?.status === "declined" && (
        <div className="mb-4">
          <Notice tone="warn">
            Your request for {myRequest.batchName} wasn&apos;t accepted{myRequest.note ? `: ${myRequest.note}` : "."} You can ask for another batch.
          </Notice>
        </div>
      )}
      {myEnrolment?.status !== "active" && myRequest?.status === "requested" ? (
        <div className="space-y-3">
          <Notice>
            You asked to join <b>{myRequest.batchName}</b>. Its faculty will accept or decline, and we&apos;ll let you know.
          </Notice>
          <ActionForm action={withdrawEnrolmentAction}>
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="enrolmentId" value={myRequest.enrolmentId} />
            <SubmitButton variant="secondary" size="sm" pendingText="Withdrawing…">
              Withdraw request
            </SubmitButton>
          </ActionForm>
        </div>
      ) : myEnrolment?.status === "active" ? (
        <Notice>
          You&apos;re enrolled in {options.find((o) => o.mine)?.name ?? "this course"}.{" "}
          <Link href={myEnrolment ? `/${uni}/learn/my/${myEnrolment.id}` : `/${uni}/learn/my`} className="font-medium underline">
            Switch batch
          </Link>
        </Notice>
      ) : (
        <BatchPicker
          uni={uni}
          options={options}
          mode="enrol"
          acceptedBatchId={myRequest?.status === "approved" ? myRequest.batchId : undefined}
        />
      )}
    </>
  );
}
