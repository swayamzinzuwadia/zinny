"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Link from "next/link";
import { useRef } from "react";
import { display } from "../fonts";
import css from "../landing.module.css";
import { Footer } from "./Footer";

gsap.registerPlugin(useGSAP);

const ROWS = [
  ["Live classes", "Tests", "Timetables", "Attendance", "Assignments", "Polls", "Lessons", "Leaderboards"],
  ["Invoices", "UPI checkout", "Refunds", "Certificates", "Your own website", "Roles", "Reports", "The marketplace"],
];

/** Everything else the app does, as two rows of type that run at one steady speed, whatever the page is doing. */
function Everything() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.utils.toArray<HTMLElement>("[data-run]").forEach((row, i) => {
          gsap.fromTo(row, { xPercent: i % 2 ? -50 : 0 }, { xPercent: i % 2 ? 0 : -50, duration: 42, ease: "none", repeat: -1 });
        });
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

/** Two doors, one for each kind of visitor. The one you lean towards opens wider. */
function Doors() {
  return (
    <section aria-labelledby="doors-title" className={css.doors}>
      <h2 id="doors-title" className="sr-only">
        Zinny, one AI-enabled marketplace for institutes and learners
      </h2>
      <Link href="/book-a-demo" className={`${css.door} ${css.chalkboard} text-canvas`}>
        <span className="text-[16px] text-canvas/70">I run an institute or teach</span>
        <span className="grid gap-5">
          <span className={`${display.className} ${css.headline} ${css.doorTitle}`}>
            Teach once. <em className="text-gold">Earn for years.</em>
          </span>
          <span className="max-w-[30rem] text-[18px] leading-relaxed text-canvas/80">
            Zinny is one AI-enabled marketplace for running your institute and selling what it teaches. Book a short demo and see it with your own courses.
          </span>
        </span>
        <span className="inline-flex h-14 w-fit items-center rounded-full bg-canvas px-8 text-[16px] font-medium text-brand-deep">Book a demo</span>
      </Link>
      <Link href="/signup" className={`${css.door} bg-gold text-brand-deep`}>
        <span className="text-[16px] text-brand-deep/70">I want to learn</span>
        <span className="grid gap-5">
          <span className={`${display.className} ${css.headline} ${css.doorTitle}`}>
            Learn a skill, <em>fast.</em>
          </span>
          <span className="max-w-[30rem] text-[18px] leading-relaxed text-brand-deep/80">
            Recorded courses, tests and certificates from real institutes, on one AI-enabled marketplace. Start with a free account.
          </span>
        </span>
        <span className="inline-flex h-14 w-fit items-center rounded-full bg-brand-deep px-8 text-[16px] font-medium text-canvas">Create a free account</span>
      </Link>
    </section>
  );
}

export function Finale() {
  return (
    <>
      <Everything />
      <Doors />
      <Footer />
    </>
  );
}
