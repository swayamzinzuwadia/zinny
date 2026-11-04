"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui";

/** Catches a panel page that failed to load, so it never ends on a blank screen. The menu stays. */
export default function PlatformError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-[22px] border border-line bg-surface p-8 text-center">
      <p className="font-medium">This page didn&apos;t load</p>
      <p className="mt-1 text-[14px] text-muted">Something went wrong on our side. Try loading it again, or go back to the Zinny team home.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href="/platform" className={buttonClass("secondary")}>
          Go to the Zinny team home
        </Link>
      </div>
    </div>
  );
}
