"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import "./combobox.css";
import { RANGE_PRESETS, rangeQuery, type RangeKey } from "./date-range";
import { cx } from "./ui";

/**
 * Picks a date range for the page it sits on. Presets are plain links, so they prefetch and
 * switch at once; the From and To fields apply as soon as both hold a real date. The choice
 * lives in the address (`?range=last-7-days` or `?from=…&to=…`), so a view can be shared.
 */
export function DateRangeFilter({
  basePath,
  active,
  today,
  keep = {},
}: {
  basePath: string;
  active: { key: RangeKey; from: string; to: string };
  /** The latest date that can be picked. */
  today: string;
  /** Other address parameters to carry along. */
  keep?: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(active.from);
  const [to, setTo] = useState(active.to);
  const [syncedTo, setSyncedTo] = useState(`${active.from}|${active.to}`);
  // The fields follow the range when a preset is clicked.
  if (syncedTo !== `${active.from}|${active.to}`) {
    setSyncedTo(`${active.from}|${active.to}`);
    setFrom(active.from);
    setTo(active.to);
  }

  const extra = Object.entries(keep)
    .map(([k, v]) => `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("");
  const href = (query: string) => `${basePath}?${query}${extra}`;
  const bad = !!from && !!to && from > to;

  function apply(nextFrom: string, nextTo: string) {
    if (!nextFrom || !nextTo || nextFrom > nextTo) return;
    start(() => router.push(href(rangeQuery({ key: "custom", from: nextFrom, to: nextTo })), { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3" aria-busy={pending}>
      <nav aria-label="Date range" className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1">
        {RANGE_PRESETS.map((p) => {
          const on = active.key === p.key;
          return (
            <Link
              key={p.key}
              href={href(`range=${p.key}`)}
              scroll={false}
              aria-current={on ? "true" : undefined}
              className={cx(
                "shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] whitespace-nowrap [transition-property:background-color,color] duration-150",
                on ? "bg-brand font-medium text-canvas" : "text-muted hover:bg-canvas hover:text-ink",
              )}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
      <div
        className={cx(
          "flex items-center gap-2 rounded-full border bg-surface py-1 pr-1 pl-4 text-[13.5px] [transition-property:border-color,box-shadow] duration-150",
          active.key === "custom" ? "border-brand ring-4 ring-gold-soft" : "border-line",
        )}
        role="group"
        aria-label="Custom date range"
      >
        <label className="flex items-center gap-2 text-muted">
          From
          <input
            type="date"
            value={from}
            max={to || today}
            onChange={(e) => {
              setFrom(e.target.value);
              apply(e.target.value, to);
            }}
            className="tabular h-8 rounded-lg bg-transparent px-1 text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
        </label>
        <label className="flex items-center gap-2 text-muted">
          To
          <input
            type="date"
            value={to}
            min={from || undefined}
            max={today}
            onChange={(e) => {
              setTo(e.target.value);
              apply(from, e.target.value);
            }}
            className="tabular h-8 rounded-lg bg-transparent px-1 text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          />
        </label>
        <span aria-hidden className={cx("mr-2 size-3.5 rounded-full border-2 border-line border-t-brand [transition-property:opacity] duration-150", pending ? "cbx-spin opacity-100" : "opacity-0")} />
      </div>
      {bad && (
        <p role="alert" className="basis-full text-[13px] text-danger">
          The start date is after the end date. Pick a start on or before the end.
        </p>
      )}
    </div>
  );
}
