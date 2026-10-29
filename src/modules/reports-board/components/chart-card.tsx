import type { ReactNode } from "react";
import { Card, CardTitle, cx } from "@/components/ui";

export type FallbackTable = {
  /** Read by screen readers as the table's name. */
  caption: string;
  head: string[];
  /** Cells as text. Numeric columns are right-aligned by index. */
  rows: string[][];
  numeric?: number[];
  /** Row indexes to mark as the current week or month. */
  current?: number[];
};

/**
 * One Insights chart: title, the chart on a cream panel, a one-line takeaway under it, and
 * the same numbers as a table behind "Show as a table" for screen readers and keyboards.
 */
export function ChartCard({
  title,
  hint,
  takeaway,
  chart,
  table,
  className,
}: {
  title: string;
  hint?: string;
  takeaway: string;
  chart: ReactNode;
  table: FallbackTable;
  className?: string;
}) {
  return (
    <Card className={cx("flex flex-col", className)}>
      <CardTitle hint={hint}>{title}</CardTitle>
      <div className="rounded-2xl bg-canvas px-2 pb-2 pt-3">{chart}</div>
      <p className="mt-3 text-[14px] leading-relaxed text-ink">{takeaway}</p>
      <details className="group mt-3 text-[13px]">
        <summary className="w-fit cursor-pointer select-none rounded-full text-brand hover:underline">
          <span className="group-open:hidden">Show as a table</span>
          <span className="hidden group-open:inline">Hide the table</span>
        </summary>
        <DataTable {...table} />
      </details>
    </Card>
  );
}

export function DataTable({ caption, head, rows, numeric = [], current = [] }: FallbackTable) {
  if (rows.length === 0) return <p className="mt-3 text-muted">No data to show.</p>;
  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-xl border border-line">
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className={cx("border-b border-line px-3 py-2 font-normal", numeric.includes(i) && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, ri) => (
            <tr key={ri} className={cx(current.includes(ri) && "bg-gold-soft/60")}>
              {r.map((c, ci) =>
                ci === 0 ? (
                  <th key={ci} scope="row" className="px-3 py-1.5 font-normal">
                    {c}
                  </th>
                ) : (
                  <td key={ci} className={cx("px-3 py-1.5", numeric.includes(ci) && "tabular text-right")}>
                    {c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shown in place of a chart when there is nothing to draw yet. */
export function ChartEmpty({ children, height = 160 }: { children: ReactNode; height?: number }) {
  return (
    <div className="flex items-center justify-center px-6 text-center text-[14px] text-muted" style={{ height }}>
      {children}
    </div>
  );
}
