import Link from "next/link";
import { demoHref } from "../config";
import { display } from "../fonts";
import css from "../landing.module.css";
import { DayRail } from "./DayRail";

const door = "group flex flex-col justify-between gap-4 rounded-[24px] p-5 [transition-property:background-color,transform] duration-200 hover:-translate-y-0.5 sm:min-h-[132px]";

/** The chalkboard. What Zinny is in one line, a door for each kind of visitor, and the whole app as one day. */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className={`relative isolate text-canvas ${css.chalkboard}`}>
      <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col justify-between gap-8 px-5 pt-24 pb-11 sm:px-8 sm:pt-28 lg:px-12">
        <div>
          <p className={`text-[15px] text-canvas/70 ${css.rise}`}>An institute app with a marketplace</p>
          <h1 id="hero-title" className={`${display.className} ${css.headline} mt-5 text-[clamp(3.25rem,7.8vw,7.75rem)] leading-[0.98] tracking-[-0.025em] ${css.rise} ${css.d1}`}>
            Run your institute.
            <br />
            <span className="relative inline-block pb-[0.08em]">
              <em className="text-gold">Sell what it teaches.</em>
              <svg aria-hidden viewBox="0 0 600 20" preserveAspectRatio="none" className="absolute bottom-0 left-0 h-[0.14em] w-[60%] sm:w-full" fill="none">
                <path pathLength={1} className={css.draw} d="M4 13C96 6 188 5 287 8c100 3 205 5 309-2" stroke="#d4a72a" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            </span>
          </h1>
        </div>

        <div className={`grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-end lg:gap-14 ${css.rise} ${css.d2}`}>
          <p className={`max-w-xl text-[17px] leading-relaxed text-canvas/75 sm:text-[19px] ${css.pretty}`}>
            Courses, batches, live classes, tests, fees and certificates in one private space for every institute, and a marketplace where anyone can buy what it teaches.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <a href={demoHref} className={`${door} bg-canvas text-brand-deep hover:bg-surface`}>
              <span className="text-[14px] text-brand-deep/70">I run an institute</span>
              <span className="text-[19px] leading-snug font-medium">Book a demo</span>
            </a>
            <Link href="/signup" className={`${door} bg-canvas/[0.09] ring-1 ring-canvas/15 hover:bg-canvas/[0.14]`}>
              <span className="text-[14px] text-canvas/65">I want to learn</span>
              <span className="text-[19px] leading-snug font-medium">Create a student account</span>
            </Link>
          </div>
        </div>

        <div className={`${css.rise} ${css.d3}`}>
          <DayRail />
        </div>
      </div>
    </section>
  );
}
