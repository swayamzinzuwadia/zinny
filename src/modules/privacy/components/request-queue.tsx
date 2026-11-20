import { ActionForm, SubmitButton, type FormAction } from "@/components/forms";
import { Avatar, Badge, Card, Empty, Textarea } from "@/components/ui";
import { REQUEST_LABEL, daysLeft } from "../lib/rules";
import type { HandledRequest } from "../services/requests";
import { Disclosure } from "./motion";

const day = (d: Date | string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(typeof d === "string" ? new Date(`${d}T00:00:00+05:30`) : d);

const STATUS = {
  open: { tone: "neutral", label: "New" },
  in_progress: { tone: "neutral", label: "In progress" },
  completed: { tone: "brand", label: "Done" },
  refused: { tone: "danger", label: "Refused" },
} as const;

function Due({ dueOn, today }: { dueOn: string; today: string }) {
  const left = daysLeft(dueOn, today);
  if (left < 0) return <Badge tone="danger">{-left} {-left === 1 ? "day" : "days"} late</Badge>;
  if (left <= 3) return <Badge tone="gold">Due {left === 0 ? "today" : `in ${left} ${left === 1 ? "day" : "days"}`}</Badge>;
  return <span className="text-[12px] text-muted">Due {day(dueOn)}</span>;
}

/**
 * The request queue, open requests first by due date. `decide` answers a request; rows it
 * can't answer (an institute's, seen from the Zinny panel) say who answers them.
 */
export function RequestQueue({
  rows,
  today,
  decide,
  canDecide,
  showInstitute = false,
}: {
  rows: HandledRequest[];
  today: string;
  decide: FormAction;
  canDecide: (r: HandledRequest) => boolean;
  showInstitute?: boolean;
}) {
  if (rows.length === 0) return <Empty title="No requests yet">When someone asks to correct or erase their data, names a nominee or complains, it shows here with its due date.</Empty>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const open = r.status === "open" || r.status === "in_progress";
        return (
          <li key={r.id}>
            <Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Avatar name={r.person?.name ?? "?"} size={36} />
                  <div className="min-w-0">
                    <p className="font-medium">
                      {REQUEST_LABEL[r.kind]} <span className="font-normal text-muted">from {r.person?.name ?? "someone"}</span>
                    </p>
                    <p className="text-[13px] text-muted">
                      {r.person?.email}
                      {showInstitute && <> · {r.institute ?? "Zinny (marketplace or sign-up)"}</>}
                      {" · "}sent {day(r.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  {open ? <Due dueOn={r.dueOn} today={today} /> : r.closedAt && <span className="text-[12px] text-muted">Closed {day(r.closedAt)}</span>}
                </div>
              </div>
              {r.details && <p className="mt-3 text-[14px]">{r.details}</p>}
              {r.kind === "nomination" && r.data.nomineeName && (
                <p className="mt-2 rounded-xl bg-canvas px-3 py-2 text-[13px]">
                  Nominee: <span className="font-medium">{r.data.nomineeName}</span>
                  {r.data.nomineeRelation && <> ({r.data.nomineeRelation})</>}, {r.data.nomineeContact}
                </p>
              )}
              {r.response && <p className="mt-2 rounded-xl bg-brand-soft/50 px-3 py-2 text-[13px]">{r.response}</p>}
              {open && canDecide(r) && (
                <div className="mt-3">
                  <Disclosure label="Answer request" icon="send" size="sm" variant="secondary">
                    <ActionForm action={decide} className="space-y-3 rounded-2xl border border-line bg-canvas p-4">
                      <input type="hidden" name="requestId" value={r.id} />
                      <fieldset className="flex flex-wrap gap-2 text-[14px]">
                        <legend className="mb-1.5 text-[13px] font-medium">Outcome</legend>
                        {[
                          { v: "in_progress", t: "Working on it" },
                          { v: "completed", t: r.kind === "erasure" ? "Erase now" : "Done" },
                          { v: "refused", t: "Refuse" },
                        ].map((o, i) => (
                          <label key={o.v} className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5">
                            <input type="radio" name="status" value={o.v} defaultChecked={i === 1} className="accent-[var(--color-brand)]" />
                            {o.t}
                          </label>
                        ))}
                      </fieldset>
                      {r.kind === "erasure" && (
                        <p className="text-[13px] text-muted">
                          Erasing removes their name, email, mobile and password (unless they still belong to another institute), deletes their KYC, withdraws their consents and ends
                          their roles here. Invoices and the consent log stay, as the law requires; the reply says so.
                        </p>
                      )}
                      <label className="block text-[13px] font-medium">
                        Reply to {r.person?.name.split(" ")[0] ?? "them"}
                        <Textarea name="response" rows={2} className="mt-1.5" placeholder={r.kind === "erasure" ? "Optional: we add what was erased and what was kept." : "What you did, or why you can't."} />
                      </label>
                      <SubmitButton size="sm" icon="send">
                        Send answer
                      </SubmitButton>
                    </ActionForm>
                  </Disclosure>
                </div>
              )}
              {open && !canDecide(r) && <p className="mt-3 text-[13px] text-muted">The institute answers this one from its own privacy settings.</p>}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
