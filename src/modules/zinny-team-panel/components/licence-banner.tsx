"use client";

import { useEffect, useState } from "react";
import { ButtonLabel, ButtonLink, actionClass, cx } from "@/components/ui";
import "./platform-topbar.css";

const KEY = "zinny-licence-banner-dismissed";

/**
 * Tells an institute's owners and admins that their Zinny licence is about to end.
 * Gold, because it needs attention. Dismissing hides it for the rest of the browser session
 * only for today: a new day (or a new session) brings it back, until the licence is renewed.
 */
export function LicenceBanner({
  endText,
  daysLeft,
  urgent,
  renewHref,
  today,
}: {
  /** The end date, written out: "12 Dec 2026". */
  endText: string;
  daysLeft: number;
  urgent: boolean;
  renewHref: string;
  /** Today's date, so a dismissal only lasts the day. */
  today: string;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(KEY) === today) setHidden(true);
    } catch {
      // Storage blocked: the banner just stays.
    }
  }, [today]);

  function dismiss() {
    setHidden(true);
    try {
      window.sessionStorage.setItem(KEY, today);
    } catch {
      // Nothing to do: it comes back on the next page.
    }
  }

  const ended = daysLeft < 0;
  const when = ended
    ? `Your Zinny licence ended on ${endText}.`
    : daysLeft === 0
      ? `Your Zinny licence ends today, ${endText}.`
      : `Your Zinny licence ends on ${endText}, ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`;

  return (
    // Folds up like the other panels instead of vanishing.
    <div className="lb-wrap" data-hidden={hidden} inert={hidden}>
      <div>
        <div role="status" className={cx("flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-2.5 text-[14px] lg:px-10", urgent ? "border-gold bg-gold text-brand-deep" : "border-gold/40 bg-gold-soft text-ink")}>
          <svg aria-hidden viewBox="0 0 20 20" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M10 5.5V10l3 1.8" />
          </svg>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{when}</span>
            {ended ? " Renew it to keep your institute open to students." : " Renew before then so students and staff keep their access."}
          </span>
          <ButtonLink href={renewHref} size="sm" variant={urgent ? "primary" : "secondary"}>
            Renew licence
          </ButtonLink>
          <button type="button" onClick={dismiss} className={actionClass("Remind me tomorrow")}>
            <ButtonLabel icon="close">Remind me tomorrow</ButtonLabel>
          </button>
        </div>
      </div>
    </div>
  );
}
