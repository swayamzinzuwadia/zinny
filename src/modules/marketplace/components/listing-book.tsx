"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

gsap.registerPlugin(useGSAP);

/** Light falling into the gutter where the pages meet the spine. */
const GUTTER_LEFT: CSSProperties = { backgroundImage: "linear-gradient(to left, rgb(20 38 31 / 0.13), rgb(20 38 31 / 0) 7%)" };
const GUTTER_RIGHT: CSSProperties = { backgroundImage: "linear-gradient(to right, rgb(20 38 31 / 0.13), rgb(20 38 31 / 0) 7%)" };
/** The desk lamp: a warm pool of light the book is opened under. */
const LAMP: CSSProperties = { backgroundImage: "radial-gradient(ellipse 55% 60% at 50% 38%, rgb(212 167 42 / 0.26), rgb(212 167 42 / 0.08) 45%, transparent 72%)" };

/** Dust drifting up through the lamp light. Paused when the book is off screen or the tab is hidden. */
function Dust() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current!;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = el.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const size = () => {
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = w * dpr;
      el.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const motes = Array.from({ length: 42 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.6, v: 0.04 + Math.random() * 0.09, drift: Math.random() * Math.PI * 2, a: 0.15 + Math.random() * 0.45 }));
    let raf = 0;
    let on = true;
    const tick = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.y -= m.v / h;
        if (m.y < -0.02) {
          m.y = 1.02;
          m.x = Math.random();
        }
        const x = (m.x + Math.sin(t / 2600 + m.drift) * 0.012) * w;
        // Brightest in the middle of the light, fading towards the edges.
        const glow = Math.max(0, 1 - Math.hypot(m.x - 0.5, (m.y - 0.38) * 0.9) * 1.7);
        ctx.fillStyle = `rgba(247, 226, 160, ${m.a * glow})`;
        ctx.beginPath();
        ctx.arc(x, m.y * h, m.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (on) raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      on = e.isIntersecting && !document.hidden;
      cancelAnimationFrame(raf);
      if (on) raf = requestAnimationFrame(tick);
    });
    io.observe(el);
    window.addEventListener("resize", size);
    return () => {
      on = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("resize", size);
    };
  }, []);
  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}

/**
 * The listing page is the book, open on the desk under a lamp. Everything on it is there from
 * the first paint, so the price and "Buy now" never wait: the lamp comes up, each lesson
 * slides in with its dotted leader drawing across to its length, and the deal lands as a
 * stamp. Those entrances are CSS, so nothing on the page blinks out when the script loads.
 * After that the book stays alive: it leans towards the pointer, its ribbon marker sways, the
 * lamp breathes. Reduced motion keeps it all still.
 *
 * Marks it reads in `left` and `right`: data-ink-line (a contents row, with `--i` its place in
 * the list), data-leader (its dotted line), data-stamp (the deal).
 */
export function ListingBook({ left, right }: { left: ReactNode; right: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current!;
      const q = (s: string) => el.querySelector<HTMLElement>(s)!;
      const tilt = q("[data-tilt]");
      const lamp = q("[data-lamp]");
      const ribbon = q("[data-ribbon]");

      const mm = gsap.matchMedia();
      // `always` makes the callback run on every screen: matchMedia only calls it when some condition matches.
      mm.add({ always: "(min-width: 0px)", wide: "(min-width: 1024px)", fine: "(pointer: fine)", reduce: "(prefers-reduced-motion: reduce)" }, (ctx) => {
        const { wide, fine, reduce } = ctx.conditions as { wide: boolean; fine: boolean; reduce: boolean };
        if (reduce) {
          gsap.set(lamp, { opacity: 1 });
          return;
        }

        // The lamp comes up; then the ribbon sways and the lamp breathes.
        gsap.fromTo(lamp, { opacity: 0 }, { opacity: 1, duration: 0.9, ease: "power1.out" });
        gsap.to(ribbon, { rotate: 3.5, duration: 2.2, ease: "sine.inOut", yoyo: true, repeat: -1, transformOrigin: "50% 0%", delay: 0.8 });
        gsap.to(lamp, { opacity: 0.82, duration: 3.4, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 1 });

        // On a wide screen with a mouse, the open book leans a little towards the pointer and the light follows.
        if (wide && fine) {
          const rx = gsap.quickTo(tilt, "rotateX", { duration: 0.8, ease: "power3.out" });
          const ry = gsap.quickTo(tilt, "rotateY", { duration: 0.8, ease: "power3.out" });
          const lx = gsap.quickTo(lamp, "x", { duration: 1.2, ease: "power3.out" });
          const move = (e: PointerEvent) => {
            const r = el.getBoundingClientRect();
            const nx = (e.clientX - r.left) / r.width - 0.5;
            const ny = (e.clientY - r.top) / r.height - 0.5;
            rx(-ny * 4);
            ry(nx * 5);
            lx(nx * 40);
          };
          const leave = () => {
            rx(0);
            ry(0);
            lx(0);
          };
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerleave", leave);
          return () => {
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerleave", leave);
          };
        }
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="relative">
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes zinny-line-in { from { opacity: 0; translate: -8px 0; } }
          @keyframes zinny-leader-in { from { scale: 0 1; } }
          @keyframes zinny-stamp-in { from { opacity: 0; scale: 2.2; rotate: -16deg; } }
          @keyframes zinny-ribbon-in { from { scale: 1 0; } }
          [data-book] [data-ink-line] { animation: zinny-line-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; animation-delay: calc(0.15s + var(--i, 0) * 35ms); }
          [data-book] [data-leader] { transform-origin: 0% 50%; animation: zinny-leader-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; animation-delay: calc(0.25s + var(--i, 0) * 35ms); }
          [data-book] [data-stamp] { animation: zinny-stamp-in 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both; }
          [data-book] [data-ribbon] { transform-origin: 50% 0%; animation: zinny-ribbon-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both; }
        }
      `}</style>
      <div aria-hidden className="pointer-events-none absolute -inset-x-16 -top-24 -bottom-10 sm:-inset-x-32">
        <div data-lamp className="absolute inset-0 opacity-0" style={LAMP} />
        <Dust />
      </div>

      <div className="relative [perspective:2600px]">
        <div data-tilt className="[transform-style:preserve-3d]">
          <div
            data-book
            className="relative grid rounded-[10px] bg-[#fffaf0] text-ink shadow-[0_1px_0_#efe4c8,0_3px_0_#fffaf0,0_4px_0_#e8dcbd,0_6px_0_#fffaf0,0_7px_0_#e2d4b2,0_40px_70px_-30px_rgb(0_0_0/0.65)] lg:grid-cols-2"
          >
            <div className="relative min-w-0 rounded-t-[10px] p-6 sm:p-10 lg:rounded-l-[10px] lg:rounded-tr-none lg:pr-12">
              <div aria-hidden className="pointer-events-none absolute inset-0 hidden rounded-l-[10px] lg:block" style={GUTTER_LEFT} />
              <div className="relative">{left}</div>
            </div>
            <div className="relative min-w-0 border-t border-line lg:border-t-0">
              <div aria-hidden className="pointer-events-none absolute inset-0 hidden rounded-r-[10px] lg:block" style={GUTTER_RIGHT} />
              <div className="relative p-6 [scrollbar-color:var(--color-line)_transparent] [scrollbar-width:thin] sm:p-10 lg:absolute lg:inset-0 lg:overflow-y-auto lg:pl-12">{right}</div>
            </div>
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px bg-[rgb(20_38_31/0.12)] lg:block" />

            {/* The ribbon marker, hanging out of the bottom of the book. */}
            <span
              data-ribbon
              aria-hidden
              className="pointer-events-none absolute top-[calc(100%-6px)] right-[14%] z-0 h-16 w-4 bg-gold shadow-[0_6px_10px_-4px_rgb(0_0_0/0.45)] [clip-path:polygon(0_0,100%_0,100%_100%,50%_78%,0_100%)] lg:right-[22%]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
