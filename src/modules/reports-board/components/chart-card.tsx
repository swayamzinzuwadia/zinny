"use client";

import { useId, useState, type ReactNode } from "react";
import { Card, cx } from "@/components/ui";

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
 * One Insights card: title, a quiet "Show as a table" link in the header, the chart straight on
 * the card (no tinted panel) and a one-line takeaway under it. The table carries the same
 * numbers for screen readers and keyboards.
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
  takeaway: ReactNode;
  chart: ReactNode;
  table: FallbackTable | FallbackTable[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tables = Array.isArray(table) ? table : [table];
  return (
    <Card className={cx("flex min-w-0 flex-col", className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[16px] font-medium">{title}</h2>
        <div className="flex flex-wrap items-baseline gap-x-3 text-[13px] text-muted">
          {hint && <span>{hint}</span>}
          <button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((o) => !o)}
            className="text-brand hover:underline"
          >
            {open ? "Hide the table" : "Show as a table"}
          </button>
        </div>
      </div>
      <div className="min-w-0">{chart}</div>
      <div className="mt-4 text-[14px] leading-relaxed text-ink">{takeaway}</div>
      <div id={id} hidden={!open}>
        {open && tables.map((t) => <DataTable key={t.caption} {...t} />)}
      </div>
    </Card>
  );
}

export function DataTable({ caption, head, rows, numeric = [], current = [] }: FallbackTable) {
  if (rows.length === 0) return <p className="mt-3 text-[13px] text-muted">No data to show.</p>;
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
export function ChartEmpty({ children, height = 120 }: { children: ReactNode; height?: number }) {
  return (
    <div className="flex items-center justify-center px-6 text-center text-[14px] text-muted" style={{ height }}>
      {children}
    </div>
  );
}
