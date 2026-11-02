"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Link from "next/link";
import { useRef } from "react";
import { demoHref } from "../config";
import { display } from "../fonts";
import css from "../landing.module.css";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText);

/** Cloth-bound spines drifting behind the first screen, each at its own depth. */
const DRIFT = [
  { left: "3%", top: "18%", h: 120, cloth: "bg-brand", depth: 0.9, tilt: -8 },
  { left: "11%", top: "74%", h: 86, cloth: "bg-[#2f4a72]", depth: 0.5, tilt: 6 },
  { left: "44%", top: "9%", h: 70, cloth: "bg-gold", depth: 0.35, tilt: 12 },
  { left: "52%", top: "86%", h: 104, cloth: "bg-[#a8402c]", depth: 0.7, tilt: -14 },
  { left: "88%", top: "12%", h: 96, cloth: "bg-[#7a3d66]", depth: 0.6, tilt: 9 },
  { left: "95%", top: "62%", h: 132, cloth: "bg-brand-deep", depth: 1, tilt: -5 },
];

const SERIF = display.className;

/** A cloth-bound book, as the marketplace draws them, at thumbnail size. */
function MiniBook({ title, cloth, sticker }: { title: string; cloth: string; sticker?: string }) {
  return (
    <div className={`relative aspect-[3/4] w-full overflow-hidden rounded-[2px_6px_6px_2px] ${cloth} shadow-[0_10px_18px_-10px_rgb(6_58_47/0.8)]`}>
      <span className="absolute inset-y-0 left-0 w-[8%] bg-black/20" />
      <span className={`${SERIF} absolute right-[10%] bottom-[16%] left-[18%] text-[10px] leading-[1.1] font-semibold`}>{title}</span>
      {sticker && (
        <span className="absolute -top-[6%] -right-[8%] flex size-[34%] rotate-[-9deg] items-center justify-center rounded-full bg-gold text-[8px] font-bold text-brand-deep">
          {sticker}
        </span>
      )}
    </div>
  );
}

/**
 * The product at work, in one loop: an institute publishes a course from its Zinny admin, the
 * book flies onto a learner's marketplace shelf, the learner buys it, and the sale lands on the
 * institute's dashboard with its GST invoice. An illustration; the names and numbers are examples.
 */
function Scene() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const q = (s: string) => root.current!.querySelector<HTMLElement>(s)!;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const pointer = q("[data-pointer]");
        const publish = q("[data-publish]");
        const flyer = q("[data-flyer]");
        const slot = q("[data-slot]");
        const buy = q("[data-buy]");
        const bought = q("[data-bought]");
        const sale = q("[data-sale]");
        const total = q("[data-total]");
        const invoice = q("[data-invoice]");
        const counter = { v: 12 };
        // Measured, so the pointer finds the button and the book finds its slot at any screen size.
        const box = () => root.current!.getBoundingClientRect();
        const toButton = () => {
          const b = publish.getBoundingClientRect();
          return { x: b.left - box().left + b.width * 0.55, y: b.top - box().top + b.height * 0.6 };
        };
        const toSlot = () => {
          const a = flyer.getBoundingClientRect();
          const b = slot.getBoundingClientRect();
          return { x: b.left - a.left + (b.width - a.width) / 2, y: b.top - a.top + (b.height - a.height) / 2 };
        };
        const show = (v: number) => {
          total.textContent = `₹${Math.round(v * 2999).toLocaleString("en-IN")}`;
        };

        gsap.set([bought, invoice], { y: 8 });
        gsap.set(sale, { x: 14 });
        // Function values are worked out again on every loop, in case the screen was resized.
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.2, defaults: { ease: "power2.inOut" }, onRepeat: () => tl.invalidate() });
        tl.set([flyer, bought, sale, invoice], { opacity: 0 })
          .set(slot, { opacity: 0, y: -14 })
          .set(pointer, { x: 40, y: 150, opacity: 0 })
          .call(() => {
            counter.v = 12;
            show(12);
          })
          // The admin publishes the course.
          .to(pointer, { opacity: 1, duration: 0.3 }, 0.3)
          .to(pointer, { x: () => toButton().x, y: () => toButton().y, duration: 0.9 }, 0.3)
          .to(publish, { scale: 0.94, duration: 0.1, yoyo: true, repeat: 1 }, 1.25)
          .to(publish, { backgroundColor: "#d4a72a", color: "#063a2f", duration: 0.2 }, 1.3)
          // The book flies from the course onto the phone's shelf.
          .set(flyer, { opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }, 1.45)
          .to(flyer, { x: () => toSlot().x, duration: 1.1, ease: "power1.inOut" }, 1.45)
          .to(flyer, { y: -70, duration: 0.5, ease: "power2.out" }, 1.45)
          .to(flyer, { y: () => toSlot().y, duration: 0.6, ease: "power2.in" }, 1.95)
          .to(flyer, { rotate: 360, scale: 0.78, duration: 1.1 }, 1.45)
          .set(flyer, { opacity: 0 }, 2.55)
          .to(slot, { opacity: 1, y: 0, duration: 0.35, ease: "back.out(2)" }, 2.5)
          .to(pointer, { opacity: 0, duration: 0.2 }, 2.4)
          // A learner buys it.
          .to(buy, { scale: 0.92, duration: 0.12, yoyo: true, repeat: 1 }, 3.2)
          .to(bought, { opacity: 1, y: 0, duration: 0.35, ease: "back.out(1.8)" }, 3.45)
          // The sale lands on the institute's dashboard, with its invoice.
          .to(sale, { opacity: 1, x: 0, duration: 0.4, ease: "back.out(1.6)" }, 3.9)
          .to(counter, { v: 13, duration: 0.6, onUpdate: () => show(counter.v) }, 4.0)
          .to(invoice, { opacity: 1, y: 0, duration: 0.35 }, 4.5)
          .to([bought, sale, invoice], { opacity: 0, duration: 0.4 }, 6.6)
          .to(publish, { backgroundColor: "#0b5e4c", color: "#faf6ea", duration: 0.3 }, 6.6);
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} aria-hidden className="relative mx-auto w-full max-w-[34rem] select-none [perspective:1400px]">
      <div data-scene-tilt className="relative [transform-style:preserve-3d]">
      {/* The institute's admin, in a browser window. */}
      <div data-scene-window className="overflow-hidden rounded-[14px] bg-surface shadow-[0_40px_80px_-30px_rgb(6_58_47/0.55),0_0_0_1px_rgb(20_38_31/0.08)]">
        <div className="flex items-center gap-1.5 border-b border-line bg-canvas px-3 py-2">
          <span className="size-2 rounded-full bg-[#e8dcc0]" />
          <span className="size-2 rounded-full bg-[#e8dcc0]" />
          <span className="size-2 rounded-full bg-[#e8dcc0]" />
          <span className="ml-3 truncate rounded-full bg-surface px-3 py-0.5 text-[10px] text-muted">zinny / your-institute / admin</span>
        </div>
        <div className="flex">
          <div className="hidden w-28 shrink-0 bg-brand-deep px-3 py-3 text-[10px] text-canvas/70 sm:block">
            <div className="mb-3 text-[11px] font-semibold text-canvas">Your Institute</div>
            {["Dashboard", "Courses", "Live classes", "Tests", "Fees", "Marketplace", "Website"].map((x) => (
              <div key={x} className={`rounded-md px-2 py-1 ${x === "Marketplace" ? "bg-canvas/10 text-canvas" : ""}`}>
                {x}
              </div>
            ))}
          </div>
          <div className="min-w-0 flex-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] text-muted">Marketplace sales</div>
                <div data-total className="tabular text-[22px] leading-tight font-semibold text-ink">
                  ₹35,988
                </div>
                <div className="text-[10px] text-muted">before GST</div>
              </div>
              <div data-sale className="rounded-lg bg-brand-soft px-2.5 py-1.5 text-[10px] leading-snug text-brand-deep">
                <div className="font-semibold">New buyer</div>
                <div>Data Analytics · ₹2,999</div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-line p-3">
              <div className="relative w-12 shrink-0">
                <MiniBook title="Data Analytics" cloth="bg-brand text-canvas" />
                <div data-flyer className="pointer-events-none absolute inset-0 z-20 opacity-0">
                  <MiniBook title="Data Analytics" cloth="bg-brand text-canvas" sticker="40%" />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-semibold text-ink">Data Analytics</div>
                <div className="text-[10px] text-muted">9 recorded lessons · ₹2,999 + GST</div>
                <div data-publish className="mt-2 inline-block rounded-full bg-brand px-3 py-1 text-[10px] font-medium text-canvas">
                  Publish on the marketplace
                </div>
              </div>
            </div>
            <div data-invoice className="mt-3 flex items-center justify-between rounded-lg bg-canvas px-3 py-2 text-[10px] text-ink">
              <span>GST invoice issued</span>
              <span className="text-muted">CGST 9% · SGST 9%</span>
            </div>
          </div>
        </div>
      </div>

      {/* A learner's phone, on the marketplace. */}
      <div data-scene-phone className="absolute right-0 -bottom-36 w-[10.5rem] rounded-[26px] sm:-right-10 sm:-bottom-14 sm:w-[11.5rem] bg-[#0d1f19] p-2 shadow-[0_30px_60px_-20px_rgb(0_0_0/0.6)] sm:-right-10">
        <div className="overflow-hidden rounded-[20px] bg-brand-deep">
          <div className="px-3 pt-3 pb-2">
            <div className={`${SERIF} text-[13px] leading-tight font-semibold text-canvas`}>Learn from the institutes themselves.</div>
          </div>
          <div className="flex items-end gap-1.5 px-3 pb-2">
            <div data-scene-book className="w-[30%]">
              <MiniBook title="Spoken English" cloth="bg-[#2f4a72] text-canvas" />
            </div>
            <div data-slot className="w-[30%]">
              <MiniBook title="Data Analytics" cloth="bg-brand text-canvas" sticker="40%" />
            </div>
            <div data-scene-book className="w-[30%]">
              <MiniBook title="Tally basics" cloth="bg-[#a8402c] text-canvas" />
            </div>
          </div>
          <div className="h-1.5 bg-[#04291f]" />
          <div className="bg-canvas px-3 py-2.5">
            <div className="text-[10px] font-semibold text-ink">Data Analytics</div>
            <div className="text-[9px] text-muted">
              ₹2,999 <s>₹4,999</s> + GST
            </div>
            <div data-buy className="mt-1.5 rounded-full bg-brand py-1 text-center text-[10px] font-medium text-canvas">
              Buy now
            </div>
            <div data-bought className="mt-1.5 rounded-md bg-gold-soft px-2 py-1 text-center text-[9px] font-medium text-brand-deep opacity-0">
              On your shelf. Start watching
            </div>
          </div>
        </div>
      </div>

      </div>
      {/* The admin's pointer. */}
      <svg data-pointer viewBox="0 0 20 20" className="pointer-events-none absolute top-0 left-0 z-30 size-5 opacity-0 drop-shadow-[0_2px_3px_rgb(0_0_0/0.35)]">
        <path d="M3 2l13 7-6 1.5L7.5 17z" fill="#14261f" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** The first screen: what Zinny is, for both sides, with both ways in, beside the product at work. */
export function Hero() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const el = root.current!;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        // The headline rises line by line out of a mask, then the rest follows.
        const split = SplitText.create("[data-hero-title]", { type: "lines", mask: "lines" });
        const intro = gsap.timeline({ delay: 0.1 });
        intro
          .from(split.lines, { yPercent: 110, duration: 1.05, stagger: 0.12, ease: "expo.out" }, 0)
          .from("[data-rise]", { y: 26, opacity: 0, duration: 0.8, stagger: 0.1, ease: "power3.out" }, 0.45)
          // The product scene assembles: the admin window swings up, the phone spins in, the books drop.
          .from("[data-scene-window]", { y: 80, rotateX: 28, opacity: 0, duration: 1.1, ease: "expo.out", transformOrigin: "50% 100%" }, 0.35)
          .from("[data-scene-phone]", { x: 160, y: 40, rotate: 18, opacity: 0, duration: 1.1, ease: "expo.out" }, 0.6)
          .from("[data-scene-book]", { y: -60, opacity: 0, duration: 0.6, stagger: 0.08, ease: "back.out(1.8)" }, 1.0)
          .from("[data-drift]", { opacity: 0, scale: 0.6, duration: 1.2, stagger: 0.06, ease: "power2.out" }, 0.2);

        // Spines drift past at their own depths as the page scrolls.
        gsap.utils.toArray<HTMLElement>("[data-drift]").forEach((d) => {
          const depth = Number(d.dataset.depth);
          gsap.to(d, { y: -260 * depth, rotate: `+=${18 * depth}`, ease: "none", scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: true } });
          gsap.to(d, { y: `+=${10 + 10 * depth}`, duration: 3 + depth * 2, ease: "sine.inOut", yoyo: true, repeat: -1 });
        });

        // The scene leans towards the pointer; the spines answer at their depths.
        if (window.matchMedia("(pointer: fine)").matches) {
          const scene = el.querySelector<HTMLElement>("[data-scene-tilt]")!;
          const rx = gsap.quickTo(scene, "rotateX", { duration: 0.9, ease: "power3.out" });
          const ry = gsap.quickTo(scene, "rotateY", { duration: 0.9, ease: "power3.out" });
          const drifts = gsap.utils.toArray<HTMLElement>("[data-drift-x]").map((d) => ({ x: gsap.quickTo(d, "x", { duration: 1.2, ease: "power3.out" }), depth: Number(d.dataset.depth) }));
          const move = (e: PointerEvent) => {
            const nx = e.clientX / window.innerWidth - 0.5;
            const ny = e.clientY / window.innerHeight - 0.5;
            rx(-ny * 7);
            ry(nx * 9);
            drifts.forEach((d) => d.x(-nx * 60 * d.depth));
          };
          window.addEventListener("pointermove", move, { passive: true });
          return () => {
            window.removeEventListener("pointermove", move);
            split.revert();
          };
        }
        return () => split.revert();
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} aria-labelledby="hero" className="relative overflow-x-clip pt-28 pb-20 sm:pt-36 sm:pb-28">
      <div aria-hidden className="pointer-events-none absolute inset-0 hidden md:block">
        {DRIFT.map((d, i) => (
          <span key={i} data-drift-x data-depth={d.depth} className="absolute" style={{ left: d.left, top: d.top }}>
            <span
              data-drift
              data-depth={d.depth}
              className={`block w-7 rounded-[3px_3px_1px_1px] opacity-[0.16] ${d.cloth}`}
              style={{ height: d.h, transform: `rotate(${d.tilt}deg)` }}
            />
          </span>
        ))}
      </div>
      <div className="mx-auto grid max-w-[1240px] items-center gap-16 px-5 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-12">
        <div>
          <h1 id="hero" data-hero-title className={`${SERIF} ${css.headline} text-[clamp(2.9rem,6.4vw,5.6rem)] leading-[1.02] tracking-[-0.025em] text-ink`}>
            Run your institute.
            <br />
            <span className="text-brand">Sell what it teaches.</span>
          </h1>
          <p data-rise className="mt-6 max-w-[34rem] text-[18px] leading-relaxed text-ink/75">
            Zinny is one place for courses, live classes, tests, fees and certificates, and a marketplace where learners anywhere buy the courses you&apos;ve
            recorded. Built for Indian institutes, with UPI and GST invoices.
          </p>
          <div data-rise className="mt-9 grid max-w-[34rem] gap-3 sm:grid-cols-2">
            <a
              href={demoHref}
              className="group rounded-2xl bg-brand-deep px-5 py-4 text-canvas [transition-property:transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_30px_-16px_rgb(6_58_47/0.8)]"
            >
              <span className="block text-[13px] text-canvas/65">I run an institute</span>
              <span className="mt-1 block text-[17px] font-semibold">
                Book a demo
              </span>
            </a>
            <Link
              href="/marketplace"
              className="group rounded-2xl bg-gold px-5 py-4 text-brand-deep [transition-property:transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_30px_-16px_rgb(168_127_18/0.9)]"
            >
              <span className="block text-[13px] text-brand-deep/70">I want to learn</span>
              <span className="mt-1 block text-[17px] font-semibold">
                Browse the marketplace
              </span>
            </Link>
          </div>
        </div>
        <div data-rise className="relative pb-16 lg:pb-10">
          <Scene />
          <p className="mt-40 text-center text-[12px] text-muted sm:mt-16">An illustration of Zinny at work. The names and numbers are examples.</p>
        </div>
      </div>
    </section>
  );
}
