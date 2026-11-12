"use client";

import { buttonClass } from "@/components/ui";

export function PrintButton({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClass("secondary", "sm")}>
      {children}
    </button>
  );
}
