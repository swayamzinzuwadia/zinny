"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "@/components/ui";

/** A submit button that sends its own name and value (several buttons in one form). */
export function ValueButton({
  name,
  value,
  children,
  variant = "secondary",
  size = "sm",
  pendingText,
}: {
  name: string;
  value: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "md" | "sm";
  pendingText?: string;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get(name) === value;
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={buttonClass(variant, size)}>
      {mine ? (pendingText ?? "Sending…") : children}
    </button>
  );
}
