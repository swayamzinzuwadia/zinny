"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { buttonClass } from "@/components/ui";

/** Catches a page in the learner app that failed to load, so it never ends on a blank screen. */
export default function LearnError({ reset }: { reset: () => void }) {
  const { uni } = useParams<{ uni: string }>();
  return (
    <div className="mx-auto max-w-md rounded-[22px] border border-line bg-surface p-8 text-center">
      <p className="font-medium">This page didn&apos;t load</p>
      <p className="mt-1 text-[14px] text-muted">Something went wrong on our side. Try loading it again, or go back to Today.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href={`/${uni}/learn`} className={buttonClass("secondary")}>
          Go to Today
        </Link>
      </div>
    </div>
  );
}
