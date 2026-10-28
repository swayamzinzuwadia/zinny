import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, Empty } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { formatDate } from "@/server/lib/dates";
import { batchOptions, myLearning } from "@/server/services/enrolment";
import { BatchPicker } from "../batch-picker";
import { cancelSwitchAction } from "../actions";

export const metadata = { title: "My learning" };

export default async function MyLearning({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const learning = (await myLearning(actor)).filter((l) => l.status === "active");
  const options = await Promise.all(learning.map((l) => batchOptions(actor, l.course.id).catch(() => null)));

  return (
    <>
      <h1 className="mb-5 text-[26px] font-semibold tracking-tight">My learning</h1>
      {learning.length === 0 && <Empty title="You haven't enrolled in anything yet" />}
      <div className="space-y-4">
        {learning.map((l, i) => (
          <Card key={l.enrolmentId}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-[17px] font-semibold">{l.course.title}</div>
                <div className="text-sm text-muted">
                  {l.batch.name} · {l.batch.timings}
                </div>
                <div className="text-sm text-muted">
                  {formatDate(l.batch.startDate)} to {formatDate(l.batch.endDate)}
                  {l.batch.faculty.length > 0 && ` · ${l.batch.faculty.join(", ")}`}
                </div>
              </div>
              {l.switchRequest && <Badge tone="warn">Switch requested</Badge>}
            </div>
            {l.lastDecision && !l.switchRequest && l.lastDecision.status === "rejected" && (
              <p className="mt-2 text-sm text-muted">Last switch request was not approved{l.lastDecision.decisionNote ? `: ${l.lastDecision.decisionNote}` : "."}</p>
            )}
            {l.switchRequest ? (
              <ActionForm action={cancelSwitchAction} className="mt-3">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="requestId" value={l.switchRequest.id} />
                <p className="mb-2 text-sm text-muted">Waiting for your Head of Department to approve.</p>
                <SubmitButton size="sm" variant="secondary">
                  Withdraw request
                </SubmitButton>
              </ActionForm>
            ) : (
              options[i] &&
              options[i]!.options.filter((o) => !o.mine).length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand">Switch batch</summary>
                  <div className="mt-3">
                    <p className="mb-3 text-sm text-muted">Your HOD approves the move. It only goes through if the new batch has a free seat.</p>
                    <BatchPicker uni={uni} options={options[i]!.options} mode="switch" enrolmentId={l.enrolmentId} />
                  </div>
                </details>
              )
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
