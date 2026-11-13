"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { ClashPrompt, type ClashFormAction, type ClashState } from "./forms";
import { Select, buttonClass, cx } from "./ui";

const FORM_ID = "bulk-place";

/** The tick box on each student's row, tied to the bar's form. */
export function BulkTick({ userId, name }: { userId: string; name: string }) {
  return <input type="checkbox" name="userId" value={userId} form={FORM_ID} aria-label={`Select ${name}`} className="h-4 w-4 accent-brand" />;
}

function Submit({ count, pending }: { count: number; pending: boolean }) {
  return (
    <button type="submit" disabled={pending || count === 0} className={buttonClass("primary", "sm")}>
      {pending ? "Adding…" : count === 0 ? "Tick students to add" : `Add ${count} student${count === 1 ? "" : "s"} to batch`}
    </button>
  );
}

/**
 * Bulk actions on the Students list: tick students (or all of them), pick a batch, add
 * them in one go. The rows' tick boxes belong to this form through the `form` attribute,
 * so the list's own per-row forms keep working.
 */
export function BulkPlaceBar({ uni, batches, action }: { uni: string; batches: { id: string; label: string; seatsLeft: number }[]; action: ClashFormAction }) {
  const [state, formAction, pending] = useActionState<ClashState, FormData>(action, null);
  const [count, setCount] = useState(0);
  const [clash, setClash] = useState<string | null>(null);
  useEffect(() => setClash(state?.clash ?? null), [state]);
  const boxes = () => [...document.querySelectorAll<HTMLInputElement>(`input[form="${FORM_ID}"][name="userId"]`)];
  useEffect(() => {
    // Changing who is ticked (or the batch) asks again from the start.
    const update = () => {
      setCount(boxes().filter((b) => b.checked).length);
      setClash(null);
    };
    document.addEventListener("change", update);
    update();
    return () => document.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!state?.ok) return;
    boxes().forEach((b) => (b.checked = false));
    setCount(0);
  }, [state]);
  const all = count > 0 && count === boxes().length;
  return (
    <form
      id={FORM_ID}
      // Sent by hand, not through the form's action: React clears a form's fields after an
      // action, and the ticks must survive a clash warning so "Add anyway" adds the same students.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="mb-4 rounded-[22px] border border-line bg-surface p-4">
      <input type="hidden" name="uni" value={uni} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[14px]">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => {
              boxes().forEach((b) => (b.checked = e.target.checked));
              setCount(e.target.checked ? boxes().length : 0);
            }}
            className="h-4 w-4 accent-brand"
          />
          Select all
        </label>
        <span className={cx("text-[13px]", count ? "text-ink" : "text-muted")}>{count} selected</span>
        <div className="min-w-0 flex-1 basis-56">
          <Select name="batchId" aria-label="Batch to add them to" defaultValue={batches[0]?.id} onChange={() => setClash(null)}>
            {batches.map((b) => (
              <option key={b.id} value={b.id} disabled={b.seatsLeft <= 0}>
                {b.label} ({b.seatsLeft <= 0 ? "full" : `${b.seatsLeft} seat${b.seatsLeft === 1 ? "" : "s"} left`})
              </option>
            ))}
          </Select>
        </div>
        {!clash && <Submit count={count} pending={pending} />}
      </div>
      {clash && (
        <div className="mt-3">
          <ClashPrompt warning={clash} onCancel={() => setClash(null)} pending={pending} />
        </div>
      )}
      {state?.error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
    </form>
  );
}
