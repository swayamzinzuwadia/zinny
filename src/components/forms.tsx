"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx, type ButtonVariant } from "./ui";

export type ActionState = { ok?: string; error?: string; at?: number } | null;
export type FormAction = (prev: ActionState, data: FormData) => Promise<ActionState>;
/** An answer that may instead be a timetable clash warning, which the form turns into "Add anyway". */
export type ClashState = (NonNullable<ActionState> & { clash?: string }) | null;
export type ClashFormAction = (prev: ClashState, data: FormData) => Promise<ClashState>;

/**
 * The warning a form shows when adding a student would clash with their other batches.
 * "Add anyway" sends the same form again with `acknowledge=1`; the other button drops it.
 */
export function ClashPrompt({ warning, onCancel, pending }: { warning: string; onCancel: () => void; pending?: boolean }) {
  return (
    <div className="rounded-xl bg-warn-soft p-3 text-sm text-warn" role="alert">
      <div className="font-medium">Timetable clash</div>
      <p className="mt-1">{warning}</p>
      <input type="hidden" name="acknowledge" value="1" />
      <div className="mt-3 flex flex-wrap gap-2">
        {pending === undefined ? (
          <SubmitButton size="sm" pendingText="Adding…">
            Add anyway
          </SubmitButton>
        ) : (
          // A form sent by hand (not through its action) passes its own pending state.
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm")}>
            {pending ? "Adding…" : "Add anyway"}
          </button>
        )}
        <button type="button" className={buttonClass("secondary", "sm")} onClick={onCancel}>
          Don&apos;t add
        </button>
      </div>
    </div>
  );
}

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
