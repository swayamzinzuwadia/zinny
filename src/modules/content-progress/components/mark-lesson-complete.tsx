"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx } from "@/components/ui";
import { markLessonCompleteAction } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass("primary"), "w-full sm:w-auto")}>
      {pending ? "Saving…" : "Mark complete"}
    </button>
  );
}

/** "Mark complete" for PDF, text, link and live lessons, then a link to the next lesson. */
export function MarkLessonComplete({ uni, lessonId, completed, nextHref }: { uni: string; lessonId: string; completed: boolean; nextHref: string | null }) {
  const [state, action] = useActionState(markLessonCompleteAction, null);
  const done = completed || !!state?.ok;
  return (
    <div className="rounded-[22px] border border-line bg-surface p-4 sm:p-5">
      {done ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-[15px] font-medium text-brand-strong">
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m5.5 10.5 3 3 6-6.5" />
            </svg>
            {state?.ok ?? "You've completed this lesson."}
          </span>
          {nextHref && (
            <Link href={nextHref} className={cx(buttonClass("primary"), "w-full sm:w-auto")}>
              Next lesson
            </Link>
          )}
        </div>
      ) : (
        <form action={action} className="flex flex-wrap items-center justify-between gap-3">
          <input type="hidden" name="uni" value={uni} />
          <input type="hidden" name="lessonId" value={lessonId} />
          <span className="text-[14px] text-muted">Done with this lesson? Mark it complete to count it toward your progress.</span>
          <Submit />
        </form>
      )}
      {state?.error && (
        <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
