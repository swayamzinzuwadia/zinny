"use client";

import { useActionState, useEffect } from "react";
import { SubmitButton } from "@/components/forms";
import { viewAsAction } from "../actions";

/**
 * Opens the learner app as this person, read only. Super Admins only. It goes there with a
 * normal page load, because a redirect from the action would render the learner app inside
 * the action request, and the app refuses actions while viewing.
 */
export function ViewAsButton({ universityId, userId, label }: { universityId: string; userId: string; label: string }) {
  const [state, formAction] = useActionState(viewAsAction, null);
  useEffect(() => {
    if (state?.ok) window.location.assign(state.ok);
  }, [state]);
  return (
    <form action={formAction} className="inline-block">
      <input type="hidden" name="universityId" value={universityId} />
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton size="sm" variant="secondary" pendingText="Opening…">
        {label}
      </SubmitButton>
      {state?.error && <p className="mt-1 text-[12.5px] text-danger">{state.error}</p>}
    </form>
  );
}
