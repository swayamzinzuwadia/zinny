"use client";

/** Catches a failed page or action in the learner app, so it never ends on a blank screen. */
export default function LearnError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-[22px] border border-line bg-surface p-8 text-center">
      <p className="font-medium">That didn&apos;t work</p>
      <p className="mt-1 text-[14px] text-muted">Nothing was changed. Go back and try again.</p>
      <button onClick={reset} className="mt-4 rounded-full bg-brand px-5 py-2 text-[14px] font-medium text-canvas hover:bg-brand-strong">
        Try again
      </button>
    </div>
  );
}
