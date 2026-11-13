"use client";

import { useActionState, useEffect, useState } from "react";
import { SubmitButton } from "@/components/forms";
import { Input, buttonClass } from "@/components/ui";
import { addStudentAction, type AddStudentState } from "./plan-actions";

/**
 * Staff add one of the institute's students to this batch by email (the list suggests the
 * students not yet in the course). When the batch clashes with the student's other batches
 * the form says so and asks once more; it never blocks.
 */
export function AddStudentForm({ uni, batchId, students, full }: { uni: string; batchId: string; students: { name: string; email: string }[]; full: boolean }) {
  const [state, action] = useActionState<AddStudentState, FormData>(addStudentAction, null);
  const [email, setEmail] = useState("");
  const clash = state?.clash && state.clash.email === email.trim().toLowerCase() ? state.clash : null;

  useEffect(() => {
    if (state?.ok) setEmail("");
  }, [state]);

  if (full) {
    // Adding the last student fills the batch: still say they were added.
    return (
      <div className="space-y-3">
        {state?.ok && <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
        <p className="text-sm text-muted">The batch is full. Add seats under Seats to add more students.</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="batchId" value={batchId} />
      {clash && <input type="hidden" name="acknowledge" value={clash.email} />}
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium">Student&apos;s email</span>
        <Input
          name="email"
          type="email"
          list={`students-${batchId}`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Start typing a name or email"
          autoComplete="off"
          required
        />
        <datalist id={`students-${batchId}`}>
          {students.map((s) => (
            <option key={s.email} value={s.email}>
              {s.name}
            </option>
          ))}
        </datalist>
      </label>
      {clash ? (
        <div className="rounded-2xl bg-warn-soft p-3 text-sm text-warn" role="alert">
          <div className="font-semibold">Timetable clash</div>
          <p className="mt-1">{clash.warning}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <SubmitButton size="sm" pendingText="Adding…">
              Add anyway
            </SubmitButton>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setEmail("")}>
              Don&apos;t add
            </button>
          </div>
        </div>
      ) : (
        <SubmitButton variant="secondary" pendingText="Adding…">
          Add to batch
        </SubmitButton>
      )}
      {state?.error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
    </form>
  );
}
