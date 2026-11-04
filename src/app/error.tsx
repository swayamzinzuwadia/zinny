"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass, Logo } from "@/components/ui";
import { display } from "@/modules/marketing/fonts";

/** A page that failed while loading, anywhere without an error page of its own: on brand, with a retry. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={`display-headings flex min-h-dvh flex-col bg-canvas px-5 py-8 text-ink sm:px-10 ${display.variable}`}>
      <Link href="/" aria-label="Zinny home" className="inline-flex w-fit rounded-lg">
        <Logo height={30} />
      </Link>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center py-16">
        <h1 className="text-[clamp(2.2rem,5vw,3.4rem)] leading-[1.05] tracking-[-0.02em]">This page didn&apos;t load</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-ink/75">
          Something went wrong on our side, and nothing you did caused it. Try again, and if it keeps happening, come back in a few minutes.
        </p>
        {error.digest && <p className="mt-3 text-[13px] text-muted">Reference: {error.digest}</p>}
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className={buttonClass("primary")}>
            Try again
          </button>
          <Link href="/" className={buttonClass("secondary")}>
            Go to the home page
          </Link>
        </div>
      </div>
    </main>
  );
}
