import { cx } from "@/components/ui";
import { inr } from "@/modules/payments/money";
import type { ListingKind } from "../schema";

export const KIND_LABEL: Record<ListingKind, string> = { course: "Course", lecture: "Lecture", combo: "Combo" };

/** What a buyer pays with GST, with the usual price struck through when there's a deal. */
export function Price({ totalPaise, compareAtTotalPaise, className }: { totalPaise: number; compareAtTotalPaise: number | null; className?: string }) {
  return (
    <span className={cx("tabular whitespace-nowrap", className)}>
      {compareAtTotalPaise && <s className="mr-1.5 text-[0.8em] font-normal text-muted">{inr(compareAtTotalPaise)}</s>}
      {inr(totalPaise)}
    </span>
  );
}
