"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef, type CSSProperties, type ReactNode } from "react";

gsap.registerPlugin(useGSAP);

/** Light falling into the gutter where the pages meet the spine. */
const GUTTER_LEFT: CSSProperties = { backgroundImage: "linear-gradient(to left, rgb(20 38 31 / 0.13), rgb(20 38 31 / 0) 7%)" };
const GUTTER_RIGHT: CSSProperties = { backgroundImage: "linear-gradient(to right, rgb(20 38 31 / 0.13), rgb(20 38 31 / 0) 7%)" };

/**
 * The listing page is the book. It arrives closed on the desk; the cover swings open on the
 * spine and the two pages are the listing: the title page with the price and the way to buy,
 * and the contents written out in full. On a phone the pages stack and the cover swings away.
 *
 * The page is rendered closed. If the animation never runs (no script, an error), a CSS
 * fallback opens it after a few seconds; reduced motion opens it at once.
 */
export function ListingBook({ cover, left, right }: { cover: ReactNode; left: ReactNode; right: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const q = (s: string) => root.current!.querySelector<HTMLElement>(s)!;
      const lid = q("[data-lid]");
      const back = q("[data-lid-back]");
      // The cover's own layers (sticker, cloth) don't all honour backface-visibility, so the front is
      // hidden by hand the moment it turns edge-on.
      const front = q("[data-lid-front]");
      const leftPage = q("[data-left]");
      const pages = root.current!.querySelectorAll<HTMLElement>("[data-page]");
      const mm = gsap.matchMedia();
      // `always` makes the callback run on every screen: matchMedia only calls it when some condition matches.
      mm.add({ always: "(min-width: 0px)", wide: "(min-width: 1024px)", reduce: "(prefers-reduced-motion: reduce)" }, (ctx) => {
        const { wide, reduce } = ctx.conditions as { wide: boolean; reduce: boolean };
        if (reduce) {
          gsap.set(lid, { display: "none" });
          gsap.set(pages, { opacity: 1, y: 0 });
          return;
        }
        const tl = gsap.timeline({ delay: 0.25, defaults: { ease: "power3.inOut" } });
        if (wide) {
          // Closed on the right half; the cover swings over to the left and the title page shows beneath it.
          tl.from(q("[data-book]"), { y: 24, rotateX: 8, duration: 0.6, ease: "power2.out" }, 0)
            .to(lid, { rotateY: -180, duration: 1.35 }, 0.3)
            .set(front, { opacity: 0 }, 0.3 + 1.35 / 2)
            .to(leftPage, { opacity: 1, duration: 0.5, ease: "power1.out" }, 0.75)
            .to(back, { opacity: 0, duration: 0.35, ease: "power1.in" }, 1.25)
            .set(lid, { display: "none" });
        } else {
          tl.to(lid, { rotateY: -110, duration: 0.9 }, 0.1)
            .set(front, { opacity: 0 }, 0.1 + 0.9 * (90 / 110))
            .to(lid, { opacity: 0, duration: 0.3 }, 0.6)
            .to(pages, { opacity: 1, y: 0, stagger: 0.08, duration: 0.5, ease: "power2.out" }, 0.55)
            .set(lid, { display: "none" });
        }
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="[perspective:2600px]">
      <style>{`
        @keyframes zinny-book-page { to { opacity: 1; transform: none; } }
        @keyframes zinny-book-lid { to { opacity: 0; visibility: hidden; } }
        @media (prefers-reduced-motion: no-preference) {
          [data-book-root] [data-page] { opacity: 0; animation: zinny-book-page 0.4s 3.2s forwards; }
          [data-book-root] [data-lid] { animation: zinny-book-lid 0.4s 3.2s forwards; }
        }
        @media (prefers-reduced-motion: no-preference) and (max-width: 1023px) {
          [data-book-root] [data-page] { transform: translateY(12px); }
        }
        @media (prefers-reduced-motion: no-preference) and (min-width: 1024px) {
          [data-book-root] [data-right][data-page] { opacity: 1; animation: none; }
        }
        @media (prefers-reduced-motion: reduce) { [data-book-root] [data-lid] { display: none; } }
      `}</style>
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
        {/* The cover, hinged on the spine. Its back is an endpaper that fades as it settles over the title page. */}
        <div
          data-lid
          aria-hidden
          className="absolute top-0 right-0 z-10 aspect-[3/4] w-full [transform-origin:left_center] [transform-style:preserve-3d] lg:aspect-auto lg:h-full lg:w-1/2"
        >
          <div data-lid-front className="absolute inset-0 [backface-visibility:hidden]">{cover}</div>
          <div data-lid-back className="absolute inset-0 rounded-[9px_3px_3px_9px] bg-brand-deep [backface-visibility:hidden] [transform:rotateY(180deg)]" />
        </div>
      </div>
    </div>
  );
}
