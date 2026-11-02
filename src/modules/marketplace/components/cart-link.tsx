"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/** Sent by the add-to-cart flight when the book lands, so the badge changes the moment it arrives. */
export const CART_EVENT = "zinny:cart";
export type CartEventDetail = { count: number };

/** The cart in the marketplace header: where an added book's cart comes to rest. */
export function CartLink({ count: initial }: { count: number }) {
  const [count, setCount] = useState(initial);
  const badge = useRef<HTMLSpanElement>(null);

  useEffect(() => setCount(initial), [initial]);
  useEffect(() => {
    const on = (e: Event) => {
      setCount((e as CustomEvent<CartEventDetail>).detail.count);
      requestAnimationFrame(() =>
        badge.current?.animate([{ transform: "scale(1.6)" }, { transform: "scale(0.9)" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(0.22,1,0.36,1)" }),
      );
    };
    window.addEventListener(CART_EVENT, on);
    return () => window.removeEventListener(CART_EVENT, on);
  }, []);

  return (
    <Link
      href="/marketplace/cart"
      id="nav-cart"
      aria-label={count ? `Your cart, ${count} ${count === 1 ? "recording" : "recordings"}` : "Your cart"}
      className="relative flex size-10 items-center justify-center rounded-full text-canvas/85 [transition-property:background-color,color] duration-150 hover:bg-canvas/10 hover:text-canvas"
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4h2.2l2.1 10.2a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.2L20 8H6.1" />
        <circle cx="9.5" cy="19.5" r="1.3" />
        <circle cx="16.5" cy="19.5" r="1.3" />
      </svg>
      {count > 0 && (
        <span ref={badge} className="tabular absolute -top-0.5 -right-0.5 flex min-w-[1.15rem] items-center justify-center rounded-full bg-gold px-1 text-[11px] leading-[1.15rem] font-semibold text-brand-deep">
          {count}
        </span>
      )}
    </Link>
  );
}
