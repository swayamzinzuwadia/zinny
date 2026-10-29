"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx } from "@/components/ui";
import { startTestAction } from "../learner-actions";

function Button({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass("primary"), "h-12 w-full text-[15px] sm:w-auto sm:px-8")}>
      {pending ? "Starting…" : label}
    </button>
  );
}

/** Starts (or resumes) an attempt on the server, then opens it. */
export function StartTest({ uni, testId, label, fullscreen }: { uni: string; testId: string; label: string; fullscreen: boolean }) {
  const [state, action] = useActionState(startTestAction, null);
  return (
    <form
      action={action}
      onSubmit={() => {
        // Ask for full screen while we still have the click (browsers only allow it from a user gesture).
        if (fullscreen && document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
      }}
    >
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="testId" value={testId} />
      <Button label={label} />
      {state?.error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
