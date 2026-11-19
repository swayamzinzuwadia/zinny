"use client";

import { ViewTransition, type ReactNode } from "react";
import "./motion.css";

/** One half of a card-to-page pair: the same `name` on both pages makes the card grow into the page, and back. */
export function Morph({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ViewTransition name={name} share="onb-morph" default="none">
      {children}
    </ViewTransition>
  );
}

/** Opens and closes its children by growing and shrinking their height (CSS grid rows), so nothing pops in. */
export function Grow({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="onb-grow" data-open={open} aria-hidden={!open} inert={!open}>
      <div>{children}</div>
    </div>
  );
}
