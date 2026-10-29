"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "@/components/ui";

/** A submit button that sends `intent=<value>`, for forms with two ways to save. */
export function IntentButton({ intent, children, pendingText, variant = "primary" }: { intent: string; children: ReactNode; pendingText: string; variant?: ButtonVariant }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} className={buttonClass(variant)}>
      {mine ? pendingText : children}
    </button>
  );
}
