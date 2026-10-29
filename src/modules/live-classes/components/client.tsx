"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, type ButtonVariant } from "@/components/ui";

/** Reloads the page at a moment (for "join opens at 8:45 am"), so the student needn't refresh. */
export function ReloadAt({ at }: { at: string }) {
  useEffect(() => {
    const ms = new Date(at).getTime() - Date.now();
    if (ms <= 0 || ms > 6 * 3600_000) return;
    const t = setTimeout(() => window.location.reload(), ms + 1500);
    return () => clearTimeout(t);
  }, [at]);
  return null;
}

/** Refreshes server data now and then, so "on now" and present counts stay current on a page left open. */
export function RefreshEvery({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/**
 * "Start class": a POST form that opens the meeting in a new tab (the server records the
 * start time first), then refreshes this page so it shows the class as started.
 */
export function StartClassButton({ action, startTime, size = "sm", variant = "primary", children }: { action: string; startTime: string; size?: "sm" | "md"; variant?: ButtonVariant; children?: ReactNode }) {
  const router = useRouter();
  return (
    <form method="post" action={action} target="_blank" onSubmit={() => setTimeout(() => router.refresh(), 1500)}>
      <input type="hidden" name="start" value={startTime} />
      <button type="submit" className={buttonClass(variant, size)}>
        {children ?? "Start class"}
      </button>
    </form>
  );
}
