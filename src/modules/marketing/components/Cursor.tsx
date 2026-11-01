"use client";

import gsap from "gsap";
import { useEffect, useRef } from "react";

/** The logo's gold dot trails the pointer, and swells over anything you can click. Mouse only. */
export function Cursor() {
  const dot = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = dot.current;
    if (!el || !window.matchMedia("(pointer: fine) and (prefers-reduced-motion: no-preference)").matches) return;
    gsap.set(el, { xPercent: -50, yPercent: -50, autoAlpha: 0 });
    const x = gsap.quickTo(el, "x", { duration: 0.35, ease: "power3" });
    const y = gsap.quickTo(el, "y", { duration: 0.35, ease: "power3" });
    const move = (e: PointerEvent) => {
      gsap.to(el, { autoAlpha: 1, duration: 0.2, overwrite: "auto" });
      x(e.clientX);
      y(e.clientY);
    };
    const over = (e: PointerEvent) => {
      const clickable = (e.target as HTMLElement).closest?.("a, button");
      gsap.to(el, { scale: clickable ? 3.2 : 1, duration: 0.25, ease: "power2.out" });
    };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerover", over, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerover", over);
    };
  }, []);

  return <span ref={dot} aria-hidden className="pointer-events-none fixed top-0 left-0 z-[70] hidden size-3 rounded-full bg-gold mix-blend-multiply [@media(pointer:fine)]:block" style={{ visibility: "hidden" }} />;
}
