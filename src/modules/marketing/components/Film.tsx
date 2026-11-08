"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useRef } from "react";
import { display } from "../fonts";
import css from "../landing.module.css";
import { PIECES, rupees } from "./Desk";

/**
 * The orders that come in once a recording is listed: who bought what, and from where, newest
 * first. An illustration, which the caption under the counter says. Short screens show four.
 */
const ORDERS = [
  { name: "Ananya", city: "Pune", item: "the full course", amount: 1499, when: "Just now" },
  { name: "Rahul", city: "Guwahati", item: "the full course", amount: 1499, when: "4 min ago" },
  { name: "Fatima", city: "Hyderabad", item: "Lecture 7: Functions", amount: 199, when: "11 min ago" },
  { name: "Imran", city: "Dubai", item: "the full course", amount: 1499, when: "26 min ago" },
  { name: "Meera", city: "Jaipur", item: "the Python and SQL combo", amount: 2499, when: "40 min ago" },
  { name: "Arjun", city: "Kochi", item: "the full course", amount: 1499, when: "1 h ago" },
];
const PRICE = 1499;
const SALES = 280;
const EARNED = PRICE * SALES;

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

/*
 * The second act of the page, after the pitch: what changes for an institute. Scrolling sorts it out. A sticky stage plays one timeline
 * tied to the scrollbar. The mess flies into the app, a chalkboard wipes in, the forgotten
 * recordings burst open, and they become the marketplace. Sticky rather than a GSAP pin, so
 * section links keep working and phones don't jump when the address bar moves.
 *
 * With reduced motion none of this runs, and landing.module.css lays the same content out
 * as a plain page.
 */

export function Film() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      // Phones: don't recalculate the film when the address bar slides away, or it jumps.
      ScrollTrigger.config({ ignoreMobileResize: true });
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const stage = root.current!.querySelector<HTMLElement>("[data-stage]")!;
        const pieces = gsap.utils.toArray<HTMLElement>("[data-piece]");
        const tiles = gsap.utils.toArray<HTMLElement>("[data-tile]");
        const slots = gsap.utils.toArray<HTMLElement>("[data-slot]");
        const word = (name: string) => stage.querySelector<HTMLElement>(`[data-beat="${name}"]`)!;

        pieces.forEach((el, i) => gsap.set(el, { xPercent: -50, yPercent: -50, rotation: PIECES[i].tilt, visibility: "visible" }));
        gsap.set("[data-beat]", { autoAlpha: 0 });

        const headline = SplitText.create("[data-mess-title]", { type: "words,lines", mask: "lines" });
        const order = SplitText.create("[data-order-title]", { type: "chars,words" });

        /* ── As the desk scrolls into view: the title rises, the scraps rain down onto it ── */
        const arrive = gsap.timeline({ scrollTrigger: { trigger: root.current, start: "top 65%", once: true } });
        arrive
          .from(headline.words, { yPercent: 110, duration: 1, stagger: 0.035, ease: "expo.out" }, 0)
          .from("[data-desk-line]", { autoAlpha: 0, y: 16, duration: 0.7, ease: "power3.out" }, 0.4)
          .from("[data-face]", { y: () => -window.innerHeight, rotation: () => gsap.utils.random(-30, 30), duration: 1.1, stagger: { each: 0.07, from: "random" }, ease: "back.out(1.1)" }, 0.2)
          .from("[data-cue]", { autoAlpha: 0, y: 12, duration: 0.6 }, 1.3);

        /* ── While it sits there, the desk stays alive ── */
        gsap.utils.toArray<HTMLElement>("[data-idle]").forEach((el, i) => {
          gsap.to(el, { y: "+=9", rotation: i % 2 ? "+=1.4" : "-=1.4", duration: 2.2 + (i % 4) * 0.5, ease: "sine.inOut", repeat: -1, yoyo: true });
        });
        const unread = { n: 142 };
        const badge = stage.querySelector<HTMLElement>("[data-unread]");
        gsap.to(unread, { n: 199, duration: 60, ease: "none", onUpdate: () => badge && (badge.textContent = String(Math.round(unread.n))) });
        gsap.to("[data-cue-arrow]", { y: 6, duration: 0.8, ease: "sine.inOut", repeat: -1, yoyo: true });

        /* ── The cursor pushes the scraps around, nearer ones more ── */
        const movers = gsap.utils.toArray<HTMLElement>("[data-para]").map((el, i) => ({
          x: gsap.quickTo(el, "x", { duration: 0.9, ease: "power3" }),
          y: gsap.quickTo(el, "y", { duration: 0.9, ease: "power3" }),
          depth: PIECES[i].depth,
        }));
        const move = (e: PointerEvent) => {
          const dx = e.clientX / window.innerWidth - 0.5;
          const dy = e.clientY / window.innerHeight - 0.5;
          movers.forEach((m) => {
            m.x(dx * -44 * m.depth);
            m.y(dy * -32 * m.depth);
          });
        };
        window.addEventListener("pointermove", move, { passive: true });

        /* ── The film ── */
        const tl = gsap.timeline({
          defaults: { ease: "none" },
          scrollTrigger: { trigger: root.current, start: "top top", end: "bottom bottom", scrub: 0.7, invalidateOnRefresh: true },
        });

        const stageBox = () => stage.getBoundingClientRect();
        const centre = (i: number) => {
          const s = stageBox();
          const b = slots[i].getBoundingClientRect();
          return { x: b.left - s.left + b.width / 2, y: b.top - s.top + b.height / 2, width: b.width };
        };

        // Sorting: the title leaves, then each scrap flies home and turns into its tile.
        tl.to("[data-cue]", { autoAlpha: 0, duration: 0.15 }, 0);
        tl.to(["[data-mess-title]", "[data-desk-line]"], { yPercent: -60, autoAlpha: 0, duration: 0.5, ease: "power2.in" }, 0.15);

        const flight = [6, 8, 3, 0, 9, 5, 2, 10, 7, 1, 4, 11];
        flight.forEach((i, turn) => {
          const el = pieces[i];
          const start = 0.3 + turn * 0.13;
          tl.to(
            el,
            {
              x: () => centre(i).x - el.offsetLeft,
              y: () => centre(i).y - el.offsetTop,
              scale: () => (centre(i).width / el.offsetWidth) * 0.8,
              rotation: 0,
              duration: 0.8,
              ease: "power3.inOut",
            },
            start,
          );
          tl.to(el, { autoAlpha: 0, duration: 0.06 }, start + 0.76);
          tl.fromTo(tiles[i], { autoAlpha: 0, scale: 0.62 }, { autoAlpha: 1, scale: 1, duration: 0.22, ease: "back.out(2.4)" }, start + 0.72);
        });

        // The chalkboard wipes in behind them.
        tl.fromTo("[data-board]", { clipPath: "circle(0% at 50% 58%)" }, { clipPath: "circle(145% at 50% 58%)", duration: 1.35, ease: "power2.inOut" }, 0.65);
        // Staggers on a scrubbed timeline only hold back their first item, so everything starts hidden here.
        gsap.set(order.chars, { yPercent: 70, autoAlpha: 0 });
        tl.to(order.chars, { yPercent: 0, autoAlpha: 1, stagger: 0.012, duration: 0.3, ease: "back.out(1.8)" }, 2.25);
        tl.fromTo("[data-order-line]", { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "power2.out" }, 2.6);

        // The gold now line runs across the finished board.
        tl.addLabel("sorted", 2.9);
        tl.fromTo("[data-sweep]", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power2.inOut" }, "sorted");
        tl.to({}, { duration: 0.35 });

        // The turn: everything dims except the forgotten recordings, which burst open.
        tl.addLabel("turn");
        tiles.slice(0, -1).forEach((t) => tl.to(t, { opacity: 0.2, duration: 0.3 }, "turn"));
        tl.to(["[data-order-title]", "[data-order-line]"], { opacity: 0.2, duration: 0.3 }, "turn");
        tl.to(tiles[tiles.length - 1], { scale: 1.08, duration: 0.3, ease: "power2.out" }, "turn");

        const fromTile = () => {
          const s = stageBox();
          const b = slots[slots.length - 1].getBoundingClientRect();
          return `inset(${b.top - s.top}px ${s.right - b.right}px ${s.bottom - b.bottom}px ${b.left - s.left}px round 18px)`;
        };
        tl.addLabel("burst", "turn+=0.35");
        tl.set("[data-lecture]", { visibility: "visible" }, "burst");
        tl.fromTo("[data-lecture]", { clipPath: fromTile }, { clipPath: "inset(0px 0px 0px 0px round 0px)", duration: 0.8, ease: "power3.inOut" }, "burst");
        tl.fromTo("[data-play]", { scale: 0.25, rotation: -18 }, { scale: 1, rotation: 0, duration: 0.8, ease: "power3.inOut" }, "burst");

        // One line, edited: "once" is crossed out by hand, and the correction is written under it.
        tl.fromTo(word("once"), { autoAlpha: 0, y: 50 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: "power3.out" }, "burst+=0.55");
        tl.fromTo("[data-strike]", { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.3, ease: "power2.inOut" }, ">+=0.3");
        tl.fromTo("[data-keeps]", { autoAlpha: 0, y: 24, rotation: -2 }, { autoAlpha: 1, y: 0, rotation: 0, duration: 0.35, ease: "back.out(1.6)" }, ">+=0.05");
        tl.to({}, { duration: 0.45 });

        // The lights go down: gold turns to night, and the recording is on sale.
        tl.addLabel("wall");
        tl.to(word("once"), { autoAlpha: 0, y: -50, duration: 0.3, ease: "power2.in" }, "wall");
        tl.to("[data-play]", { scale: 0.18, rotation: 0, autoAlpha: 0, duration: 0.45, ease: "power3.in" }, "wall");
        tl.to("[data-lecture]", { backgroundColor: "#04291f", color: "#faf6ea", duration: 0.5 }, "wall+=0.1");
        tl.fromTo(word("every"), { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: "power3.out" }, "wall+=0.3");
        tl.fromTo("[data-store]", { autoAlpha: 0, y: 80, rotation: 3 }, { autoAlpha: 1, y: 0, rotation: 0, duration: 0.5, ease: "power3.out" }, "wall+=0.35");

        // The sales come in: each order drops in at the top of the feed and pushes the older ones
        // down, and the year's total climbs beside it.
        tl.addLabel("earn");
        tl.to({}, { duration: 2 }, "earn");
        tl.fromTo("[data-order]", { height: 0, autoAlpha: 0 }, { height: "auto", autoAlpha: 1, duration: 0.18, stagger: { each: 0.28, from: "end" }, ease: "power2.out" }, "earn+=0.1");
        tl.fromTo("[data-earned-block]", { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "power3.out" }, "earn");
        const earned = stage.querySelector<HTMLElement>("[data-earned]");
        const total = { v: 0 };
        tl.fromTo(total, { v: 0 }, { v: EARNED, duration: 1.8, ease: "power1.in", onUpdate: () => earned && (earned.textContent = rupees(Math.round(total.v))) }, "earn+=0.1");
        tl.to({}, { duration: 0.5 });

        return () => {
          window.removeEventListener("pointermove", move);
          headline.revert();
          order.revert();
        };
      });
    },
    { scope: root },
  );

  return (
    <div ref={root} className={css.film}>

      <div data-stage className={css.stage}>
        {/* ── The desk ── */}
        <div className={`${css.desk} absolute inset-0`} />
        <div className="absolute inset-x-0 top-1/2 z-20 mx-auto max-w-[23rem] -translate-y-[58%] px-5 text-center sm:max-w-[46rem] xl:max-w-[54rem]">
          <h2 data-mess-title className={`${display.className} ${css.headline} text-[clamp(2.6rem,6vw,6rem)] leading-[1.14] tracking-[-0.025em] text-ink`}>
            Your institute is held together by WhatsApp.
          </h2>
          <p data-desk-line className="mx-auto mt-5 max-w-[34rem] text-[17px] leading-relaxed text-ink/75">
            Fees in a spreadsheet, the timetable on paper, parents in a group chat, recordings nobody watches again.
          </p>
        </div>
        {/* A hint, not a control: plain text, so it isn't mistaken for a button. */}
        <div data-cue aria-hidden className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex flex-col items-center gap-1 text-[14px] font-medium text-ink/70">
          <span>Keep scrolling to sort it out</span>
          <svg data-cue-arrow aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 8l5 5 5-5" />
          </svg>
        </div>

        {/* ── The chalkboard: the same things, in order ── */}
        <div data-board className={`${css.board} ${css.chalkboard} text-canvas`}>
          <div className="mx-auto flex h-full max-w-[1120px] flex-col justify-center gap-6 px-4 pt-20 pb-6 sm:gap-9 sm:px-8">
            <h2 data-order-title className={`${display.className} ${css.headline} text-center text-[clamp(2.25rem,5.4vw,5.25rem)] leading-[1] tracking-[-0.022em]`}>
              The whole institute, <em className="text-gold">in order.</em>
            </h2>
            <p data-order-line className="-mt-2 text-center text-[15px] text-canvas/70 sm:-mt-4 sm:text-[17px]">
              Every scrap on that desk is now one part of Zinny.
            </p>
            <div className="relative">
              <ul className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-4">
                {PIECES.map((p, i) => (
                  <li key={p.id} data-slot>
                    <div
                      data-tile
                      className={`flex h-full min-h-[84px] flex-col justify-between rounded-2xl p-2.5 sm:min-h-[104px] sm:p-4 ${i === PIECES.length - 1 ? "bg-gold text-brand-deep" : "bg-canvas/[0.09] ring-1 ring-canvas/10"}`}
                    >
                      <span className="text-[14px] leading-tight font-medium sm:text-[17px]">{p.tile}</span>
                      <span className={`mt-1 hidden text-[13px] leading-snug sm:block ${i === PIECES.length - 1 ? "text-brand-deep/75" : "text-canvas/60"}`}>{p.note}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <span data-sweep aria-hidden className="absolute -bottom-3 left-0 h-[2px] w-full origin-left rounded-full bg-gold sm:-bottom-4" />
            </div>
          </div>
        </div>

        {/* ── The scraps, above everything until they land ── */}
        {PIECES.map((p) => (
          <div
            key={p.id}
            data-piece
            aria-hidden
            className={css.piece}
            style={{ "--x": `${p.x}%`, "--y": `${p.y}%`, "--mx": `${p.mx}%`, "--my": `${p.my}%`, width: p.width } as React.CSSProperties}
          >
            <div data-para>
              <div data-idle>
                <div data-face className={css.pieceFace}>
                  <p.Face />
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* ── The recordings burst open, and become the marketplace ── */}
        <div data-lecture className={`${css.lecture} bg-gold text-brand-deep`}>
          <svg data-play aria-hidden viewBox="0 0 100 100" className={css.play}>
            <path d="M24 12 L90 50 L24 88 Z" fill="currentColor" stroke="currentColor" strokeWidth="10" strokeLinejoin="round" />
          </svg>

          <div className={css.beats}>
            {/* An edit, not two slides: "once" is struck out and the correction is written beneath. */}
            <div data-beat="once" className={`${display.className} ${css.headline} ${css.beat}`}>
              <p>
                You taught it{" "}
                <span className="relative inline-block">
                  <em>once.</em>
                  <svg aria-hidden viewBox="0 0 100 20" preserveAspectRatio="none" className={css.strike}>
                    <path data-strike d="M2 13 C 22 6, 48 15, 70 9 S 92 8, 98 10" pathLength={1} />
                  </svg>
                </span>
              </p>
              <p data-keeps className={css.keeps}>
                It keeps <em>teaching.</em>
              </p>
            </div>
          </div>

          {/* ── Night falls: the recording is on the marketplace, and the orders come in ── */}
          <div className={css.saleScene}>
            <div>
              <h2 data-beat="every" className={`${display.className} ${css.headline} text-[clamp(2.3rem,5.2vw,4.8rem)] leading-[1] tracking-[-0.025em]`}>
                Listed once.
                <br />
                <em className="text-gold">Sold while you teach.</em>
              </h2>
              <p className="mt-4 hidden max-w-[27rem] text-[16px] leading-relaxed text-canvas/70 sm:block">
                Put a recording on the Zinny marketplace and learners anywhere can buy it. Every sale shows up here, with its GST invoice already sent.
              </p>
              <div data-earned-block className="mt-6 sm:mt-10">
                <p className="text-[13px] text-canvas/60">This year, from one course</p>
                <p data-earned className={`${display.className} ${css.headline} mt-1 text-[clamp(2.2rem,4.8vw,4.4rem)] leading-none tracking-[-0.02em] text-gold [font-variant-numeric:lining-nums_tabular-nums]`}>
                  {rupees(EARNED)}
                </p>
                <p className="mt-2 text-[12px] text-canvas/50">
                  An example: {SALES} sales at {rupees(PRICE)}, before GST.
                </p>
              </div>
            </div>

            <div data-store className={css.store}>
              {/* The listing as learners see it on the marketplace. */}
              <div className="flex gap-4 border-b border-line bg-surface p-4 sm:p-5">
                <div aria-hidden className="relative h-[76px] w-[57px] shrink-0 overflow-hidden rounded-[2px_6px_6px_2px] bg-brand text-canvas shadow-[0_10px_18px_-10px_rgb(6_58_47/0.7)]">
                  <span className="absolute inset-y-0 left-0 w-[7%] bg-black/20" />
                  <span className={`${display.className} absolute inset-x-0 bottom-2 pr-1.5 pl-2.5 text-[10px] leading-tight font-semibold`}>Python Basics</span>
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] text-muted">Your institute · on the Zinny marketplace</p>
                  <p className="mt-0.5 text-[16px] leading-snug font-semibold">Python Basics: the full recordings</p>
                  <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[14px]">
                    <span className="font-semibold">{rupees(PRICE)}</span>
                    <s className="text-muted">₹2,999</s>
                    <span className="rounded-full bg-brand-soft px-2 text-[11px] font-medium text-brand">24 lessons · 9 h</span>
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between px-4 pt-3.5 pb-1.5 text-[13px] sm:px-5">
                <span className="font-semibold">Sales</span>
                <span className="flex items-center gap-1.5 text-muted">
                  <span aria-hidden className="size-2 rounded-full bg-gold" />
                  Live
                </span>
              </div>
              <ul aria-label="Recent orders">
                {ORDERS.map((o) => (
                  <li key={o.name} data-order className={css.order}>
                    <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 sm:px-5">
                      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand">
                        {o.name[0]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px]">
                          <b className="font-semibold">{o.name}</b> bought {o.item}
                        </p>
                        <p className="text-[12px] text-muted">
                          {o.city} · {o.when}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular text-[14px] font-semibold">{rupees(o.amount)}</p>
                        <p className="text-[11px] text-brand">Invoice sent</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
