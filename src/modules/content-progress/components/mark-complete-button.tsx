"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/ui";
import { markStudentCompleteAction } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("secondary", "sm")}>
      {pending ? "Marking…" : "Mark complete"}
    </button>
  );
}

/** Staff: marks a student's course complete (finished offline). Asks first; can't be undone. */
export function MarkCompleteButton({ uni, batchId, enrolmentId, name, percent }: { uni: string; batchId: string; enrolmentId: string; name: string; percent: number }) {
  const [state, action] = useActionState(markStudentCompleteAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const msg = `Mark ${name}'s course complete? They're at ${percent}% of the required lessons online. This can't be undone.`;
        if (!window.confirm(msg)) e.preventDefault();
      }}
      className="inline-flex flex-col items-end gap-1"
    >
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="enrolmentId" value={enrolmentId} />
      <input type="hidden" name="name" value={name} />
      <Submit />
      {state?.error && <span className="max-w-56 text-right text-[12.5px] text-danger">{state.error}</span>}
    </form>
  );
}
