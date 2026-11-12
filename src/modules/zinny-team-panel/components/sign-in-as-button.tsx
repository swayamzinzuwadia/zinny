"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/forms";
import { signInAsAction } from "../actions";

/**
 * Signs the Super Admin in as this person, with everything that person can do. Different
 * from "View as, read only", which only looks. The action redirects to where the
 * person would land.
 */
export function SignInAsButton({ userId, name, universityId, variant = "secondary" }: { userId: string; name: string; universityId?: string | null; variant?: "secondary" | "primary" }) {
  const [state, formAction] = useActionState(signInAsAction, null);
  return (
    <form
      action={formAction}
      className="inline-block"
      onSubmit={(e) => {
        if (!window.confirm(`Sign in as ${name}? You can do anything they can. Everything is recorded as them, with your name alongside.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      {universityId && <input type="hidden" name="universityId" value={universityId} />}
      <SubmitButton size="sm" variant={variant} pendingText="Signing in…">
        Sign in as
      </SubmitButton>
      {state?.error && <p className="mt-1 max-w-[260px] text-[12.5px] text-danger">{state.error}</p>}
    </form>
  );
}
