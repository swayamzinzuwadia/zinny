"use client";

import { useActionState } from "react";
import { returnToPanelAction } from "../actions";

/** Ends "sign in as"; the action redirects into the Super Admin's own session. */
export function ReturnToPanel() {
  const [state, formAction, pending] = useActionState(returnToPanelAction, null);
  return (
    <form action={formAction} className="inline">
      <button disabled={pending} className="rounded-full bg-brand-deep px-4 py-1.5 text-[13px] font-medium whitespace-nowrap text-canvas hover:bg-brand disabled:opacity-60">
        {pending ? "Returning…" : "Return to the Zinny panel"}
      </button>
      {state?.error && <span className="ml-2 text-[12.5px]">{state.error}</span>}
    </form>
  );
}
