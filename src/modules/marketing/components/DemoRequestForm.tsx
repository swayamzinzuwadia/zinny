"use client";

import Link from "next/link";
import { useActionState, useId, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx, inputClass } from "@/components/ui";

/** What the action answers: a thank-you, or an error with what was typed so nothing is lost. */
export type DemoRequestState = { ok?: string; error?: string; values?: Record<string, string>; at?: number } | null;

const field = cx(inputClass, "h-11 text-[16px] sm:text-[15px]");

function Label({ htmlFor, children, optional }: { htmlFor: string; children: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] font-medium">
      {children}
      {optional && <span className="text-[12px] font-normal text-muted">Optional</span>}
    </label>
  );
}

function Send() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass("primary"), "h-11 w-full text-[15px] sm:w-auto sm:px-7")}>
      {pending ? "Sending…" : "Send request"}
    </button>
  );
}

/**
 * The "Book a demo" form. React clears a form after its action runs, so on an error the
 * values come back in the state and the fields are drawn again with them.
 */
export function DemoRequestForm({ action }: { action: (prev: DemoRequestState, data: FormData) => Promise<DemoRequestState> }) {
  const [state, formAction] = useActionState(action, null);
  const id = useId();
  const v = state?.values ?? {};

  if (state?.ok) {
    return (
      <div role="status" className="space-y-4">
        <h2 className="text-[26px] leading-tight font-semibold">We have your request</h2>
        <p className="text-[15px] leading-relaxed text-ink/80">{state.ok}</p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link href="/" className={buttonClass("secondary")}>
            Back to the home page
          </Link>
          <Link href="/marketplace" className={buttonClass("ghost")}>
            Browse the marketplace
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form key={state?.at ?? 0} action={formAction} className="relative space-y-4">
      {/* Bots fill in every field; people never see this one. */}
      <div aria-hidden className="absolute top-auto -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Leave this field empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-name`}>Your name</Label>
          <input id={`${id}-name`} name="name" required minLength={2} maxLength={80} autoComplete="name" defaultValue={v.name} className={field} />
        </div>
        <div>
          <Label htmlFor={`${id}-role`} optional>
            Your role
          </Label>
          <input id={`${id}-role`} name="role" maxLength={80} autoComplete="organization-title" placeholder="Owner, director, principal" defaultValue={v.role} className={field} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-institute`}>Institute</Label>
          <input id={`${id}-institute`} name="institute" required minLength={2} maxLength={120} autoComplete="organization" defaultValue={v.institute} className={field} />
        </div>
        <div>
          <Label htmlFor={`${id}-city`} optional>
            City
          </Label>
          <input id={`${id}-city`} name="city" maxLength={80} autoComplete="address-level2" defaultValue={v.city} className={field} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${id}-phone`}>Phone</Label>
          <input id={`${id}-phone`} name="phone" type="tel" inputMode="tel" required maxLength={20} autoComplete="tel" defaultValue={v.phone} className={field} />
        </div>
        <div>
          <Label htmlFor={`${id}-email`}>Email</Label>
          <input id={`${id}-email`} name="email" type="email" required maxLength={200} autoComplete="email" autoCapitalize="none" spellCheck={false} defaultValue={v.email} className={field} />
        </div>
      </div>
      <div>
        <Label htmlFor={`${id}-message`} optional>
          Anything we should know
        </Label>
        <textarea
          id={`${id}-message`}
          name="message"
          rows={4}
          maxLength={2000}
          placeholder="How many students you teach, what you use today, what you'd like to see"
          defaultValue={v.message}
          className={cx(inputClass, "h-auto py-2.5 text-[16px] leading-relaxed sm:text-[15px]")}
        />
      </div>
      {state?.error && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-[14px] text-danger">
          {state.error}
        </p>
      )}
      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:gap-4">
        <Send />
        <p className="text-[13px] text-muted">We only use your details to set up the demo.</p>
      </div>
    </form>
  );
}
