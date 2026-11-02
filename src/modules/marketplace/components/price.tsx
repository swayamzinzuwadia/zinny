import { cx } from "@/components/ui";
import { inr } from "@/modules/payments/money";
import type { ListingKind } from "../schema";

export const KIND_LABEL: Record<ListingKind, string> = { course: "Course", lecture: "Lecture", combo: "Combo" };

/**
 * A listed price as the marketplace shows it: before GST, with the usual price struck through
 * when there's a deal. GST is worked out and added at checkout, never here.
 */
export function Price({
  pricePaise,
  compareAtPaise,
  size = "sm",
  className,
}: {
  pricePaise: number;
  compareAtPaise: number | null;
  size?: "sm" | "lg";
  className?: string;
}) {
  return (
    <span className={cx("inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <span className={cx("tabular font-semibold whitespace-nowrap", size === "lg" ? "text-[34px] leading-none" : "text-[16px]")}>{inr(pricePaise)}</span>
      {compareAtPaise && <s className={cx("tabular whitespace-nowrap text-muted", size === "lg" ? "text-[17px]" : "text-[13px]")}>{inr(compareAtPaise)}</s>}
      <span className={cx("whitespace-nowrap text-muted", size === "lg" ? "text-[14px]" : "text-[12px]")}>+ GST</span>
    </span>
  );
}
