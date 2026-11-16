"use client";

import Link from "next/link";
import {
  ViewTransition,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import "./data-motion.css";

/**
 * Motion for the data console. The rule: nothing appears from nowhere.
 *
 * - A table card and its table page share a view-transition name, so the card grows into the
 *   page and the page shrinks back into the same card (`Morph`).
 * - "Open" on a row and "Add a row" do the same with the page they open.
 * - Everything else on the page steps back while the card grows and returns as it shrinks
 *   (`DataPage`).
 */

export {
  CLOSE,
  FILTER,
  OPEN,
  addRowMorphName,
  rowMorphName,
  tableMorphName,
} from "../lib/data-motion-names";
import { CLOSE, FILTER, OPEN } from "../lib/data-motion-names";

/** The page around the moving card: steps back as a card opens, returns as one closes. */
export function DataPage({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ [FILTER]: "none", default: "data-page-in" }}
      exit={{ [FILTER]: "none", default: "data-page-out" }}
      update="none"
      default="none"
    >
      <div>{children}</div>
    </ViewTransition>
  );
}

/** One half of a card-to-page pair: the same `name` on both pages makes one grow into the other. */
export function Morph({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <ViewTransition name={name} share="data-morph" default="none">
      {children}
    </ViewTransition>
  );
}

/** Rows that change in place (search, sort, next page) crossfade instead of cutting. */
export function Swap({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ViewTransition key={id} enter="data-swap" exit="data-swap" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}

/**
 * A link that loads its page the moment the pointer or a finger reaches it, so the page is
 * ready when the click lands and the card can grow straight into it.
 */
export function IntentLink({
  direction = OPEN,
  ...props
}: Omit<ComponentProps<typeof Link>, "prefetch" | "transitionTypes"> & {
  direction?: typeof OPEN | typeof CLOSE;
}) {
  const [warm, setWarm] = useState(false);
  const wake = () => setWarm(true);
  return (
    <Link
      {...props}
      prefetch={warm ? true : false}
      transitionTypes={[direction]}
      onPointerEnter={(e) => {
        wake();
        props.onPointerEnter?.(e);
      }}
      onFocus={(e) => {
        wake();
        props.onFocus?.(e);
      }}
      onTouchStart={(e) => {
        wake();
        props.onTouchStart?.(e);
      }}
    />
  );
}

/** The way back: shrinks the page into the card it came from. */
export function BackTo({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <IntentLink
      href={href}
      direction={CLOSE}
      className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-brand"
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="size-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
      {children}
    </IntentLink>
  );
}

/** Two letters that stand for a table, on the tile at the top of its card and its page. */
export function Monogram({
  label,
  size = "md",
}: {
  label: string;
  size?: "md" | "lg";
}) {
  const words = label.split(/[\s_]+/).filter(Boolean);
  const letters = (
    (words[0]?.[0] ?? "") + (words[1]?.[0] ?? words[0]?.[1] ?? "")
  ).toUpperCase();
  return (
    <span
      aria-hidden
      className={
        size === "lg"
          ? "grid size-14 shrink-0 place-items-center rounded-2xl bg-brand-soft text-[20px] font-semibold text-brand"
          : "grid size-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-[15px] font-semibold text-brand"
      }
    >
      {letters}
    </span>
  );
}

/**
 * Opens downward from the table when rows are ticked, and folds away when none are.
 * Counts the ticked `name="key"` boxes in the surrounding form.
 */
export function RevealWhenTicked({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const recount = () =>
      setCount(
        form.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"][name="key"]:checked',
        ).length,
      );
    const later = () => setTimeout(recount);
    recount();
    form.addEventListener("change", recount);
    form.addEventListener("reset", later);
    return () => {
      form.removeEventListener("change", recount);
      form.removeEventListener("reset", later);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="data-reveal"
      data-open={count > 0}
      aria-hidden={count === 0}
      inert={count === 0}
    >
      <div>
        <div className="pt-4">
          <p className="mb-3 text-[14px] font-medium">
            {count} {count === 1 ? "row" : "rows"} ticked
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}
