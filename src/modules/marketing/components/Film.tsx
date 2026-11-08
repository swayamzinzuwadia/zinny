"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useRef } from "react";
import { display } from "../fonts";
import css from "../landing.module.css";
import { BOOKS, PIECES, rupees } from "./Desk";

/** The books pulled off the shelf as the film ends, spread over both shelves. Each sits in the first eight of its shelf, which are the ones phones show. */
const PULLED = [2, 14, 5, 17, 7, 13];

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

        // Gold gives way to the shelf, and a shop sign drops in on its chains.
        tl.addLabel("shelf");
        tl.to(word("once"), { autoAlpha: 0, y: -50, duration: 0.3, ease: "power2.in" }, "shelf");
        tl.to("[data-play]", { scale: 0, rotation: 40, duration: 0.45, ease: "back.in(1.6)" }, "shelf");
        tl.to("[data-lecture]", { backgroundColor: "#faf6ea", duration: 0.5 }, "shelf+=0.1");
        gsap.set("[data-spine]", { yPercent: 60, autoAlpha: 0 });
        tl.to("[data-spine]", { yPercent: 0, autoAlpha: 1, duration: 0.45, stagger: 0.012, ease: "back.out(1.3)" }, "shelf+=0.2");
        tl.fromTo("[data-plank]", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power2.out" }, "shelf+=0.2");
        tl.fromTo("[data-sign]", { autoAlpha: 0, y: -240, rotation: -7 }, { autoAlpha: 1, y: 0, rotation: 0, duration: 0.5, ease: "back.out(1.5)" }, "shelf+=0.4");
        tl.set(word("stock"), { autoAlpha: 1 }, "shelf+=0.4");

        // The shelf stays put. Books come off it one at a time and show what they cost, and the line turns to the student.
        tl.addLabel("slide");
        const slideAt = tl.labels.slide;
        tl.to({}, { duration: 2 }, slideAt);
        const spines = gsap.utils.toArray<HTMLElement>("[data-spine]");
        PULLED.forEach((n, turn) => {
          const at = slideAt + turn * 0.3;
          const tag = spines[n].querySelector("[data-tag]");
          tl.to(spines[n], { y: -22, duration: 0.1, ease: "power2.out" }, at);
          tl.fromTo(tag, { autoAlpha: 0, y: 6, scale: 0.85 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.1, ease: "back.out(2)" }, at);
          tl.to(spines[n], { y: 0, duration: 0.12, ease: "power2.in" }, at + 0.2);
          tl.to(tag, { autoAlpha: 0, duration: 0.08 }, at + 0.2);
        });
        // Halfway through, the sign turns over to the learner's side, and swings a little from the turn.
        tl.to("[data-sign-board]", { rotationX: 90, duration: 0.15, ease: "power2.in" }, "slide+=0.75");
        tl.set(word("stock"), { autoAlpha: 0 }, "slide+=0.9");
        tl.set(word("anyone"), { autoAlpha: 1 }, "slide+=0.9");
        tl.fromTo("[data-sign-board]", { rotationX: -90 }, { rotationX: 0, duration: 0.25, ease: "back.out(1.8)" }, "slide+=0.9");
        tl.fromTo("[data-sign]", { rotation: 2.5 }, { rotation: 0, duration: 0.6, ease: "elastic.out(1, 0.35)" }, "slide+=0.9");
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

          {/* A shop sign on two chains. It turns over from the institute's side to the learner's. */}
          <div data-sign className={css.sign}>
            <span aria-hidden className={`${css.chain} left-[18%]`} />
            <span aria-hidden className={`${css.chain} right-[18%]`} />
            <div data-sign-board className={`${display.className} ${css.headline} ${css.signBoard}`}>
              <p data-beat="stock" className={css.signLine}>
                Institutes stock <em className="text-gold">the shelf.</em>
              </p>
              <p data-beat="anyone" className={css.signLine}>
                Anyone can learn <em className="text-gold">from it.</em>
              </p>
            </div>
          </div>

          <div className={css.shelf}>
            <div role="img" aria-label="A bookcase stocked with recorded courses from institutes" className={css.case}>
              {[BOOKS.slice(0, 12), BOOKS.slice(12)].map((shelf, s) => (
                <div key={s}>
                  <div className={css.row}>
                    {shelf.map((b) => (
                      <span key={b.title} data-spine className={css.slot} style={{ "--h": b.height, "--w": b.width } as React.CSSProperties}>
                        <span className={css.lift}>
                          <span className={css.tagWrap}>
                            <span data-tag className={css.tag}>
                              <b className="font-semibold text-gold">{rupees(b.price)}</b> · {b.lessons} lessons · {b.institute}
                            </span>
                          </span>
                          <span className={`${css.spine} ${b.tone}`}>
                            <span aria-hidden className="absolute inset-x-0 top-4 h-px bg-current opacity-30" />
                            <span aria-hidden className="absolute inset-x-0 top-5 h-px bg-current opacity-30" />
                            <span className={`${display.className} ${css.spineText} ${css.accent} text-[15px] leading-tight whitespace-nowrap sm:text-[17px]`}>{b.title}</span>
                          </span>
                        </span>
                      </span>
                    ))}
                  </div>
                  <div data-plank className={css.plank} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
