import { ActionForm, SubmitButton } from "@/components/forms";
import type { BatchOption } from "@/server/services/enrolment";
import { BatchPicker } from "../batch-picker";
import { cancelSwitchAction } from "../actions";

type Request = { id: string } | null;
type Decision = { status: string; decisionNote: string | null } | null;

/** The switch-batch action used on My learning and on each course hub. */
export function SwitchBatch({
  uni,
  enrolmentId,
  switchRequest,
  lastDecision,
  options,
}: {
  uni: string;
  enrolmentId: string;
  switchRequest: Request;
  lastDecision: Decision;
  options: BatchOption[] | null;
}) {
  return (
    <>
      {lastDecision && !switchRequest && lastDecision.status === "rejected" && (
        <p className="mt-2 text-sm text-muted">Last switch request was not approved{lastDecision.decisionNote ? `: ${lastDecision.decisionNote}` : "."}</p>
      )}
      {switchRequest ? (
        <ActionForm action={cancelSwitchAction} className="mt-3">
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="requestId" value={switchRequest.id} />
          <p className="mb-2 text-sm text-muted">Waiting for your Head of Department to approve.</p>
          <SubmitButton size="sm" variant="secondary">
            Withdraw request
          </SubmitButton>
        </ActionForm>
      ) : (
        options &&
        options.filter((o) => !o.mine).length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-brand">Switch batch</summary>
            <div className="mt-3">
              <p className="mb-3 text-sm text-muted">Your HOD approves the move. It only goes through if the new batch has a free seat.</p>
              <BatchPicker uni={uni} options={options} mode="switch" enrolmentId={enrolmentId} />
            </div>
          </details>
        )
      )}
    </>
  );
}
