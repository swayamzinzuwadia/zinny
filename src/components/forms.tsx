"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx, type ButtonVariant } from "./ui";

export type ActionState = { ok?: string; error?: string; at?: number } | null;
export type FormAction = (prev: ActionState, data: FormData) => Promise<ActionState>;

export function SubmitButton({ children, variant = "primary", size = "md", pendingText }: { children: ReactNode; variant?: ButtonVariant; size?: "md" | "sm"; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass(variant, size)}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

/** A form wired to a server action, showing its success or error message inline. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = true,
  confirm,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state?.error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className={cx("mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong")}>{state.ok}</p>}
    </form>
  );
}
