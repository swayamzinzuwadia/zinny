/**
 * The permission grid on the Roles & permissions pages: one row per thing a role works on
 * ("Courses"), with View, Add / Edit and Delete columns. A tick box where there is something to
 * switch on, and a quiet dash where there isn't. One ability that covers several columns shows
 * as joined ticks, so it's clear they go on and off together.
 *
 * Read only unless it is given onChange. In the editor every tick box is a checkbox named
 * "ability" with the ability's key as its value, which is what the save action reads.
 */
import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/components/ui";
import type { GridColumn } from "@/server/authz/abilities";

export type GridItem = {
  key: string;
  /** What the tick means, in words ("Delete courses"). */
  label: string;
  /** The rows it shows in. The first is its own. */
  rows: readonly string[];
  /** The columns it ticks. */
  cols: readonly GridColumn[];
  /** Part of the role, never switched on or off. */
  locked?: boolean;
};

export type GridCell = { cols: GridColumn[]; item: GridItem | null };
export type GridRow = { name: string; hint?: string; cells: GridCell[] };

const COLUMNS: { key: GridColumn; label: string; words: string[] }[] = [
  { key: "view", label: "View", words: ["view"] },
  { key: "edit", label: "Add / Edit", words: ["add", "edit"] },
  { key: "delete", label: "Delete", words: ["delete"] },
];

const list = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "Add, edit and delete go together." */
export function togetherHint(cols: readonly GridColumn[]) {
  return `${capital(list(COLUMNS.filter((c) => cols.includes(c.key)).flatMap((c) => c.words)))} go together.`;
}

/**
 * Lays the abilities out in rows, in the order they first appear. Two abilities never share a
 * cell: if one would land where another already is, it gets a row of its own instead of hiding.
 */
export function layoutGrid(items: readonly GridItem[]): GridRow[] {
  const rows = new Map<string, Map<GridColumn, GridItem>>();
  const place = (name: string, item: GridItem) => {
    const row = rows.get(name);
    if (row && item.cols.some((c) => row.has(c) && row.get(c)!.key !== item.key)) return false;
    const cells = row ?? new Map<GridColumn, GridItem>();
    item.cols.forEach((c) => cells.set(c, item));
    rows.set(name, cells);
    return true;
  };
  for (const item of items) {
    if (item.cols.length === 0) continue;
    for (const name of item.rows) {
      if (place(name, item)) continue;
      let n = 1;
      while (!place(n === 1 ? item.label : `${item.label} (${n})`, item)) n++;
    }
  }

  return [...rows].map(([name, cells]) => {
    const out: GridCell[] = [];
    for (const { key } of COLUMNS) {
      const item = cells.get(key) ?? null;
      const last = out.at(-1);
      if (item && last?.item?.key === item.key) last.cols.push(key);
      else out.push({ cols: [key], item });
    }
    const distinct = [...new Map([...cells.values()].map((i) => [i.key, i])).values()];
    const locked = distinct.find((i) => i.locked);
    const only = distinct.length === 1 ? distinct[0] : null;
    const hint = locked ? `Always part of this role: ${lower(locked.label)}.` : only && only.cols.length === 1 && only.cols[0] === "edit" ? only.label : undefined;
    return { name, hint, cells: out };
  });
}

type Props = {
  items: readonly GridItem[];
  /** The keys that are ticked. */
  on: ReadonlySet<string>;
  /** Makes the grid editable. Without it, it only shows what is ticked. */
  onChange?: (key: string, value: boolean) => void;
  /** Names the grid for screen readers, usually the section. */
  label: string;
};

export function PermissionGrid({ items, on, onChange, label }: Props) {
  const rows = layoutGrid(items);
  return (
    <table className="w-full table-fixed border-collapse text-[14px]">
      <caption className="sr-only">{label}</caption>
      <colgroup>
        <col />
        {COLUMNS.map((c) => (
          <col key={c.key} className="w-16 @lg:w-24" />
        ))}
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="pb-2 text-left">
            <span className="sr-only">What it covers</span>
          </th>
          {COLUMNS.map((c) => (
            <th key={c.key} scope="col" className="px-1 pb-2 text-center text-[12.5px] leading-tight font-normal text-muted">
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name} className="border-t border-line">
            <th scope="row" className="py-2.5 pr-3 text-left align-middle font-normal">
              <span className="block leading-snug">{r.name}</span>
              {r.hint && <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{r.hint}</span>}
            </th>
            {r.cells.map((c) => (
              <Cell key={c.cols[0]} cell={c} on={on} onChange={onChange} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Cell({ cell, on, onChange }: { cell: GridCell; on: ReadonlySet<string>; onChange?: Props["onChange"] }) {
  const { item, cols } = cell;
  if (!item) {
    return (
      <td className="py-2.5 text-center align-middle text-faint">
        <span aria-hidden>—</span>
        <span className="sr-only">Nothing to set</span>
      </td>
    );
  }

  const checked = on.has(item.key) || !!item.locked;
  const together = cols.length > 1 ? togetherHint(cols) : null;
  const note = item.locked ? "Always part of this role." : together;
  const title = note ? `${item.label}. ${note}` : item.label;
  const editable = !!onChange && !item.locked;
  const span: CSSProperties = { gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` };
  const inset = `${50 / cols.length}%`;

  const inner: ReactNode = (
    <>
      {editable ? (
        <input type="checkbox" name="ability" value={item.key} checked={checked} onChange={(e) => onChange?.(item.key, e.target.checked)} aria-label={together ? `${item.label} (${lower(together).replace(/\.$/, "")})` : item.label} className="peer sr-only" />
      ) : (
        <span className="sr-only">{`${item.label}: ${item.locked ? "always part of this role" : checked ? "yes" : "no"}`}</span>
      )}
      {cols.length > 1 && <span aria-hidden className={cx("absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full", checked ? "bg-brand" : "bg-line")} style={{ left: inset, right: inset }} />}
      {cols.map((c) => (
        <Box key={c} checked={checked} locked={item.locked} editable={editable} />
      ))}
    </>
  );

  return (
    <td colSpan={cols.length} className="py-1.5 align-middle">
      {editable ? (
        <label title={title} style={span} className="group relative grid h-9 cursor-pointer place-items-center">
          {inner}
        </label>
      ) : (
        <span title={title} style={span} className="relative grid h-9 place-items-center">
          {inner}
        </span>
      )}
    </td>
  );
}

function Box({ checked, locked, editable }: { checked: boolean; locked?: boolean; editable: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative flex size-5 items-center justify-center rounded-md border [transition-property:background-color,border-color] duration-150",
        checked ? "border-brand bg-brand text-canvas" : "border-faint bg-surface text-transparent",
        editable && "peer-focus-visible:ring-2 peer-focus-visible:ring-gold peer-focus-visible:ring-offset-1",
        editable && !checked && "group-hover:border-brand",
      )}
    >
      <Tick className="size-3.5" />
      {locked && (
        <span className="absolute -right-1.5 -bottom-1.5 flex size-3.5 items-center justify-center rounded-full bg-surface text-brand ring-1 ring-line">
          <Lock className="size-2.5" />
        </span>
      )}
    </span>
  );
}

/** A one-line key to the grid's marks. */
export function GridLegend({ locked, className }: { locked?: boolean; className?: string }) {
  const item = "inline-flex items-center gap-2";
  return (
    <ul className={cx("flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted", className)}>
      <li className={item}>
        <Box checked editable={false} />
        Can do it
      </li>
      <li className={item}>
        <span className="relative grid w-12 grid-cols-2 place-items-center">
          <span aria-hidden className="absolute inset-x-1/4 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-brand" />
          <Box checked editable={false} />
          <Box checked editable={false} />
        </span>
        One switch for both
      </li>
      <li className={item}>
        <span aria-hidden className="w-5 text-center text-faint">
          —
        </span>
        Nothing to set
      </li>
      {locked && (
        <li className={item}>
          <Box checked locked editable={false} />
          Always part of this role
        </li>
      )}
    </ul>
  );
}

export function Tick({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

function Lock({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className} fill="currentColor">
      <path d="M5 7V5.5a3 3 0 0 1 6 0V7h.5A1.5 1.5 0 0 1 13 8.5v4a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 12.5v-4A1.5 1.5 0 0 1 4.5 7H5Zm1.5 0h3V5.5a1.5 1.5 0 0 0-3 0V7Z" />
    </svg>
  );
}
