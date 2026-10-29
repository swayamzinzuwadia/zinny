"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";

/**
 * Copies the public verify link of a certificate. On phones that can share, it opens the
 * share sheet instead (for LinkedIn, WhatsApp, email…), falling back to copying.
 */
export function ShareLink({ path, title, size = "sm", variant = "secondary" }: { path: string; title: string; size?: "sm" | "md"; variant?: "secondary" | "ghost" }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    setSheet(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches);
  }, []);
  const url = () => new URL(path, window.location.origin).toString();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2500);
  }

  async function share() {
    if (sheet) {
      try {
        await navigator.share({ title, url: url() });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    await copy();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={share} className={buttonClass(variant, size)}>
        {state === "copied" ? "Link copied" : sheet ? "Share link" : "Copy share link"}
      </button>
      {state === "failed" && (
        <span className="text-[12px] text-danger" role="status">
          Couldn&apos;t copy. The link is {path}
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied" ? "Link copied" : ""}
      </span>
    </span>
  );
}
