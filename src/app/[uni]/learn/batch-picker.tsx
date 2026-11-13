"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx } from "@/components/ui";
import type { BatchOption } from "@/server/services/enrolment";
import { enrolAction, requestSwitchAction, type EnrolState } from "./actions";
import { clashLines } from "./clash-lines";

function Go({ label, variant = "primary" }: { label: string; variant?: "primary" | "secondary" }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className={cx(buttonClass(variant), "w-full sm:w-auto")}>
      {pending ? "One moment…" : label}
    </button>
  );
}

const fmtDate = (d: string) => new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${d}T00:00:00Z`));

/**
 * PRD page 5, "What the student sees": every open batch as a card with timings,
 * start date and seats left. Full batches are shown greyed out and can't be picked.
 */
export function BatchPicker({
  uni,
  options,
  mode,
  enrolmentId,
  acceptedBatchId,
  today,
}: {
  uni: string;
  options: BatchOption[];
  mode: "enrol" | "switch";
  enrolmentId?: string;
  /** Faculty accepted the student into this batch (from before acceptance enrolled them at once). */
  acceptedBatchId?: string;
  /** The institute's date (YYYY-MM-DD): a batch that already started says it's running. */
  today: string;
}) {
  const [picked, setPicked] = useState<string>("");
  const [reason, setReason] = useState("");
  const [state, action] = useActionState<EnrolState, FormData>(mode === "enrol" ? enrolAction : requestSwitchAction, null);
  const pickable = mode === "switch" ? options.filter((o) => !o.mine) : options;
  const clashes = state?.clashes && state.batchId === picked ? state.clashes : null;
  const pickedOption = pickable.find((o) => o.batchId === picked);
  const needsApproval = mode === "enrol" && !!pickedOption?.approvalRequired && picked !== acceptedBatchId;
  const goLabel =
    mode === "switch"
      ? "Request switch"
      : needsApproval
        ? "Ask to join this batch"
        : "Join this batch";

  return (
    <form action={action}>
      <input type="hidden" name="uni" value={uni} />
      {/* React resets native form fields after each action, so the choice travels in state, not in the radios. */}
      <input type="hidden" name="batchId" value={picked} />
      {enrolmentId && <input type="hidden" name="enrolmentId" value={enrolmentId} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pickable.map((o) => {
          const disabled = o.full && o.batchId !== acceptedBatchId;
          const selected = picked === o.batchId;
          return (
            <label
              key={o.batchId}
              className={cx(
                "relative block rounded-[20px] border bg-surface p-4 transition",
                disabled ? "cursor-not-allowed border-line opacity-55" : "cursor-pointer hover:border-brand/50",
                selected ? "border-brand ring-4 ring-gold-soft" : "border-line",
              )}
            >
              <input
                type="radio"
                name="batchChoice"
                value={o.batchId}
                disabled={disabled}
                checked={selected}
                onChange={() => setPicked(o.batchId)}
                className="sr-only"
              />
              <div className="font-medium">{o.name}</div>
              <div className="mt-1 text-sm text-muted">{o.timings}</div>
              <div className="text-sm text-muted">
                {o.startDate <= today ? `Started ${fmtDate(o.startDate)}, running now` : `Starts ${fmtDate(o.startDate)}`}
              </div>
              <div className={cx("mt-3 text-sm font-medium", disabled ? "text-muted" : "text-brand")}>
                {disabled ? "Full" : `${o.seatsLeft} seat${o.seatsLeft === 1 ? "" : "s"} left`}
              </div>
              {o.faculty.length > 0 && <div className="mt-1 truncate text-xs text-faint">with {o.faculty.join(", ")}</div>}
              {o.batchId === acceptedBatchId && (
                <div className="mt-2 rounded-lg bg-brand-soft px-2 py-1 text-xs text-brand-strong">You&apos;re accepted. Pick it to join.</div>
              )}
              {mode === "enrol" && o.approvalRequired && o.batchId !== acceptedBatchId && !o.mine && (
                <div className="mt-2 text-xs text-muted">Faculty accept each student</div>
              )}
              {o.clashes.length > 0 && !disabled && (
                <div className="mt-2 rounded-lg bg-warn-soft px-2 py-1 text-xs text-warn">
                  Clashes with {clashLines(o.clashes).join("; ")}
                </div>
              )}
            </label>
          );
        })}
      </div>
      {pickable.length === 0 && <p className="text-muted">No other open batches right now.</p>}

      {mode === "switch" && picked && (
        <input
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why do you want to switch? (optional)"
          className="mt-4 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm"
        />
      )}

      {clashes ? (
        <div className="mt-5 rounded-2xl bg-warn-soft p-4 text-sm text-warn">
          <div className="font-semibold">This batch clashes with your timetable</div>
          <ul className="mt-1 list-disc pl-5">
            {clashLines(clashes).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="acknowledge" value="1" />
            <Go label={mode === "enrol" ? (needsApproval ? "Ask anyway" : "Enrol anyway") : "Request anyway"} />
            <button type="button" onClick={() => setPicked("")} className={buttonClass("secondary")}>
              Pick another batch
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {picked && <Go label={goLabel} />}
          {!picked && <span className="text-sm text-muted">Pick the batch that fits your schedule.</span>}
        </div>
      )}
      {state?.error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
    </form>
  );
}
