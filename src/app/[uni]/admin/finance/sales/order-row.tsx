"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** A sales row: clicking anywhere on it opens the order, through the student's name link in it. */
export function OrderRow({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <tr
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea")) return;
        e.currentTarget.querySelector("a")?.click();
      }}
      className={cx("cursor-pointer hover:bg-canvas/60", selected && "bg-brand-soft/50")}
    >
      {children}
    </tr>
  );
}

/**
 * The order panel. On wide screens it sits beside the table; below that it sits above the table,
 * so it scrolls into view when an order opens instead of opening out of sight.
 */
export function OrderPanelFrame({ orderId, children }: { orderId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 1279px)").matches) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [orderId]);
  return (
    <div ref={ref} className="scroll-mt-6 xl:sticky xl:top-6">
      {children}
    </div>
  );
}
