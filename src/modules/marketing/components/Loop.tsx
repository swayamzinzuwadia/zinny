"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import { display } from "../fonts";
import css from "../landing.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const SERIF = display.className;

const card = "rounded-xl bg-surface p-3 text-[11px] text-ink shadow-[0_14px_30px_-18px_rgb(6_58_47/0.6),0_0_0_1px_rgb(20_38_31/0.07)]";

/** Each step of the loop, with a small piece of the product doing that step. */
const STEPS = [
  {
    title: "Teach your batches",
    body: "Timetables, live classes, attendance and tests for every batch you run.",
    Demo: () => (
      <div className={card}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Python Basics · Batch B</span>
          <span className="rounded-full bg-gold px-1.5 text-[9px] font-semibold text-brand-deep">Live</span>
        </div>
        <div className="mt-2 flex gap-1">
          {[1, 1, 1, 0, 1, 1, 1, 1].map((p, i) => (
            <span key={i} className={`h-4 flex-1 rounded-sm ${p ? "bg-brand" : "bg-line"}`} />
          ))}
        </div>
        <div className="mt-1.5 text-muted">7 of 8 present</div>
      </div>
    ),
  },
  {
    title: "Upload the recordings",
    body: "Each class becomes a lesson in the course, with progress saved for every student.",
    Demo: () => (
      <div className={card}>
        {["Variables and types", "Loops, properly", "Functions"].map((t, i) => (
          <div key={t} className="flex items-center gap-2 py-0.5">
            <span className={`flex size-4 items-center justify-center rounded-full text-canvas ${i < 2 ? "bg-brand" : "bg-faint"}`}>
              <svg viewBox="0 0 8 8" className="ml-px size-2" fill="currentColor">
                <path d="M2 1.2v5.6L6.8 4z" />
              </svg>
            </span>
            <span className="truncate">{t}</span>
            <span className="ml-auto text-muted">{[18, 24, 21][i]} min</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: "List them on the marketplace",
    body: "A whole course, one lecture or a combo, at your price, with deals and discount codes.",
    Demo: () => (
      <div className={card}>
        <div className="font-semibold">Python Basics: the full recordings</div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-[14px] font-semibold">₹1,999</span>
          <s className="text-muted">₹2,999</s>
          <span className="ml-auto rounded-full bg-gold px-1.5 text-[9px] font-semibold text-brand-deep">33% off</span>
        </div>
        <div className="mt-2 rounded-full bg-brand py-1 text-center text-[10px] font-medium text-canvas">On sale</div>
      </div>
    ),
  },
  {
    title: "Learners anywhere buy",
    body: "Students, alumni and people who aren't at any institute, in one cart and one payment.",
    Demo: () => (
      <div className={card}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Cart</span>
          <span className="text-muted">3 recordings</span>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {["bg-brand", "bg-[#2f4a72]", "bg-[#a8402c]"].map((c) => (
            <span key={c} className={`aspect-[3/4] w-6 rounded-[1px_3px_3px_1px] ${c}`} />
          ))}
        </div>
        <div className="mt-2 rounded-full bg-gold py-1 text-center text-[10px] font-semibold text-brand-deep">Pay once with UPI</div>
      </div>
    ),
  },
  {
    title: "You're paid, with GST invoices",
    body: "Every sale is invoiced in your institute's name. Refunds, reports and sales sit in one place.",
    Demo: () => (
      <div className={card}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Tax invoice</span>
          <span className="text-muted">Paid</span>
        </div>
        <div className="mt-1.5 space-y-0.5 text-muted">
          <div className="flex justify-between">
            <span>Course fee</span>
            <span className="tabular">₹1,999.00</span>
          </div>
          <div className="flex justify-between">
            <span>CGST 9% + SGST 9%</span>
            <span className="tabular">₹359.82</span>
          </div>
        </div>
        <div className="mt-1 flex justify-between border-t border-line pt-1 font-semibold">
          <span>Total</span>
          <span className="tabular">₹2,358.82</span>
        </div>
      </div>
    ),
  },
];

/**
 * How Zinny works, as one loop: teach, record, list, sell, get paid. A gold thread draws from
 * step to step as the visitor scrolls, and a small book rides along it, so the order reads as
 * one motion rather than five boxes.
 */
export function Loop() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const steps = gsap.utils.toArray<HTMLElement>("[data-step]");
        const thread = root.current!.querySelector<HTMLElement>("[data-thread]")!;
        const token = root.current!.querySelector<HTMLElement>("[data-token]")!;
        gsap.fromTo(
          thread,
          { scaleY: 0 },
          { scaleY: 1, ease: "none", scrollTrigger: { trigger: "[data-steps]", start: "top 70%", end: "bottom 60%", scrub: 0.6 } },
        );
        gsap.fromTo(
          token,
          { top: "0%" },
          { top: "100%", ease: "none", scrollTrigger: { trigger: "[data-steps]", start: "top 70%", end: "bottom 60%", scrub: 0.6 } },
        );
        steps.forEach((step) => {
          gsap.from(step.querySelectorAll("[data-in]"), {
            opacity: 0,
            y: 24,
            duration: 0.7,
            stagger: 0.1,
            ease: "power3.out",
            scrollTrigger: { trigger: step, start: "top 78%" },
          });
          gsap.from(step.querySelector("[data-demo]"), {
            opacity: 0,
            x: 40,
            rotate: 3,
            duration: 0.8,
            ease: "power3.out",
            scrollTrigger: { trigger: step, start: "top 78%" },
          });
        });
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="loop" className={`${css.chalkboard} relative overflow-x-clip py-24 text-canvas sm:py-32`}>
      <div className="mx-auto max-w-[1100px] px-5 sm:px-8">
        <h2 id="loop" className={`${SERIF} ${css.headline} max-w-[16ch] text-[clamp(2.4rem,5vw,4.4rem)] leading-[1.04] tracking-[-0.02em]`}>
          Teach it once. <span className="text-gold">Sell it for years.</span>
        </h2>
        <p className="mt-5 max-w-[36rem] text-[17px] leading-relaxed text-canvas/75">
          Every institute already has its best teaching on video. Zinny turns the classes you run into recordings anyone can buy, without a second tool.
        </p>

        <ol data-steps className="relative mt-16 space-y-16 sm:mt-20 sm:space-y-20">
          <span aria-hidden className="absolute top-2 bottom-2 left-[15px] w-px bg-canvas/15 sm:left-[19px]" />
          <span aria-hidden data-thread className="absolute top-2 bottom-2 left-[15px] w-[2px] origin-top bg-gold sm:left-[19px]" />
          <span aria-hidden data-token className="absolute left-[8px] z-10 h-5 w-4 -translate-y-1/2 rounded-[1px_3px_3px_1px] bg-gold shadow-[0_6px_12px_-4px_rgb(0_0_0/0.6)] sm:left-[12px]" />
          {STEPS.map(({ title, body, Demo }, i) => (
            <li key={title} data-step className="relative grid items-center gap-6 pl-12 sm:grid-cols-[minmax(0,1fr)_17rem] sm:gap-12 sm:pl-16">
              <span aria-hidden className="absolute top-1 left-0 flex size-8 items-center justify-center rounded-full bg-brand-deep text-[13px] font-semibold text-gold ring-2 ring-gold/70 sm:size-10">
                {i + 1}
              </span>
              <div>
                <h3 data-in className={`${SERIF} ${css.accent} text-[clamp(1.6rem,2.6vw,2.2rem)] leading-tight`}>
                  {title}
                </h3>
                <p data-in className="mt-2 max-w-[30rem] text-[16px] leading-relaxed text-canvas/70">
                  {body}
                </p>
              </div>
              <div data-demo aria-hidden className="max-w-[17rem]">
                <Demo />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
