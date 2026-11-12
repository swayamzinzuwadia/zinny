"use client";

import { useFormStatus } from "react-dom";
import { buttonClass, cx } from "@/components/ui";

/** The listing's main action: full width and first in its form. It shares the form with the code's "Apply". */
export function BuyNow({ label = "Buy now" }: { label?: string }) {
  const { pending, data } = useFormStatus();
  const opening = pending && data?.get("intent") !== "apply";
  return (
    <button type="submit" disabled={pending} className={cx(buttonClass("primary"), "h-11 w-full text-[15px]")}>
      {opening ? "Opening checkout…" : label}
    </button>
  );
}
