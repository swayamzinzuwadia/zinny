"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "@/components/ui";

/** Put once in a form that has IntentButtons: carries which button was pressed as `intent`. */
export function IntentField({ initial }: { initial: string }) {
  return <input type="hidden" name="intent" defaultValue={initial} data-intent-field />;
}

/**
 * A submit button for forms with two ways to save. It writes its intent into the form's
 * IntentField before submitting (the submitter's own name/value isn't reliably sent with
 * form actions).
 */
export function IntentButton({ intent, children, pendingText, variant = "primary" }: { intent: string; children: ReactNode; pendingText: string; variant?: ButtonVariant }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant)}
      onClick={(e) => {
        const field = e.currentTarget.form?.querySelector<HTMLInputElement>("input[data-intent-field]");
        if (field) field.value = intent;
      }}
    >
      {mine ? pendingText : children}
    </button>
  );
}
