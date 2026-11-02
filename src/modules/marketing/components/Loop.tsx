"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useRef } from "react";
import { display } from "../fonts";
import css from "../landing.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const SERIF = display.className;

const card = "rounded-xl bg-surface p-3.5 text-[12px] text-ink shadow-[0_18px_36px_-20px_rgb(0_0_0/0.6),0_0_0_1px_rgb(20_38_31/0.07)]";

/*
 * Each step's little screen performs when the step arrives. The marks it uses:
 * data-pop (scales up in turn), data-print (prints from the top), data-draw (draws left to
 * right), data-stamp (lands like a stamp), data-count (counts up to its number).
 */
const STEPS = [
  {
    title: "Teach your batches",
    body: "Timetables, live classes, attendance and tests for every batch you run.",
    Demo: () => (
      <div className={card}>
        <div className="flex items-center justify-between">
          <span className="font-semibold">Python Basics · Batch B</span>
          <span data-stamp className="rounded-full bg-gold px-1.5 text-[10px] font-semibold text-brand-deep">
            Live
          </span>
        </div>
        <div className="mt-2.5 flex gap-1">
          {[1, 1, 1, 0, 1, 1, 1, 1].map((p, i) => (
            <span key={i} data-pop className={`h-5 flex-1 rounded-sm ${p ? "bg-brand" : "bg-danger/70"}`} />
          ))}
        </div>
        <div className="mt-2 text-muted">
          <span data-count="7">7</span> of 8 present
        </div>
      </div>
    ),
  },
  {
    title: "Upload the recordings",
    body: "Each class becomes a lesson in the course, with progress saved for every student.",
    Demo: () => (
      <div className={card}>
        {["Variables and types", "Loops, properly", "Functions"].map((t, i) => (
          <div key={t} data-pop className="flex items-center gap-2 py-1">
            <span className={`flex size-4 items-center justify-center rounded-full text-canvas ${i < 2 ? "bg-brand" : "bg-faint"}`}>
              <svg viewBox="0 0 8 8" className="ml-px size-2" fill="currentColor">
                <path d="M2 1.2v5.6L6.8 4z" />
              </svg>
            </span>
            <span className="truncate">{t}</span>
            <span className="ml-auto text-muted">{[18, 24, 21][i]} min</span>
          </div>
        ))}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <span data-draw className="block h-full w-2/3 origin-left rounded-full bg-brand" />
        </div>
      </div>
    ),
  },
  {
    title: "List them on the marketplace",
    body: "A whole course, one lecture or a combo, at your price, with deals and discount codes.",
    Demo: () => (
      <div className={card}>
        <div className="font-semibold">Python Basics: the full recordings</div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-[16px] font-semibold">₹1,999</span>
          <s className="text-muted">₹2,999</s>
          <span data-stamp className="ml-auto rounded-full bg-gold px-2 text-[10px] font-semibold text-brand-deep">
            33% off
          </span>
        </div>
        <div data-pop className="mt-2.5 rounded-full bg-brand py-1.5 text-center text-[11px] font-medium text-canvas">
          On sale now
        </div>
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
          <span className="text-muted">
            <span data-count="3">3</span> recordings
          </span>
        </div>
        <div className="mt-2 flex gap-1.5">
          {["bg-brand", "bg-[#2f4a72]", "bg-[#a8402c]"].map((c) => (
            <span key={c} data-pop className={`aspect-[3/4] w-8 rounded-[1px_3px_3px_1px] ${c} shadow-[0_6px_10px_-6px_rgb(0_0_0/0.6)]`} />
          ))}
        </div>
        <div data-stamp className="mt-2.5 rounded-full bg-gold py-1.5 text-center text-[11px] font-semibold text-brand-deep">
          Pay once with UPI
        </div>
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
          <span data-stamp className="rounded-full bg-brand-soft px-1.5 text-[10px] font-semibold text-brand">
            Paid
          </span>
        </div>
        <div data-print className="mt-2 space-y-0.5 text-muted">
          <div className="flex justify-between">
            <span>Course fee</span>
            <span className="tabular">₹1,999.00</span>
          </div>
          <div className="flex justify-between">
            <span>CGST 9% + SGST 9%</span>
            <span className="tabular">₹359.82</span>
          </div>
          <div className="flex justify-between border-t border-line pt-1 font-semibold text-ink">
            <span>Total</span>
            <span className="tabular">₹2,358.82</span>
          </div>
        </div>
      </div>
    ),
  },
];

/** Plays one step's little screen: things pop in, print, draw, stamp and count. */
function perform(step: HTMLElement) {
  const tl = gsap.timeline({ paused: true });
  const q = (s: string) => step.querySelectorAll<HTMLElement>(s);
  tl.from(q("[data-pop]"), { scale: 0, opacity: 0, duration: 0.4, stagger: 0.06, ease: "back.out(2.2)" }, 0)
    .from(q("[data-print]"), { clipPath: "inset(0 0 100% 0)", duration: 0.8, ease: "power2.inOut" }, 0.1)
    .from(q("[data-draw]"), { scaleX: 0, duration: 0.9, ease: "power2.inOut" }, 0.2)
    .from(q("[data-stamp]"), { scale: 2.4, rotate: -14, opacity: 0, duration: 0.45, stagger: 0.1, ease: "back.out(2.4)" }, 0.45);
  q("[data-count]").forEach((n) => {
    const to = Number(n.dataset.count);
    const c = { v: 0 };
    tl.to(c, { v: to, duration: 0.7, ease: "power1.out", onUpdate: () => (n.textContent = String(Math.round(c.v))) }, 0.1);
  });
  return tl;
}

/**
 * How Zinny works, as one journey: teach, record, list, sell, get paid. On a wide screen the
 * section holds still while the scroll carries the steps across it, a gold thread drawing
 * under them with a book riding along, and each step's screen performs as it reaches the
 * middle. On a phone the steps run down the page and perform as they come into view.
 */
export function Loop() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current!;
      const steps = gsap.utils.toArray<HTMLElement>("[data-step]");
      const mm = gsap.matchMedia();

      mm.add({ wide: "(min-width: 1024px)", narrow: "(max-width: 1023px)", reduce: "(prefers-reduced-motion: reduce)" }, (ctx) => {
        const { wide, reduce } = ctx.conditions as { wide: boolean; reduce: boolean };
        if (reduce) return;
        const shows = steps.map(perform);
        const track = el.querySelector<HTMLElement>("[data-track]")!;
        const thread = el.querySelector<HTMLElement>("[data-thread]")!;
        const token = el.querySelector<HTMLElement>("[data-token]")!;

        if (wide) {
          const distance = () => track.scrollWidth - el.querySelector<HTMLElement>("[data-viewport]")!.clientWidth;
          const ride = gsap.timeline({
            defaults: { ease: "none" },
            scrollTrigger: { trigger: el, pin: true, start: "top top", end: () => `+=${distance() + window.innerHeight * 0.4}`, scrub: 0.8, invalidateOnRefresh: true },
          });
          ride.to(track, { x: () => -distance(), duration: 1 }, 0).fromTo(thread, { scaleX: 0 }, { scaleX: 1, duration: 1 }, 0).fromTo(token, { left: "0%" }, { left: "100%", duration: 1 }, 0);
          steps.forEach((step, i) => {
            ScrollTrigger.create({
              trigger: step,
              containerAnimation: ride,
              start: "left 70%",
              onEnter: () => shows[i].restart(),
              onLeaveBack: () => shows[i].pause(0),
            });
            gsap.from(step.querySelector("[data-card]"), { y: 40, rotate: 4, opacity: 0, ease: "power2.out", scrollTrigger: { trigger: step, containerAnimation: ride, start: "left 95%", end: "left 65%", scrub: true } });
          });
        } else {
          gsap.fromTo(thread, { scaleY: 0 }, { scaleY: 1, ease: "none", scrollTrigger: { trigger: track, start: "top 70%", end: "bottom 60%", scrub: 0.6 } });
          gsap.fromTo(token, { top: "0%" }, { top: "100%", ease: "none", scrollTrigger: { trigger: track, start: "top 70%", end: "bottom 60%", scrub: 0.6 } });
          steps.forEach((step, i) => {
            ScrollTrigger.create({ trigger: step, start: "top 75%", onEnter: () => shows[i].restart(), onLeaveBack: () => shows[i].pause(0) });
            gsap.from(step.querySelector("[data-card]"), { y: 30, opacity: 0, duration: 0.7, ease: "power3.out", scrollTrigger: { trigger: step, start: "top 80%" } });
          });
        }
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="loop" className={`${css.chalkboard} relative overflow-x-clip text-canvas lg:flex lg:h-dvh lg:flex-col lg:justify-center`}>
      <div className="mx-auto w-full max-w-[1240px] px-5 pt-24 sm:px-8 sm:pt-28 lg:pt-20">
        <h2 id="loop" className={`${SERIF} ${css.headline} max-w-[18ch] text-[clamp(2.4rem,5vw,4.4rem)] leading-[1.04] tracking-[-0.02em]`}>
          Teach it once. <span className="text-gold">Sell it for years.</span>
        </h2>
        <p className="mt-4 max-w-[36rem] text-[17px] leading-relaxed text-canvas/75">
          Every institute already has its best teaching on video. Zinny turns the classes you run into recordings anyone can buy, without a second tool.
        </p>
      </div>

      <div data-viewport className="relative mx-auto w-full max-w-[1240px] px-5 pt-14 pb-24 sm:px-8 lg:overflow-visible lg:pt-12 lg:pb-16">
        {/* The thread: down the left on a phone, along the top of the steps on a wide screen. */}
        <span aria-hidden className="absolute top-14 bottom-24 left-[35px] w-px bg-canvas/15 sm:left-[47px] lg:top-[3.75rem] lg:right-8 lg:bottom-auto lg:left-8 lg:h-px lg:w-auto" />
        <span aria-hidden data-thread className="absolute top-14 bottom-24 left-[35px] w-[2px] origin-top bg-gold sm:left-[47px] lg:top-[3.75rem] lg:right-8 lg:bottom-auto lg:left-8 lg:h-[2px] lg:w-auto lg:origin-left" />
        <span aria-hidden className="pointer-events-none absolute top-14 bottom-24 left-[28px] sm:left-[40px] lg:top-[3.1rem] lg:right-8 lg:bottom-auto lg:left-8 lg:h-5">
          <span data-token className="absolute h-5 w-4 -translate-y-1/2 rounded-[1px_3px_3px_1px] bg-gold shadow-[0_6px_12px_-4px_rgb(0_0_0/0.6)] lg:top-1/2 lg:-translate-x-1/2" />
        </span>

        <ol data-track className="relative space-y-16 lg:flex lg:w-max lg:gap-10 lg:space-y-0 lg:pr-[30vw]">
          {STEPS.map(({ title, body, Demo }, i) => (
            <li key={title} data-step className="relative pl-12 sm:pl-16 lg:w-[22rem] lg:pt-14 lg:pl-0">
              <span
                aria-hidden
                className="absolute top-0 left-0 flex size-8 items-center justify-center rounded-full bg-brand-deep text-[13px] font-semibold text-gold ring-2 ring-gold/70 sm:size-10 lg:-top-0.5 lg:left-0"
              >
                {i + 1}
              </span>
              <div data-card>
                <h3 className={`${SERIF} ${css.accent} text-[clamp(1.6rem,2.4vw,2.1rem)] leading-tight`}>{title}</h3>
                <p className="mt-2 max-w-[30rem] text-[16px] leading-relaxed text-canvas/70">{body}</p>
                <div aria-hidden className="mt-5 max-w-[18rem]">
                  <Demo />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
