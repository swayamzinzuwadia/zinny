"use client";

import { useState, type ReactNode } from "react";
import { ActionIcon, buttonClass } from "@/components/ui";
import { Grow } from "./motion";

/** "Prefer a call?": a small fold-out under the sign-up for people who'd rather talk to the Zinny team first. */
export function PreferCall({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="prefer-call" className="mt-8 rounded-[22px] border border-line bg-canvas p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="prefer-call" className="text-[18px] font-semibold">
            Prefer a call first?
          </h2>
          <p className="mt-1 text-[14px] text-muted">Leave your number and someone from the Zinny team will walk you through it.</p>
        </div>
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={buttonClass("secondary", "sm")}>
          <ActionIcon name={open ? "close" : "send"} />
          {open ? "Close the form" : "Request a call"}
        </button>
      </div>
      <Grow open={open}>
        <div className="pt-5">{children}</div>
      </Grow>
    </section>
  );
}
