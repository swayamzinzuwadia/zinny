"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { decideSwitchAction } from "@/app/[uni]/admin/actions";
import type { ActionState } from "./forms";
import { Badge, buttonClass, Card, CardTitle, Empty } from "./ui";

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
 * HOD approvals inbox for batch switches (PRD page 5). One form for the whole list,
 * so the result message stays visible after the decided request leaves the list.
 */
export function SwitchRequests({ uni, requests }: { uni: string; requests: Req[] }) {
  const [state, action] = useActionState<ActionState, FormData>(decideSwitchAction, null);
  return (
    <Card>
      <CardTitle hint={requests.length ? `${requests.length} waiting` : undefined}>Batch switch requests</CardTitle>
      {state?.ok && <p className="mb-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
      {state?.error && <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {requests.length === 0 ? (
        <Empty title="Nothing to approve">Requests from students appear here.</Empty>
      ) : (
        <form action={action}>
          <input type="hidden" name="uni" value={uni} />
          <ul className="divide-y divide-line">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="font-medium">{r.student}</div>
                  <div className="text-sm text-muted">
                    {r.course}: {r.fromBatchName} → {r.toBatchName}
                  </div>
                  {r.reason && <div className="mt-0.5 text-sm italic text-muted">&ldquo;{r.reason}&rdquo;</div>}
                </div>
                <div className="flex items-center gap-2">
                  {r.toSeatsLeft > 0 ? <Badge tone="brand">{r.toSeatsLeft} seats free</Badge> : <Badge tone="danger">Full</Badge>}
                  <Choice value={`approve|${r.id}`} variant="primary">
                    Approve
                  </Choice>
                  <Choice value={`reject|${r.id}`} variant="secondary">
                    Decline
                  </Choice>
                </div>
              </li>
            ))}
          </ul>
        </form>
      )}
    </Card>
  );
}
