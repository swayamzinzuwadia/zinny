"use client";

/**
 * card-to-page-ui: the client half. Nothing appears from nowhere.
 *
 * - <Morph name> on a card and on the page it opens makes the card grow into the page and
 *   the page shrink back into the card.
 * - <PageMotion> wraps each page (in page.tsx, never a layout): the rest of the page steps
 *   back while a card grows and returns as it shrinks.
 * - <IntentLink> loads the page when the pointer reaches the link, so the morph can play.
 */
import Link from "next/link";
import { ViewTransition, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { CLOSE, FILTER, OPEN } from "./motion-names";
import "./motion.css";

export { CLOSE, FILTER, OPEN, addName, cardName, rowName } from "./motion-names";

export function PageMotion({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      enter={{ [FILTER]: "none", default: "ctp-page-in" }}
      exit={{ [FILTER]: "none", default: "ctp-page-out" }}
      update="none"
      default="none"
    >
      <div>{children}</div>
    </ViewTransition>
  );
}

/** One half of a card-to-page pair. Both halves need the same name. Child: one element. */
export function Morph({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ViewTransition name={name} share="ctp-morph" default="none">
      {children}
    </ViewTransition>
  );
}

/** Content that changes in place (search, sort, next page) crossfades when `id` changes. */
export function Swap({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ViewTransition key={id} enter="ctp-swap" exit="ctp-swap" default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}

/** A link that loads its page as soon as the pointer, focus or a finger reaches it. */
export function IntentLink({
  direction = OPEN,
  ...props
}: Omit<ComponentProps<typeof Link>, "prefetch" | "transitionTypes"> & { direction?: typeof OPEN | typeof CLOSE }) {
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

/** The way back: shrinks the page into the card it came from. Skip it if the layout has a breadcrumb. */
export function BackTo({ href, children }: { href: string; children: ReactNode }) {
  return (
    <IntentLink href={href} direction={CLOSE} className="mb-3 inline-flex items-center gap-1.5 text-[13px] opacity-70 hover:opacity-100">
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
      {children}
    </IntentLink>
  );
}

/**
 * A panel that grows open from where it sits when `open` is true and folds away when not.
 * Pass `countIn="selector"` instead to open while any matching checkbox in the surrounding
 * form is ticked (a bulk-action bar).
 */
export function RevealWhen({ open, countIn, children }: { open?: boolean; countIn?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!countIn) return;
    const form = ref.current?.closest("form");
    if (!form) return;
    const recount = () => setCount(form.querySelectorAll(`${countIn}:checked`).length);
    const later = () => setTimeout(recount);
    recount();
    form.addEventListener("change", recount);
    form.addEventListener("reset", later);
    return () => {
      form.removeEventListener("change", recount);
      form.removeEventListener("reset", later);
    };
  }, [countIn]);
  const shown = countIn ? count > 0 : !!open;
  return (
    <div ref={ref} className="ctp-reveal" data-open={shown} aria-hidden={!shown} inert={!shown}>
      <div>{children}</div>
    </div>
  );
}
