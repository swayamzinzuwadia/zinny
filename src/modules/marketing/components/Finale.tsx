"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import { demoHref } from "../config";
import { display } from "../fonts";
import css from "../landing.module.css";

gsap.registerPlugin(ScrollTrigger, useGSAP);

const ROWS = [
  ["Live classes", "Tests", "Timetables", "Attendance", "Assignments", "Polls", "Lessons", "Leaderboards"],
  ["GST invoices", "UPI checkout", "Refunds", "Certificates", "Your own website", "Roles", "Reports", "The marketplace"],
];

/** Everything else the app does, as two rows of type that run faster the faster you scroll. */
function Everything() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const runs = gsap.utils.toArray<HTMLElement>("[data-run]").map((row, i) =>
          gsap.fromTo(row, { xPercent: i % 2 ? -50 : 0 }, { xPercent: i % 2 ? 0 : -50, duration: 42, ease: "none", repeat: -1 }),
        );
        const rush = gsap.quickTo(runs, "timeScale", { duration: 0.6, ease: "power2.out" });
        ScrollTrigger.create({
          trigger: root.current,
          start: "top bottom",
          end: "bottom top",
          onUpdate: (self) => {
            rush(1 + Math.min(Math.abs(self.getVelocity()) / 220, 7));
          },
        });
        const settle = () => rush(1);
        ScrollTrigger.addEventListener("scrollEnd", settle);
        return () => ScrollTrigger.removeEventListener("scrollEnd", settle);
      });
    },
    { scope: root },
  );

  return (
    <section ref={root} aria-label="Everything Zinny does" className="overflow-hidden bg-brand-deep py-16 text-canvas sm:py-24">
      <ul className="sr-only">
        {ROWS.flat().map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {ROWS.map((row, r) => (
        <div key={r} aria-hidden data-run className="flex w-max">
          {[...row, ...row].map((item, i) => (
            <span key={i} className={`${display.className} ${css.headline} flex items-center gap-[0.35em] pr-[0.35em] text-[clamp(2.75rem,7vw,6.5rem)] leading-[1.2] whitespace-nowrap ${r % 2 ? "text-canvas/35" : ""}`}>
              {item}
              <span className="inline-block size-[0.16em] rounded-full bg-gold" />
            </span>
          ))}
        </div>
      ))}
    </section>
  );
}

/** Two doors. The one you lean towards opens wider. */
function Doors() {
  return (
    <section aria-label="Choose your way in" className={css.doors}>
      <a href={demoHref} className={`${css.door} ${css.chalkboard} text-canvas`}>
        <span className="text-[16px] text-canvas/70">I run an institute</span>
        <span className={`${display.className} ${css.headline} ${css.doorTitle}`}>
          Put it <em className="text-gold">in order.</em>
        </span>
        <span className="inline-flex h-14 w-fit items-center rounded-full bg-canvas px-8 text-[16px] font-medium text-brand-deep">Book a demo</span>
      </a>
      <Link href="/signup" className={`${css.door} bg-gold text-brand-deep`}>
        <span className="text-[16px] text-brand-deep/70">I want to learn</span>
        <span className={`${display.className} ${css.headline} ${css.doorTitle}`}>
          Walk <em>in.</em>
        </span>
        <span className="inline-flex h-14 w-fit items-center rounded-full bg-brand-deep px-8 text-[16px] font-medium text-canvas">Create a student account</span>
      </Link>
    </section>
  );
}

export function Finale() {
  return (
    <>
      <Everything />
      <Doors />
      <footer className="flex flex-col items-center justify-between gap-4 bg-brand-deep px-6 py-7 text-[13px] text-canvas/55 sm:flex-row sm:px-10">
        <Image src="/brand/zinny-wordmark-cream.png" alt="Zinny" width={407} height={183} className="h-6 w-auto opacity-90" />
        <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link href="/marketplace" className="hover:text-canvas">
            Marketplace
          </Link>
          <Link href="/verify" className="hover:text-canvas">
            Verify a certificate
          </Link>
          <Link href="/login" className="hover:text-canvas">
            Sign in
          </Link>
          <Link href="/signup" className="hover:text-canvas">
            Sign up
          </Link>
        </nav>
        <p>© 2026 Zinny</p>
      </footer>
    </>
  );
}
