import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ButtonLink, Notice } from "@/components/ui";
import { hasRole } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { todayIn } from "@/server/lib/dates";
import { batchOptions } from "@/server/services/enrolment";
import { BatchPicker } from "../../batch-picker";
import { withdrawEnrolmentAction } from "../../actions";
import { sendParentsHome } from "../../view";

export default async function CoursePage({ params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const { actor, university } = await spaceContext(uni);
  sendParentsHome(actor, uni);
  // Someone here who isn't a student (they bought a recording from this institute, say): say how to get in, rather than sending them away.
  if (!hasRole(actor, ["student", "alumni"])) {
    return (
      <div className="max-w-lg">
        <h1 className="text-[26px] font-semibold tracking-tight">Join {university.name} to enrol</h1>
        <p className="mt-2 text-muted">Batches are for {university.name}&apos;s students. Enter the joining code the institute gave you, then come back here to pick your batch.</p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <ButtonLink href="/join">Enter a joining code</ButtonLink>
          <Link href="/marketplace" className="text-[14px] font-medium text-brand hover:underline">
            Back to the marketplace
          </Link>
        </div>
      </div>
    );
  }
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
          today={todayIn(university.timezone)}
        />
      )}
    </>
  );
}
