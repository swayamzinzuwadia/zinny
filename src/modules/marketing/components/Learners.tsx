import Link from "next/link";
import type { ReactNode } from "react";
import { display } from "../fonts";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

const SERIF = display.className;

const POINTS = [
  ["Straight from the institute", "Every recording is sold by the institute that teaches it, at the price it sets."],
  ["One cart, one payment", "Buy from several institutes at once and pay with UPI, a card or netbanking."],
  ["Yours to keep watching", "Watch at your own pace. Your progress is saved lesson by lesson, and each purchase comes with a GST invoice."],
];

/**
 * The learner's side: the marketplace, with the real books on sale right now. `shelf` is the
 * live listings, drawn by the app page (it owns the marketplace); `count` is how many there are.
 */
export function Learners({ shelf, count }: { shelf: ReactNode; count: number }) {
  return (
    <section id="learners" aria-labelledby="learners-title" className="scroll-mt-20 bg-brand-deep py-24 text-canvas sm:py-32">
      <Reveal className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <h2 id="learners-title" data-reveal className={`${SERIF} ${css.headline} max-w-[14ch] text-[clamp(2.4rem,5vw,4.4rem)] leading-[1.04] tracking-[-0.02em]`}>
              Learn from the institutes <span className="text-gold">themselves.</span>
            </h2>
            <p data-reveal className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-canvas/75">
              Recorded courses, single lectures and combos from real institutes, for anyone: students anywhere, alumni, and people who aren&apos;t at an institute at all.
            </p>
            <div data-reveal className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/marketplace"
                className="rounded-full bg-gold px-6 py-3 text-[16px] font-semibold text-brand-deep [transition-property:background-color] duration-150 hover:bg-canvas"
              >
                Browse the marketplace
              </Link>
              <Link href="/signup" className="rounded-full px-5 py-3 text-[16px] font-medium text-canvas ring-1 ring-canvas/30 [transition-property:background-color] duration-150 hover:bg-canvas/10">
                Create a free account
              </Link>
            </div>
          </div>
          <dl className="grid gap-6 sm:grid-cols-3 lg:grid-cols-1 lg:gap-5">
            {POINTS.map(([t, d]) => (
              <div key={t} data-reveal className="relative pt-4">
                <span data-rule aria-hidden className="absolute inset-x-0 top-0 h-px bg-gold/50" />
                <dt className="text-[17px] font-semibold">{t}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed text-canvas/70">{d}</dd>
              </div>
            ))}
          </dl>
        </div>

        {count > 0 && (
          <div className="mt-16">
            <p className="mb-6 text-[14px] text-canvas/60">
              On the shelf right now: {count} {count === 1 ? "recording" : "recordings"}. Prices are before GST, which is added at checkout.
            </p>
            <div data-drop className="rounded-[20px] bg-canvas p-5 text-ink sm:p-8">
              {shelf}
            </div>
          </div>
        )}
      </Reveal>
    </section>
  );
}
