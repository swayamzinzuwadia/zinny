"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState, FormAction } from "@/components/forms";
import { cx } from "@/components/ui";

const field =
  "h-12 w-full rounded-2xl border border-[var(--site-line)] bg-surface px-4 text-[16px] outline-none transition placeholder:text-faint focus:border-[var(--site-primary)] focus:ring-4 focus:ring-[var(--site-soft)]";

function Label({ children, hint, htmlFor }: { children: ReactNode; hint?: string; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 flex items-baseline justify-between gap-3 text-[14px] font-medium">
      {children}
      {hint && <span className="text-[12px] font-normal text-muted">{hint}</span>}
    </label>
  );
}

function Send({ children, pending: pendingText }: { children: ReactNode; pending: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--site-primary)] px-7 text-[15px] font-medium text-[var(--site-on-primary)] transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? pendingText : children}
    </button>
  );
}

/** Bots fill in every field; people never see this one. Filled in → nothing is saved. */
function Honeypot() {
  return (
    <div aria-hidden className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
      <label>
        Leave this field empty
        <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </label>
    </div>
  );
}

function useResetOnSuccess(state: ActionState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

function Result({ state }: { state: ActionState }) {
  if (state?.error)
    return (
      <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-[14px] text-danger">
        {state.error}
      </p>
    );
  if (state?.ok)
    return (
      <p role="status" className="rounded-2xl bg-[var(--site-soft)] px-4 py-3 text-[14px] text-ink">
        {state.ok}
      </p>
    );
  return null;
}

export function EnquiryForm({
  uni,
  action,
  courses,
  courseId,
  source,
}: {
  uni: string;
  action: FormAction;
  courses: { id: string; title: string }[];
  courseId?: string;
  source: "home" | "course";
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useResetOnSuccess(state);
  const id = (k: string) => `enq-${source}-${k}`;
  return (
    <form ref={ref} action={formAction} className="relative space-y-4" noValidate={false}>
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="source" value={source} />
      <Honeypot />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={id("name")}>Your name</Label>
          <input id={id("name")} name="name" required minLength={2} maxLength={80} autoComplete="name" className={field} />
        </div>
        <div>
          <Label htmlFor={id("phone")} hint="Optional">
            Phone
          </Label>
          <input id={id("phone")} name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} className={field} />
        </div>
      </div>
      <div>
        <Label htmlFor={id("email")}>Email</Label>
        <input id={id("email")} name="email" type="email" required autoComplete="email" maxLength={200} className={field} />
      </div>
      {courses.length > 0 && (
        <div>
          <Label htmlFor={id("course")}>Course</Label>
          <select id={id("course")} name="courseId" defaultValue={courseId ?? ""} className={cx(field, "pr-10")}>
            <option value="">Not sure yet</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <Label htmlFor={id("message")} hint="Optional">
          Your question
        </Label>
        <textarea id={id("message")} name="message" rows={4} maxLength={2000} className={cx(field, "h-auto py-3 leading-relaxed")} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Send pending="Sending…">Send enquiry</Send>
        <span className="text-[13px] text-muted">We only use your details to reply.</span>
      </div>
      <Result state={state} />
    </form>
  );
}

export function ReviewForm({ uni, action, courses }: { uni: string; action: FormAction; courses: { id: string; title: string }[] }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useResetOnSuccess(state);
  const [rating, setRating] = useState(0);
  useEffect(() => {
    if (state?.ok) setRating(0);
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="relative space-y-4">
      <input type="hidden" name="uni" value={uni} />
      <Honeypot />
      <fieldset>
        <legend className="mb-1.5 text-[14px] font-medium">Your rating</legend>
        <div className="flex gap-1" role="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="rating" value={n} required checked={rating === n} onChange={() => setRating(n)} className="peer sr-only" />
              <span className="sr-only">{n === 1 ? "1 star" : `${n} stars`}</span>
              <svg width="32" height="32" viewBox="0 0 20 20" aria-hidden className="rounded-md peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gold">
                <path
                  d="M10 1.6l2.5 5.3 5.8.7-4.3 4 1.1 5.8L10 14.6l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z"
                  fill={n <= rating ? "var(--site-primary)" : "var(--site-line)"}
                />
              </svg>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="rev-name">Your name</Label>
          <input id="rev-name" name="name" required minLength={2} maxLength={80} autoComplete="name" className={field} />
        </div>
        <div>
          <Label htmlFor="rev-email" hint="Not shown">
            Email
          </Label>
          <input id="rev-email" name="email" type="email" required autoComplete="email" maxLength={200} className={field} />
        </div>
      </div>
      {courses.length > 0 && (
        <div>
          <Label htmlFor="rev-course" hint="Optional">
            Course you took
          </Label>
          <select id="rev-course" name="courseId" defaultValue="" className={cx(field, "pr-10")}>
            <option value="">None or not listed</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <Label htmlFor="rev-body" hint="At least 20 characters">
          Your review
        </Label>
        <textarea id="rev-body" name="body" rows={4} required minLength={20} maxLength={1500} className={cx(field, "h-auto py-3 leading-relaxed")} />
      </div>
      <Send pending="Sending…">Send review</Send>
      <Result state={state} />
    </form>
  );
}
