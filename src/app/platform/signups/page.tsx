import { ActionForm, SubmitButton } from "@/components/forms";
import { ActionAnchor, Badge, ButtonLabel, Card, Empty, Input, PageHeader, Textarea } from "@/components/ui";
import { canPlatform } from "@/server/core";
import { platformContext } from "@/server/context";
import { formatDate } from "@/server/lib/dates";
import { NoAccess } from "@/modules/zinny-team-panel/components/bits";
import { DOCUMENT_LABEL, INSTITUTE_TYPE_LABEL, STATE_NAME, formatBytes } from "@/modules/onboarding/lib/constants";
import { listSignups, type SignupRow } from "@/modules/onboarding/services/review";
import { extendTrialAction, reviewDocumentAction } from "./actions";

export const metadata = { title: "Self sign-ups" };

const DOC_STATUS = {
  uploading: { tone: "neutral", label: "Uploading" },
  pending: { tone: "gold", label: "To review" },
  approved: { tone: "brand", label: "Approved" },
  rejected: { tone: "danger", label: "Rejected" },
} as const;

function trialText(r: SignupRow) {
  if (r.paidPlan) return `Paid: ${r.paidPlan}`;
  if (!r.trialEndsAt) return "No trial";
  if (r.status === "frozen") return `Trial ended ${formatDate(r.trialEndsAt, { year: false })}`;
  if (r.daysLeft !== null && r.daysLeft <= 0) return "Trial ends today";
  return `Trial ends ${formatDate(r.trialEndsAt, { year: false })} (${r.daysLeft} ${r.daysLeft === 1 ? "day" : "days"} left)`;
}

/**
 * Institutes that signed themselves up: their trial, status and documents. The Zinny team
 * approves or rejects each document with a note, and can extend a trial (platform.manage_universities).
 */
export default async function SignupsPage() {
  const actor = await platformContext();
  if (!canPlatform(actor, "platform.manage_universities")) return <NoAccess section="Self sign-ups" />;
  const rows = await listSignups(actor);
  const toReview = rows.reduce((n, r) => n + r.documents.filter((d) => d.status === "pending").length, 0);

  return (
    <>
      <PageHeader
        title="Self sign-ups"
        subtitle={`Institutes that signed themselves up for a free trial. ${toReview ? `${toReview} ${toReview === 1 ? "document is" : "documents are"} waiting for review.` : "Every document has been reviewed."}`}
      />
      {rows.length === 0 ? (
        <Empty title="No self sign-ups yet">Institutes that sign up from the website show here with their documents.</Empty>
      ) : (
        <ul className="space-y-5">
          {rows.map((r) => (
            <li key={r.universityId}>
              <Card className="p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[18px] font-semibold">{r.name}</h2>
                      <Badge tone={r.status === "frozen" ? "danger" : r.status === "suspended" ? "warn" : "brand"}>
                        {r.status === "frozen" ? "Frozen" : r.status === "suspended" ? "Suspended" : "Active"}
                      </Badge>
                      <Badge tone={r.status === "frozen" || (r.daysLeft !== null && r.daysLeft <= 1 && !r.paidPlan) ? "gold" : "neutral"}>{trialText(r)}</Badge>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">
                      {r.legalName ?? r.name} · {INSTITUTE_TYPE_LABEL[r.signup.instituteType] ?? r.signup.instituteType} · {r.signup.city}, {STATE_NAME[r.stateCode] ?? r.stateCode} · /{r.slug}
                    </p>
                    <p className="mt-1 text-[13px] text-muted">
                      {r.signup.contactName} · {r.signup.contactEmail} · {r.signup.contactPhone} · {r.gstEnabled ? `GST ${r.gstin}` : "No GST"} · signed up{" "}
                      {r.signup.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
                    </p>
                  </div>
                  {r.trialEndsAt && !r.paidPlan && r.status !== "suspended" && (
                    <ActionForm action={extendTrialAction} className="flex items-end gap-2">
                      <input type="hidden" name="universityId" value={r.universityId} />
                      <label className="block">
                        <span className="mb-1 block text-[12px] text-muted">Days</span>
                        <Input name="days" type="number" min={1} max={60} defaultValue={3} className="w-20" />
                      </label>
                      <SubmitButton variant="secondary" size="sm" icon="resend">
                        Extend trial
                      </SubmitButton>
                    </ActionForm>
                  )}
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  {r.documents.length === 0 ? (
                    <p className="text-[14px] text-muted">No documents uploaded yet.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {r.documents.map((d) => {
                        const st = DOC_STATUS[d.status];
                        return (
                          <li key={d.id} className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[14px] font-medium">{DOCUMENT_LABEL[d.kind]}</span>
                                <Badge tone={st.tone}>{st.label}</Badge>
                              </div>
                              <div className="mt-0.5 truncate text-[13px] text-muted" title={d.fileName}>
                                {d.fileName} · {formatBytes(d.sizeBytes)}
                              </div>
                              {d.reviewerNote && <p className="mt-1 text-[13px] text-muted">Note: {d.reviewerNote}</p>}
                              <ActionAnchor href={`/platform/signups/${r.universityId}/documents/${d.id}`} target="_blank" rel="noopener" className="-ml-2.5 mt-1">
                                Open file
                              </ActionAnchor>
                            </div>
                            <ActionForm action={reviewDocumentAction} resetOnSuccess className="min-w-0">
                              <input type="hidden" name="universityId" value={r.universityId} />
                              <input type="hidden" name="documentId" value={d.id} />
                              <Textarea name="note" rows={2} maxLength={500} placeholder="Note for the institute. Needed to reject: say what to upload instead." className="min-h-16" />
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button type="submit" name="decision" value="approved" className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand px-3.5 text-[13px] font-medium text-canvas hover:bg-brand-strong">
                                  <ButtonLabel>Approve</ButtonLabel>
                                </button>
                                <button type="submit" name="decision" value="rejected" className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[13px] font-medium text-danger hover:bg-danger-soft">
                                  <ButtonLabel>Reject</ButtonLabel>
                                </button>
                              </div>
                            </ActionForm>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
