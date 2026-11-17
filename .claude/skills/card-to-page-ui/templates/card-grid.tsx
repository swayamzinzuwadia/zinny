"use client";

/**
 * card-to-page-ui: a filterable grid of cards.
 * - Group chips with a live highlight that slides under the labels.
 * - Search and group changes run as FILTER transitions: cards glide, leavers scale out.
 * - The filter lives in the URL, so coming back finds the card where it was.
 * - Each card is one half of a Morph pair; the detail page holds the other half.
 * Replace `Item`, the href and the card body with your own data. Colours are placeholders.
 */
import { ViewTransition, addTransitionType, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FILTER, IntentLink, cardName } from "./motion";

export type Item = { id: string; title: string; subtitle: string; group: string; groupLabel: string; stat: number; statLabel: string };

const ALL = "all";

/** Moves with the list when a filter changes; grows into its page when opened. */
const cardMotion = {
  share: "ctp-morph",
  update: { [FILTER]: "ctp-move", default: "none" },
  enter: { [FILTER]: "ctp-pop", default: "none" },
  exit: { [FILTER]: "ctp-pop", default: "none" },
  default: "none",
} as const;

export function CardGrid({ items, hrefFor, initialQuery = "", initialGroup = ALL }: { items: Item[]; hrefFor: (i: Item) => string; initialQuery?: string; initialGroup?: string }) {
  const groups = useMemo(() => [...new Map(items.map((i) => [i.group, i.groupLabel])).entries()], [items]);
  const [group, setGroup] = useState(groups.some(([g]) => g === initialGroup) ? initialGroup : ALL);
  const [typed, setTyped] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);

  // Keep the choice in the address so the way back lands on the same layout.
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [k, v] of [["q", query.trim()], ["group", group === ALL ? "" : group]] as const) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [group, query]);

  const q = query.trim().toLowerCase();
  const matches = (i: Item) => !q || i.title.toLowerCase().includes(q) || i.subtitle.toLowerCase().includes(q);
  const shown = items.filter((i) => (group === ALL || i.group === group) && matches(i));

  // The chip highlight is a live element measured under the chosen chip (a view-transition
  // highlight would be painted above the labels).
  const chipsRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const row = chipsRef.current;
    if (!row) return;
    const measure = () => {
      const chip = row.querySelector<HTMLElement>('[aria-selected="true"]');
      if (chip) setPill({ left: chip.offsetLeft, top: chip.offsetTop, width: chip.offsetWidth, height: chip.offsetHeight });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [group, query]);

  const filter = (fn: () => void) =>
    startTransition(() => {
      addTransitionType(FILTER);
      fn();
    });

  return (
    <>
      <input
        type="search"
        value={typed}
        onChange={(e) => {
          const v = e.target.value;
          setTyped(v);
          filter(() => setQuery(v));
        }}
        placeholder="Find…"
        aria-label="Find"
        className="mb-4 h-10 w-full rounded-xl border px-3"
      />

      <div ref={chipsRef} role="tablist" className="relative mb-6 flex gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        <span
          aria-hidden
          className={`pointer-events-none absolute rounded-full bg-emerald-800 transition-[left,top,width] duration-300 motion-reduce:transition-none ${pill ? "" : "opacity-0"}`}
          style={pill ?? undefined}
        />
        {[[ALL, "All"] as const, ...groups].map(([g, label]) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={group === g}
            onClick={() => filter(() => setGroup(g))}
            className={`relative h-9 shrink-0 rounded-full px-3.5 text-sm whitespace-nowrap transition-colors duration-300 ${group === g ? "text-white" : "opacity-70 hover:opacity-100"} ${group === g && !pill ? "bg-emerald-800" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <ViewTransition enter="ctp-pop" exit="ctp-pop" default="none">
          <p className="rounded-2xl border border-dashed px-6 py-14 text-center">Nothing matches. Try another word or pick All.</p>
        </ViewTransition>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((i) => (
            <li key={i.id} className="min-w-0">
              <IntentLink href={hrefFor(i)} className="group block h-full rounded-[22px]" aria-label={`Open ${i.title}`}>
                <ViewTransition name={cardName(i.id)} {...cardMotion}>
                  <article className="flex h-full flex-col rounded-[22px] border bg-white p-4 transition-[box-shadow,translate] duration-200 group-hover:-translate-y-0.5 group-hover:shadow-lg">
                    <h3 className="truncate font-medium">{i.title}</h3>
                    <p className="truncate text-sm opacity-60">{i.subtitle}</p>
                    <p className="mt-auto pt-4">
                      <span className="text-xl font-semibold tabular-nums">{i.stat.toLocaleString()}</span> <span className="text-sm opacity-60">{i.statLabel}</span>
                    </p>
                  </article>
                </ViewTransition>
              </IntentLink>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
