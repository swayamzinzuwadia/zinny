"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

gsap.registerPlugin(useGSAP, SplitText);

/** Light falling into the gutter where the pages meet the spine. */
const GUTTER_LEFT: CSSProperties = { backgroundImage: "linear-gradient(to left, rgb(20 38 31 / 0.13), rgb(20 38 31 / 0) 7%)" };
const GUTTER_RIGHT: CSSProperties = { backgroundImage: "linear-gradient(to right, rgb(20 38 31 / 0.13), rgb(20 38 31 / 0) 7%)" };
/** The desk lamp: a warm pool of light the book is opened under. */
const LAMP: CSSProperties = { backgroundImage: "radial-gradient(ellipse 55% 60% at 50% 38%, rgb(212 167 42 / 0.26), rgb(212 167 42 / 0.08) 45%, transparent 72%)" };
const LEAVES = 5;

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
 * The listing page is the book, and opening it is a small film: the lamp comes up, the book
 * drops onto the desk, the cover swings open, a few pages riffle after it, and the listing
 * writes itself in: the title rises line by line, each lesson appears with its dotted leader
 * drawing across to its length, and the deal lands last as a stamp. After that the book stays
 * alive: it leans towards the pointer, its ribbon marker sways, the lamp breathes.
 *
 * The page renders closed. If the script never runs, a CSS fallback opens it after a few
 * seconds; reduced motion opens it at once and keeps it still.
 *
 * Marks it reads in `left` and `right`: data-ink-title (split into lines), data-ink (fades up),
 * data-ink-head, data-ink-line (a contents row), data-leader (its dotted line), data-stamp.
 */
export function ListingBook({ cover, left, right }: { cover: ReactNode; left: ReactNode; right: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = root.current!;
      const q = (s: string) => el.querySelector<HTMLElement>(s)!;
      const all = (s: string) => Array.from(el.querySelectorAll<HTMLElement>(s));
      const book = q("[data-book]");
      const tilt = q("[data-tilt]");
      const lamp = q("[data-lamp]");
      const ribbon = q("[data-ribbon]");
      const lid = q("[data-lid]");
      const back = q("[data-lid-back]");
      // The cover's own layers (sticker, cloth) don't all honour backface-visibility, so its front
      // is hidden by hand the moment it turns edge-on.
      const front = q("[data-lid-front]");
      const leaves = all("[data-leaf]");
      const leftPage = q("[data-left]");
      const pages = all("[data-page]");
      const title = el.querySelector<HTMLElement>("[data-ink-title]");
      const ink = all("[data-ink]");
      const heads = all("[data-ink-head]");
      const lines = all("[data-ink-line]");
      const leaders = all("[data-leader]");
      const stamp = el.querySelector<HTMLElement>("[data-stamp]");

      const mm = gsap.matchMedia();
      // `always` makes the callback run on every screen: matchMedia only calls it when some condition matches.
      mm.add({ always: "(min-width: 0px)", wide: "(min-width: 1024px)", fine: "(pointer: fine)", reduce: "(prefers-reduced-motion: reduce)" }, (ctx) => {
        const { wide, fine, reduce } = ctx.conditions as { wide: boolean; fine: boolean; reduce: boolean };
        if (reduce) {
          gsap.set([lid, ...leaves], { display: "none" });
          gsap.set(pages, { opacity: 1, y: 0 });
          gsap.set(lamp, { opacity: 1 });
          return;
        }

        const split = title ? SplitText.create(title, { type: "lines", mask: "lines", linesClass: "pb-[0.06em]" }) : null;
        const tl = gsap.timeline({ delay: 0.15, defaults: { ease: "power3.inOut" } });

        // The lamp comes up and the book drops onto the desk.
        tl.fromTo(lamp, { opacity: 0 }, { opacity: 1, duration: 0.9, ease: "power1.out" }, 0);
        tl.from(book, { y: -70, rotateX: 22, scale: 0.94, opacity: 0, duration: 0.55, ease: "power3.in" }, 0.05)
          .to(book, { scaleY: 0.985, scaleX: 1.006, duration: 0.08, ease: "power1.out", transformOrigin: "50% 100%" }, 0.6)
          .to(book, { scaleY: 1, scaleX: 1, duration: 0.35, ease: "elastic.out(1, 0.5)" }, 0.68);

        let open = 0.8;
        if (wide) {
          // The cover swings over, a few pages riffle after it, then the title page settles under them.
          tl.to(lid, { rotateY: -180, duration: 1.15 }, open)
            .set(front, { opacity: 0 }, open + 0.575)
            .to(leftPage, { opacity: 1, duration: 0.45, ease: "power1.out" }, open + 0.55)
            .to(back, { opacity: 0, duration: 0.3, ease: "power1.in" }, open + 1.0)
            .set(lid, { display: "none" }, open + 1.15);
          leaves.forEach((leaf, i) => {
            const at = open + 0.28 + i * 0.075;
            tl.set(leaf, { display: "block" }, at)
              .to(leaf, { rotateY: -180, duration: 0.62, ease: "power2.inOut" }, at)
              .to(leaf, { opacity: 0, duration: 0.2 }, at + 0.45)
              .set(leaf, { display: "none" }, at + 0.65);
          });
          open += 1.0;
        } else {
          tl.to(lid, { rotateY: -110, duration: 0.85 }, open)
            .set(front, { opacity: 0 }, open + 0.85 * (90 / 110))
            .to(lid, { opacity: 0, duration: 0.25 }, open + 0.5)
            .to(pages, { opacity: 1, y: 0, stagger: 0.1, duration: 0.45, ease: "power2.out" }, open + 0.45)
            .set(lid, { display: "none" });
          open += 0.55;
        }

        // The listing writes itself in.
        if (split) tl.from(split.lines, { yPercent: 105, duration: 0.7, stagger: 0.09, ease: "power3.out" }, open);
        tl.from(ink, { opacity: 0, y: 12, duration: 0.5, stagger: 0.07, ease: "power2.out" }, open + 0.2);
        tl.from(heads, { opacity: 0, x: -10, duration: 0.4, stagger: 0.12, ease: "power2.out" }, open + 0.1);
        tl.from(lines, { opacity: 0, x: -8, duration: 0.35, stagger: 0.035, ease: "power2.out" }, open + 0.2);
        tl.from(leaders, { scaleX: 0, transformOrigin: "0% 50%", duration: 0.45, stagger: 0.035, ease: "power2.out" }, open + 0.28);
        if (stamp) {
          tl.from(stamp, { scale: 2.2, rotate: -16, opacity: 0, duration: 0.42, ease: "back.out(2.2)" }, open + 0.75).fromTo(
            stamp,
            { boxShadow: "0 0 0 0 rgb(212 167 42 / 0.55)" },
            { boxShadow: "0 0 0 14px rgb(212 167 42 / 0)", duration: 0.7, ease: "power2.out" },
            open + 1.0,
          );
        }
        tl.fromTo(ribbon, { scaleY: 0 }, { scaleY: 1, duration: 0.5, ease: "back.out(1.6)", transformOrigin: "50% 0%" }, open + 0.3);

        // Alive: the ribbon sways, the lamp breathes.
        gsap.to(ribbon, { rotate: 3.5, duration: 2.2, ease: "sine.inOut", yoyo: true, repeat: -1, transformOrigin: "50% 0%", delay: open + 0.8 });
        gsap.to(lamp, { opacity: 0.82, duration: 3.4, ease: "sine.inOut", yoyo: true, repeat: -1, delay: open + 1 });

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
            split?.revert();
          };
        }
        return () => split?.revert();
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="relative">
      <style>{`
        @keyframes zinny-book-page { to { opacity: 1; transform: none; } }
        @keyframes zinny-book-lid { to { opacity: 0; visibility: hidden; } }
        @media (prefers-reduced-motion: no-preference) {
          [data-book-root] [data-page] { opacity: 0; animation: zinny-book-page 0.4s 3.6s forwards; }
          [data-book-root] [data-lid] { animation: zinny-book-lid 0.4s 3.6s forwards; }
        }
        @media (prefers-reduced-motion: no-preference) and (max-width: 1023px) {
          [data-book-root] [data-page] { transform: translateY(12px); }
        }
        @media (prefers-reduced-motion: no-preference) and (min-width: 1024px) {
          [data-book-root] [data-right][data-page] { opacity: 1; animation: none; }
        }
        @media (prefers-reduced-motion: reduce) { [data-book-root] [data-lid] { display: none; } }
      `}</style>

      <div aria-hidden className="pointer-events-none absolute -inset-x-16 -top-24 -bottom-10 sm:-inset-x-32">
        <div data-lamp className="absolute inset-0 opacity-0" style={LAMP} />
        <Dust />
      </div>

      <div className="relative [perspective:2600px]">
        <div data-tilt className="[transform-style:preserve-3d]">
          <div
            data-book-root
            data-book
            className="relative grid rounded-[10px] bg-[#fffaf0] text-ink shadow-[0_1px_0_#efe4c8,0_3px_0_#fffaf0,0_4px_0_#e8dcbd,0_6px_0_#fffaf0,0_7px_0_#e2d4b2,0_40px_70px_-30px_rgb(0_0_0/0.65)] lg:grid-cols-2"
          >
            <div data-left data-page className="relative min-w-0 rounded-t-[10px] p-6 sm:p-10 lg:rounded-l-[10px] lg:rounded-tr-none lg:pr-12">
              <div aria-hidden className="pointer-events-none absolute inset-0 hidden rounded-l-[10px] lg:block" style={GUTTER_LEFT} />
              <div className="relative">{left}</div>
            </div>
            <div data-right data-page className="relative min-w-0 border-t border-line lg:border-t-0">
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

            {/* Pages riffling over after the cover, on a wide screen. */}
            {Array.from({ length: LEAVES }, (_, i) => (
              <span
                key={i}
                data-leaf
                aria-hidden
                className="pointer-events-none absolute top-[3px] right-[3px] bottom-[3px] z-[9] hidden w-[calc(50%-3px)] rounded-r-[8px] border border-[#ece2c8] bg-[#fffaf0] [backface-visibility:hidden] [transform-origin:left_center]"
                style={{ boxShadow: `inset ${8 + i * 3}px 0 18px -14px rgb(20 38 31 / 0.25)` }}
              />
            ))}

            {/* The cover, hinged on the spine. Its back is an endpaper that fades as it settles over the title page. */}
            <div
              data-lid
              aria-hidden
              className="absolute top-0 right-0 z-10 aspect-[3/4] w-full [transform-origin:left_center] [transform-style:preserve-3d] lg:aspect-auto lg:h-full lg:w-1/2"
            >
              <div data-lid-front className="absolute inset-0 [backface-visibility:hidden]">
                {cover}
              </div>
              <div data-lid-back className="absolute inset-0 rounded-[9px_3px_3px_9px] bg-brand-deep [backface-visibility:hidden] [transform:rotateY(180deg)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
