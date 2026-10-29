"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState, FormAction } from "@/components/forms";
import { buttonClass, cx, type ButtonVariant } from "@/components/ui";

/**
 * A one-button form for small row actions (move, show/hide, approve). It shows only
 * errors; on success the page refreshes and the row changes.
 */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  size = "sm",
  confirm,
  label,
  className,
}: {
  action: FormAction;
  fields: Record<string, string>;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  confirm?: string;
  /** Accessible name when the visible text is a symbol. */
  label?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  return (
    <form
      action={formAction}
      className={cx("inline-flex flex-col", className)}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" disabled={pending} aria-label={label} title={label} className={buttonClass(variant, size)}>
        {children}
      </button>
      {state?.error && (
        <span role="alert" className="mt-1 max-w-56 text-[12px] leading-snug text-danger">
          {state.error}
        </span>
      )}
    </form>
  );
}
