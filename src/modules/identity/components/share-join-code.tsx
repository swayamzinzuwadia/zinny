"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";

/**
 * Buttons that share an institute's joining code: copy the sign-up link, copy the code, or send
 * both on WhatsApp. On phones that can share, the first button opens the share sheet instead.
 */
export function ShareJoinCode({ code, link, message, whatsApp }: { code: string; link: string; message: string; whatsApp: string }) {
  const [done, setDone] = useState<"link" | "code" | "failed" | null>(null);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    setSheet(typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches);
  }, []);

  async function copy(what: "link" | "code", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setDone(what);
    } catch {
      setDone("failed");
    }
    setTimeout(() => setDone(null), 2500);
  }

  async function share() {
    try {
      await navigator.share({ text: message });
    } catch (e) {
      if ((e as Error).name !== "AbortError") await copy("link", link);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={sheet ? share : () => copy("link", link)} className={buttonClass("primary", "sm")}>
        {sheet ? "Share" : done === "link" ? "Link copied" : "Copy link"}
      </button>
      <button type="button" onClick={() => copy("code", code)} className={buttonClass("secondary", "sm")}>
        {done === "code" ? "Code copied" : "Copy code"}
      </button>
      <a href={whatsApp} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
        Share on WhatsApp
      </a>
      {done === "failed" && (
        <span className="text-[12px] text-danger" role="status">
          Couldn&apos;t copy. Select the link and copy it instead.
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {done === "link" ? "Link copied" : done === "code" ? "Code copied" : ""}
      </span>
    </div>
  );
}

/** Opens the browser's print dialog, for the joining poster. */
export function PrintButton({ label = "Print poster" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("primary", "sm")}>
      {label}
    </button>
  );
}
