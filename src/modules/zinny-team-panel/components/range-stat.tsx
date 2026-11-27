import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { percentChange } from "../services/analytics";

/**
 * A number for the chosen range, with how it moved against the period before it.
 * `format` writes the previous value in the same units as the number.
 */
export function RangeStat({
  label,
  value,
  now,
  before,
  format,
  hint,
}: {
  label: string;
  value: ReactNode;
  now: number;
  before: number;
  format: (n: number) => string;
  hint?: ReactNode;
}) {
  const change = percentChange(now, before);
  const same = now === before;
  const up = now > before;
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4">
      <div className="text-[13px] text-muted">{label}</div>
      <div className="tabular mt-1.5 text-[28px] leading-none font-medium">{value}</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
        {same ? (
          <span className="text-muted">No change</span>
        ) : (
          <span className={cx("tabular inline-flex items-center gap-1 font-medium", up ? "text-brand-strong" : "text-danger")}>
            <svg aria-hidden viewBox="0 0 12 12" className={cx("size-3", !up && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 10V2.5M2.8 5.5 6 2.3l3.2 3.2" />
            </svg>
            {change === null ? `+${format(now - before)}` : `${Math.abs(change)}%`}
            <span className="sr-only">{up ? " higher" : " lower"}</span>
          </span>
        )}
        <span className="tabular text-faint">{hint ?? `was ${format(before)}`}</span>
      </div>
    </div>
  );
}
