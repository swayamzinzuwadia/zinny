"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { decideSwitchAction } from "@/app/[uni]/admin/actions";
import type { ActionState } from "./forms";
import { Avatar, buttonClass, Card, CardTitle, Empty } from "./ui";

type Req = {
  id: string;
  student: string;
  course: string;
  fromBatchName: string;
  toBatchName: string;
  toSeatsLeft: number;
  reason: string | null;
};

function Choice({ value, children, variant }: { value: string; children: React.ReactNode; variant: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <button name="choice" value={value} disabled={pending} className={buttonClass(variant, "sm")}>
      {children}
    </button>
  );
}

/**
 * HOD approvals for batch switches (PRD page 5). One form for the whole list, so the
 * result message stays on screen after the decided request leaves the list.
 */
export function SwitchRequests({ uni, requests, bare = false }: { uni: string; requests: Req[]; bare?: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(decideSwitchAction, null);
  const body = (
    <>
      {state?.ok && <p className="mb-3 rounded-2xl bg-brand-soft px-4 py-2.5 text-[14px] text-brand-strong">{state.ok}</p>}
      {state?.error && <p className="mb-3 rounded-2xl bg-danger-soft px-4 py-2.5 text-[14px] text-danger">{state.error}</p>}
      {requests.length === 0 && !bare ? (
        <Empty title="Nothing to approve">Batch switch requests from students appear here.</Empty>
      ) : (
        <form action={action}>
          <input type="hidden" name="uni" value={uni} />
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="rounded-2xl bg-canvas p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <Avatar name={r.student} />
                    <div className="min-w-0">
                      <div className="font-medium">{r.student} wants to switch batch</div>
                      <div className="text-[14px] text-muted">
                        {r.course}: {r.fromBatchName} to <span className="text-ink">{r.toBatchName}</span>
                        {r.toSeatsLeft > 0 ? `, ${r.toSeatsLeft} seats free` : ", which is full"}
                      </div>
                      {r.reason && <div className="mt-1 text-[14px] text-muted">&ldquo;{r.reason}&rdquo;</div>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Choice value={`approve|${r.id}`} variant="primary">
                      Approve
                    </Choice>
                    <Choice value={`reject|${r.id}`} variant="secondary">
                      Decline
                    </Choice>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </form>
      )}
    </>
  );
  if (bare) return body;
  return (
    <Card>
      <CardTitle hint={requests.length ? `${requests.length} waiting` : undefined}>Batch switch requests</CardTitle>
      {body}
    </Card>
  );
}
