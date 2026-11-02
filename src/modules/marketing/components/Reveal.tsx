"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef, type ReactNode } from "react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Plays a section in as it scrolls into view. The marks it reads inside: data-reveal (rises
 * in, in order), data-rule (a line drawing left to right), data-drop (books dropping onto the
 * shelf with a bounce, in a random order). Nothing moves with reduced motion.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const q = (s: string) => gsap.utils.toArray<HTMLElement>(root.current!.querySelectorAll(s));
        const reveal = q("[data-reveal]");
        const rules = q("[data-rule]");
        const drops = q("[data-drop] > * > *");
        if (reveal.length) {
          gsap.from(reveal, { y: 34, opacity: 0, duration: 0.85, stagger: 0.08, ease: "power3.out", scrollTrigger: { trigger: root.current, start: "top 75%" } });
        }
        if (rules.length) {
          gsap.from(rules, { scaleX: 0, transformOrigin: "0% 50%", duration: 0.9, stagger: 0.08, ease: "power3.inOut", scrollTrigger: { trigger: root.current, start: "top 75%" } });
        }
        if (drops.length) {
          gsap.from(drops, {
            y: -180,
            rotate: () => gsap.utils.random(-14, 14),
            opacity: 0,
            duration: 0.9,
            stagger: { each: 0.09, from: "random" },
            ease: "bounce.out",
            scrollTrigger: { trigger: drops[0], start: "top 85%" },
          });
        }
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}
