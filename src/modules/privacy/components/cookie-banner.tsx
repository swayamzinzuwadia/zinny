"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ButtonLabel, buttonClass, cx } from "@/components/ui";
import "./privacy.css";

/** Where the choice is remembered: "<version>:essential" or "<version>:analytics". Readable by scripts on purpose. */
export const COOKIE_CHOICE = "zinny_cookies";
const VERSION = "1";
const MAX_AGE = 180 * 86_400;
export const OPEN_COOKIE_SETTINGS = "zinny:cookie-settings";

/** Pages anyone can open without signing in. The banner shows only there. */
const PUBLIC = ["/privacy", "/marketplace", "/signup", "/login", "/book-a-demo", "/verify", "/site", "/join", "/reset", "/invite"];
const isPublic = (path: string) => path === "/" || PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));

export function readCookieChoice(): "essential" | "analytics" | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${COOKIE_CHOICE}=`));
  const v = raw ? decodeURIComponent(raw.slice(COOKIE_CHOICE.length + 1)) : "";
  const [ver, choice] = v.split(":");
  return ver === VERSION && (choice === "essential" || choice === "analytics") ? choice : null;
}

function save(choice: "essential" | "analytics") {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE_CHOICE}=${encodeURIComponent(`${VERSION}:${choice}`)}; Max-Age=${MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

/**
 * The cookie notice on public pages. Only essential cookies (signing in, security, this
 * choice) are used until someone switches analytics on. The choice is remembered for 180
 * days and can be changed from /privacy. It rises from the bottom edge and sinks back.
 */
export function CookieBanner() {
  const path = usePathname() ?? "/";
  const [state, setState] = useState<"hidden" | "shown" | "leaving">("hidden");
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    // Reading the cookie needs the browser, so the banner decides after the first paint.
    const choice = readCookieChoice();
    if (!choice && isPublic(path)) setState("shown");
    const reopen = () => {
      setAnalytics(readCookieChoice() === "analytics");
      setState("shown");
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS, reopen);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS, reopen);
  }, [path]);

  if (state === "hidden") return null;

  const choose = (choice: "essential" | "analytics") => {
    save(choice);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setState("hidden");
    setState("leaving");
    window.setTimeout(() => setState("hidden"), 260);
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 sm:p-5">
      <section
        role="region"
        aria-label="Cookies"
        data-leaving={state === "leaving"}
        className="dp-banner pointer-events-auto w-full max-w-[640px] rounded-[22px] border border-line bg-surface p-4 shadow-[0_18px_50px_-20px_rgb(6_58_47/0.45)] sm:p-5"
      >
        <p className="text-[15px] font-medium">We use essential cookies only</p>
        <p className="mt-1 text-[14px] text-muted">
          They keep you signed in and secure. Analytics, which helps us see which pages work, stays off unless you switch it on. Read the{" "}
          <Link href="/privacy#cookies" className="text-brand underline underline-offset-2">
            privacy notice
          </Link>
          .
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-canvas px-3 py-2.5">
          <span className="text-[14px]">
            <span className="font-medium">Analytics</span>
            <span className="block text-[12px] text-muted">Optional. You can change this any time.</span>
          </span>
          <button type="button" role="switch" aria-checked={analytics} aria-label="Allow analytics cookies" onClick={() => setAnalytics((a) => !a)} className="dp-switch" />
        </div>
        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={() => choose("essential")} className={buttonClass("secondary")}>
            <ButtonLabel icon="close">Use essential only</ButtonLabel>
          </button>
          <button type="button" onClick={() => choose(analytics ? "analytics" : "essential")} className={cx(buttonClass("primary"))}>
            <ButtonLabel icon="check">Save my choice</ButtonLabel>
          </button>
        </div>
      </section>
    </div>
  );
}

/** "Change cookie settings" on the privacy notice: opens the banner again. */
export function CookieSettingsButton() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS))} className={buttonClass("secondary", "sm")}>
      <ButtonLabel icon="settings">Change cookie settings</ButtonLabel>
    </button>
  );
}
