"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";

/**
 * A Join button that waits for the window: disabled with "Join opens at 8:45 am" until
 * then, and a real link after. The student still clicks it, so attendance records when
 * they actually join, not when a page left open happened to refresh.
 */
export function JoinWhenOpen({ href, opensAt, label }: { href: string; opensAt: string; label: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ms = new Date(opensAt).getTime() - Date.now();
    if (ms <= 0) {
      setOpen(true);
      return;
    }
    if (ms > 12 * 3600_000) return;
    const t = setTimeout(() => setOpen(true), ms + 500);
    return () => clearTimeout(t);
  }, [opensAt]);
  if (open) {
    return (
      <a href={href} className={buttonClass("gold")}>
        Join class
      </a>
    );
  }
  return (
    <button type="button" disabled className={buttonClass("gold")}>
      {label}
    </button>
  );
}
