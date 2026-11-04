"use client";

import { usePathname } from "next/navigation";
import { buttonClass, ButtonLink, PageHeader } from "@/components/ui";

/** Catches a page that failed to load in the admin panel, so it never ends on a blank screen. */
export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const uni = usePathname()?.split("/")[1] ?? "";
  return (
    <>
      <PageHeader title="This page didn't load" subtitle="Nothing was changed. Try again, and if it keeps happening, start again from the dashboard." />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reset} className={buttonClass("primary")}>
          Try again
        </button>
        <ButtonLink href={`/${uni}/admin`} variant="secondary">
          Go to the dashboard
        </ButtonLink>
      </div>
    </>
  );
}
