"use client";

import { useEffect, useState } from "react";

/**
 * Shown while a Super Admin views the learner app as someone. Forms are stopped here so
 * they get a clear note; the server refuses them anyway, so this is only for clarity.
 */
export function ViewAsBar({ name, stop }: { name: string; stop: () => Promise<void> }) {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const onSubmit = (e: SubmitEvent) => {
      if ((e.target as HTMLElement).closest("[data-view-as-exit]")) return;
      e.preventDefault();
      e.stopPropagation();
      setBlocked(true);
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, []);

  useEffect(() => {
    if (!blocked) return;
    const t = setTimeout(() => setBlocked(false), 4000);
    return () => clearTimeout(t);
  }, [blocked]);

  return (
    <div className="sticky top-0 z-40 bg-gold px-4 py-2 text-center text-[13px] text-brand-deep">
      <span>
        {blocked ? (
          <b>Read only: that wasn&apos;t saved.</b>
        ) : (
          <>
            Viewing as <b>{name}</b>. Read only: nothing here can be changed.
          </>
        )}
      </span>
      <form action={stop} data-view-as-exit className="ml-3 inline">
        <button className="font-semibold underline underline-offset-2">Stop viewing</button>
      </form>
    </div>
  );
}
