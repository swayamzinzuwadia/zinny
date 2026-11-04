"use client";

import { useSearchParams } from "next/navigation";

/**
 * "Grade saved for Zoya Khan.", shown after a save. Saving moves the grading view on to the
 * next student (or to "all graded"), so the action redirects with ?saved=<student id>.
 */
export function SavedNotice({ names }: { names: Record<string, string> }) {
  // Null outside the app router (tests render this on its own).
  const id = useSearchParams()?.get("saved");
  const name = id ? names[id] : undefined;
  if (!name) return null;
  return (
    <p role="status" className="rounded-2xl bg-brand-soft px-4 py-3 text-[14px] text-brand-strong">
      Grade saved for {name}. The student has been told.
    </p>
  );
}
