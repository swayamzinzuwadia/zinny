import { demoHref } from "../config";
import { display } from "../fonts";
import css from "../landing.module.css";
import { TodayBoard } from "./TodayBoard";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative px-4 pt-32 pb-28 sm:pt-40 md:pb-40">
      <div className="mx-auto max-w-4xl text-center">
        <p className={`text-[14px] text-brand ${css.rise}`}>For institutes and universities</p>
        <h1
          id="hero-title"
          className={`${display.className} mt-5 text-[clamp(3.25rem,9vw,7.5rem)] leading-[0.92] tracking-[-0.025em] text-ink ${css.balance} ${css.rise} ${css.d1}`}
        >
          The whole institute, <em className="text-brand">in order.</em>
        </h1>
        <p className={`mx-auto mt-7 max-w-2xl text-[17px] leading-relaxed text-muted sm:text-[19px] ${css.pretty} ${css.rise} ${css.d2}`}>
          Courses, batches, classes, fees and certificates in one private space for every institute, with exactly the
          right view for every person in it.
        </p>
        <div className={`mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row ${css.rise} ${css.d3}`}>
          <a
            href={demoHref}
            className="inline-flex h-12 items-center rounded-full bg-brand px-7 text-[15px] font-medium text-canvas shadow-[0_8px_24px_-8px_rgb(11_94_76/0.6)] [transition-property:background-color,transform,box-shadow] duration-150 hover:bg-brand-strong active:scale-[0.96]"
          >
            Book a demo
          </a>
          <a
            href="#story"
            className="inline-flex h-12 items-center rounded-full px-6 text-[15px] text-ink ring-1 ring-line [transition-property:background-color,box-shadow] duration-150 hover:bg-surface hover:ring-faint"
          >
            See how it works
          </a>
        </div>
      </div>

      <div className="mt-16 sm:mt-20">
        <TodayBoard />
      </div>
    </section>
  );
}
