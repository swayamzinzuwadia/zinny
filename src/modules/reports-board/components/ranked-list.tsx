/**
 * A ranked list: one plain row per course, batch or person, the value printed at the end and a
 * thin 6 px bar under the label. No axis: the printed value is the scale. The bars are hidden
 * from screen readers; the label and value are read as text.
 */
export type RankedRow = {
  label: string;
  /** The value as printed at the end of the row, e.g. "33%" or "₹3,499". */
  value: string;
  /** The raw number the bar is drawn from. Negative values draw an empty bar. */
  amount: number;
  /** Extra detail shown on hover, e.g. "3 of 9 completed". */
  note?: string;
};

export function RankedList({ rows, max }: { rows: RankedRow[]; max?: number }) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.amount));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r, i) => {
        const pct = top > 0 ? Math.min(100, Math.max(0, (r.amount / top) * 100)) : 0;
        return (
          <li key={i} title={r.note ? `${r.label}: ${r.note}` : r.label}>
            <div className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="tabular shrink-0 text-ink">{r.value}</span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-1.5 rounded-full bg-line/70">
              <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
