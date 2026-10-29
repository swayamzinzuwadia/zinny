/**
 * A simple column chart, rendered on the server. The current period is gold (gold marks
 * "now"); the rest are brand green. Screen readers get the numbers as a table.
 */
import { cx } from "@/components/ui";

export type Bar = { key: string; label: string; value: number; display: string; current?: boolean };

export function BarChart({ bars, title, height = 180, emptyText }: { bars: Bar[]; title: string; height?: number; emptyText: string }) {
  const max = Math.max(0, ...bars.map((b) => b.value));
  const total = bars.reduce((s, b) => s + b.value, 0);
  return (
    <figure>
      <figcaption className="sr-only">{title}</figcaption>
      {total === 0 ? (
        <div className="flex items-center justify-center rounded-2xl bg-canvas text-[14px] text-muted" style={{ height }}>
          {emptyText}
        </div>
      ) : (
        <div aria-hidden className="flex items-end gap-1.5" style={{ height }}>
          {bars.map((b) => {
            const h = max ? Math.max(b.value ? 3 : 0, Math.round((b.value / max) * (height - 28))) : 0;
            return (
              <div key={b.key} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={`${b.label}: ${b.display}`}>
                <span className={cx("mb-1 max-w-full truncate text-[11px] tabular", b.value ? (b.current ? "font-medium text-ink" : "text-muted") : "text-transparent")}>
                  {b.display}
                </span>
                <div className={cx("w-full max-w-[42px] rounded-t-md", b.current ? "bg-gold" : "bg-brand/80 group-hover:bg-brand")} style={{ height: h }} />
              </div>
            );
          })}
        </div>
      )}
      <div aria-hidden className="mt-2 flex gap-1.5 border-t border-line pt-2">
        {bars.map((b, i) => (
          <div key={b.key} className={cx("min-w-0 flex-1 truncate text-center text-[11px]", b.current ? "font-medium text-ink" : "text-faint")}>
            {i % Math.ceil(bars.length / 12) === 0 || b.current ? b.label : ""}
          </div>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {bars.map((b) => (
            <tr key={b.key}>
              <th scope="row">{b.label}</th>
              <td>{b.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
