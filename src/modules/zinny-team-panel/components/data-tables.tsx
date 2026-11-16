"use client";

import {
  ViewTransition,
  addTransitionType,
  startTransition,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge, Input, cx } from "@/components/ui";
import type {
  TableGroup,
  TableSummary,
} from "@/modules/zinny-team-panel/data-console";
import { formatCount } from "@/modules/zinny-team-panel/lib/format";
import { dataTableHref } from "@/modules/zinny-team-panel/lib/data-links";
import { FILTER, IntentLink, Monogram, tableMorphName } from "./data-motion";

const ALL = "all";

/** Moves with the list when a filter changes; grows into its page when opened. */
const cardMotion = {
  share: "data-morph",
  update: { [FILTER]: "data-move", default: "none" },
  enter: { [FILTER]: "data-pop", default: "none" },
  exit: { [FILTER]: "data-pop", default: "none" },
  default: "none",
} as const;

function matches(t: TableSummary, q: string) {
  return (
    !q ||
    t.name.toLowerCase().includes(q) ||
    t.label.toLowerCase().includes(q) ||
    t.groupLabel.toLowerCase().includes(q)
  );
}

/**
 * Every table as a card. Pick a group or type to narrow the cards down; the others glide into
 * place. Opening a card grows it into the table's page.
 */
export function DataTables({
  groups,
  initialQuery,
  initialGroup,
}: {
  groups: TableGroup[];
  initialQuery: string;
  initialGroup: string;
}) {
  const [group, setGroup] = useState(
    groups.some((g) => g.group === initialGroup) ? initialGroup : ALL,
  );
  const [typed, setTyped] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const chipsRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  // Measure where the chosen chip sits, so the highlight can slide to it.
  useLayoutEffect(() => {
    const row = chipsRef.current;
    if (!row) return;
    const measure = () => {
      const chip = row.querySelector<HTMLElement>('[aria-selected="true"]');
      if (chip)
        setPill({
          left: chip.offsetLeft,
          top: chip.offsetTop,
          width: chip.offsetWidth,
          height: chip.offsetHeight,
        });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(row);
    return () => watch.disconnect();
  }, [group, query]);

  // Keep the choice in the address, so coming back from a table finds its card where it was.
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [k, v] of [
      ["q", query.trim()],
      ["group", group === ALL ? "" : group],
    ] as const) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    if (url.href !== window.location.href)
      window.history.replaceState(window.history.state, "", url);
  }, [group, query]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      groups
        .filter((g) => group === ALL || g.group === group)
        .map((g) => ({ ...g, tables: g.tables.filter((t) => matches(t, q)) }))
        .filter((g) => g.tables.length > 0),
    [groups, group, q],
  );
  const countIn = (g: TableGroup) =>
    g.tables.filter((t) => matches(t, q)).length;
  const total = groups.reduce((n, g) => n + countIn(g), 0);

  const choose = (next: string) =>
    startTransition(() => {
      addTransitionType(FILTER);
      setGroup(next);
    });

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-[260px]">
          <Input
            type="search"
            value={typed}
            onChange={(e) => {
              const v = e.target.value;
              setTyped(v);
              startTransition(() => {
                addTransitionType(FILTER);
                setQuery(v);
              });
            }}
            placeholder="Find a table, like invoices or plat_"
            aria-label="Find a table"
          />
        </div>
        <span className="text-[13px] text-muted" aria-live="polite">
          {formatCount(total)} {total === 1 ? "table" : "tables"}
          {q ? " match" : ""}
        </span>
      </div>

      <div
        ref={chipsRef}
        role="tablist"
        aria-label="Table groups"
        className="relative -mx-1 mb-7 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
      >
        {/* The highlight slides from the old choice to the new one, under the labels. */}
        <span
          aria-hidden
          className={cx(
            "pointer-events-none absolute rounded-full bg-brand transition-[left,top,width] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
            !pill && "opacity-0",
          )}
          style={pill ?? undefined}
        />
        <Chip
          label="All tables"
          count={total}
          active={group === ALL}
          solid={!pill}
          onClick={() => choose(ALL)}
        />
        {groups.map((g) => (
          <Chip
            key={g.group}
            label={g.label}
            count={countIn(g)}
            active={group === g.group}
            solid={!pill}
            onClick={() => choose(g.group)}
          />
        ))}
      </div>

      {shown.length === 0 ? (
        <ViewTransition enter="data-pop" exit="data-pop" default="none">
          <div className="rounded-[22px] border border-dashed border-line px-6 py-14 text-center">
            <p className="text-[16px] font-medium">
              No tables match “{query.trim()}”
            </p>
            <p className="mt-1 text-[14px] text-muted">
              Try part of the name, like enrol or pay_, or pick All tables.
            </p>
          </div>
        </ViewTransition>
      ) : (
        <div className="space-y-9">
          {shown.map((g) => (
            <section key={g.group} aria-label={g.label}>
              <ViewTransition
                name={`data-group-${g.group.replace(/[^a-zA-Z0-9_-]/g, "_")}`}
                {...cardMotion}
                share="none"
              >
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-[17px] font-medium">{g.label}</h2>
                  <span className="text-[13px] text-muted">
                    {g.tables.length}{" "}
                    {g.tables.length === 1 ? "table" : "tables"} ·{" "}
                    {formatCount(g.tables.reduce((n, t) => n + t.rows, 0))} rows
                  </span>
                </div>
              </ViewTransition>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.tables.map((t) => (
                  <li key={t.name} className="min-w-0">
                    <TableCard t={t} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function Chip({
  label,
  count,
  active,
  solid,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  /** Paint its own highlight until the sliding one has measured where to go. */
  solid: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cx(
        "relative h-9 shrink-0 rounded-full px-3.5 text-[13.5px] whitespace-nowrap transition-colors duration-300",
        active
          ? "text-canvas"
          : "text-muted hover:bg-brand-soft/60 hover:text-ink",
        active && solid && "bg-brand",
      )}
    >
      {label}{" "}
      <span className={cx("tabular", active ? "text-canvas/70" : "text-faint")}>
        {count}
      </span>
    </button>
  );
}

function TableCard({ t }: { t: TableSummary }) {
  return (
    <IntentLink
      href={dataTableHref(t.name)}
      className="group block h-full rounded-[22px] focus-visible:outline-offset-4"
      aria-label={`Open ${t.label}`}
    >
      <ViewTransition name={tableMorphName(t.name)} {...cardMotion}>
        <article className="flex h-full flex-col rounded-[22px] border border-line bg-surface p-4 transition-[border-color,box-shadow,translate] duration-200 group-hover:-translate-y-0.5 group-hover:border-brand/40 group-hover:shadow-[0_10px_30px_-18px_rgba(6,58,47,0.45)]">
          <div className="flex min-w-0 items-center gap-3">
            <Monogram label={t.label} />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[15px] font-medium">{t.label}</h3>
              <p className="truncate font-mono text-[12px] text-muted">
                {t.name}
              </p>
            </div>
          </div>
          <div className="mt-auto flex items-end justify-between gap-3 pt-4">
            <span className="flex items-baseline gap-1.5">
              <span className="tabular text-[20px] leading-none font-semibold">
                {formatCount(t.rows)}
              </span>
              <span className="text-[12.5px] text-muted">
                {t.rows === 1 ? "row" : "rows"}
              </span>
            </span>
            <span className="flex items-center gap-2 text-[12.5px] text-muted">
              {t.columns} {t.columns === 1 ? "column" : "columns"}
              {t.hasUniversity ? (
                <Badge>Per institute</Badge>
              ) : (
                <span className="text-faint">· Shared</span>
              )}
            </span>
          </div>
        </article>
      </ViewTransition>
    </IntentLink>
  );
}
