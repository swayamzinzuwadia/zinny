"use client";

import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { display } from "../fonts";
import css from "../landing.module.css";
import { rupees } from "./Desk";
import { Reveal } from "./Reveal";

const SERIF = display.className;

/** ₹12.9 L, ₹1.3 Cr: short enough to sit over a bar. */
function short(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(n >= 1e8 ? 0 : 1)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(n >= 1e6 ? 0 : 1)} L`;
  return rupees(n);
}

const STEPS = [
  ["Teach", "Run your batches and live classes the way you do now."],
  ["Record", "Each class becomes a lesson, with progress saved for every student."],
  ["List", "A whole course, one lecture or a combo, at the price you set."],
  ["Sell", "Learners anywhere buy in one cart and pay with UPI, a card or netbanking."],
  ["Get paid", "Every sale is invoiced in your institute's name, with GST."],
] as const;

function Slider({
  label,
  value,
  min,
  max,
  step,
  show,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show: (n: number) => string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-4 text-[14px]">
        <span className="text-canvas/70">{label}</span>
        <span className="tabular font-semibold text-canvas">{show(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className={css.range} />
    </label>
  );
}

/**
 * Teach it once, sell it for years, made personal: the institute moves three sliders and sees
 * what learners would pay for the recordings it already has, in a year and over five. Under it,
 * the five steps from a class to a payout. The figure is gross sales, and says so.
 */
export function Loop() {
  const [courses, setCourses] = useState(6);
  const [price, setPrice] = useState(1499);
  const [buyers, setBuyers] = useState(12);
  const yearly = courses * price * buyers * 12;
  const years = [1, 2, 3, 4, 5].map((y) => yearly * y);

  // The big number rolls to its new value instead of jumping. With reduced motion it just changes.
  const num = useRef<HTMLSpanElement>(null);
  const shown = useRef(yearly);
  useEffect(() => {
    const el = num.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shown.current = yearly;
      el.textContent = rupees(yearly);
      return;
    }
    const o = { v: shown.current };
    const t = gsap.to(o, {
      v: yearly,
      duration: 0.6,
      ease: "power3.out",
      onUpdate: () => {
        shown.current = Math.round(o.v);
        el.textContent = rupees(shown.current);
      },
    });
    return () => {
      t.kill();
    };
  }, [yearly]);

  return (
    <section aria-labelledby="worth" className="relative overflow-x-clip py-24 text-ink sm:py-32">
      <Reveal className="mx-auto grid max-w-[1240px] gap-12 px-5 sm:px-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
        <div>
          <p data-reveal className="text-[15px] font-medium text-brand">
            Teach it once. Sell it for years.
          </p>
          <h2 id="worth" data-reveal className={`${SERIF} ${css.headline} mt-3 max-w-[11ch] text-[clamp(2.6rem,5.6vw,5rem)] leading-[1] tracking-[-0.025em]`}>
            What are your recordings <em className="text-brand">worth?</em>
          </h2>
          <p data-reveal className="mt-5 max-w-[30rem] text-[17px] leading-relaxed text-ink/70">
            Your best teaching is already on video. Move the sliders to see what learners would pay for it.
          </p>

          <ol className="mt-10 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-1">
            {STEPS.map(([title, body], i) => (
              <li key={title} data-reveal className="flex gap-4">
                <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-[13px] font-semibold text-canvas">
                  {i + 1}
                </span>
                <span>
                  <span className="block text-[16px] font-semibold">{title}</span>
                  <span className="block text-[15px] leading-snug text-ink/65">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div data-reveal className="rounded-[28px] bg-brand-deep p-6 text-canvas shadow-[0_40px_80px_-40px_rgb(6_58_47/0.8)] sm:p-10">
          <p className="text-[14px] text-canvas/60">Sales in a year</p>
          <p aria-live="polite" className={`${SERIF} ${css.headline} mt-1 text-[clamp(2.6rem,6.4vw,5.4rem)] leading-none tracking-[-0.02em] text-gold [font-variant-numeric:lining-nums_tabular-nums]`}>
            <span ref={num}>{rupees(yearly)}</span>
          </p>
          <p className="mt-3 text-[13px] text-canvas/55">
            {courses} {courses === 1 ? "course" : "courses"} × {rupees(price)} × {buyers} {buyers === 1 ? "buyer" : "buyers"} a month × 12 months
          </p>

          <div className="mt-8 grid gap-6">
            <Slider label="Recorded courses" value={courses} min={1} max={40} step={1} show={String} onChange={setCourses} />
            <Slider label="Price of each course" value={price} min={299} max={4999} step={100} show={rupees} onChange={setPrice} />
            <Slider label="Buyers for each course, every month" value={buyers} min={1} max={100} step={1} show={String} onChange={setBuyers} />
          </div>

          <div className="mt-10">
            <p className="text-[14px] text-canvas/60">And it keeps selling</p>
            <div aria-hidden className="mt-4 grid h-44 grid-cols-5 gap-3">
              {years.map((v, i) => (
                <div key={i} className="flex flex-col">
                  <span className="mb-1.5 text-center text-[12px] font-semibold text-canvas/85 tabular">{short(v)}</span>
                  <div className="relative flex-1">
                    <span
                      className="absolute inset-x-0 bottom-0 rounded-t-lg bg-gold [transition:height_0.7s_cubic-bezier(0.22,1,0.36,1)]"
                      style={{ height: `${(v / years[4]) * 100}%`, opacity: 0.35 + i * 0.16 }}
                    />
                  </div>
                  <span className="mt-2 text-center text-[12px] text-canvas/55">Year {i + 1}</span>
                </div>
              ))}
            </div>
            <p className="sr-only">
              Over five years: {years.map((v, i) => `year ${i + 1}, ${rupees(v)}`).join("; ")}.
            </p>
          </div>

          <p className="mt-8 border-t border-canvas/10 pt-4 text-[12px] leading-relaxed text-canvas/50">
            Gross sales, before GST, payment fees and refunds. An estimate to plan with, not a promise.
          </p>
        </div>
      </Reveal>
    </section>
  );
}
