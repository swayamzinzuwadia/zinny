"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { display } from "../fonts";
import css from "../landing.module.css";

gsap.registerPlugin(useGSAP);

const SERIF = display.className;
const screen = "rounded-2xl bg-surface p-5 text-[13px] text-ink shadow-[0_30px_60px_-30px_rgb(6_58_47/0.55),0_0_0_1px_rgb(20_38_31/0.07)]";
const row = "flex items-center justify-between gap-3 border-b border-line py-2 last:border-0";

/* Each part of Zinny, shown as a small working screen. Illustrations: names and numbers are examples. */

function Batches() {
  const taken = 17;
  return (
    <div className={screen}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[15px] font-semibold">Data Analytics · Weekday morning</div>
          <div className="mt-0.5 text-muted">Mon to Fri, 9 to 11 am · Prof. Farah</div>
        </div>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">Open</span>
      </div>
      <div className="mt-4 grid grid-cols-10 gap-1.5">
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className={`aspect-square rounded-md ${i < taken ? "bg-brand" : i < 18 ? "bg-gold" : "bg-line"}`} />
        ))}
      </div>
      <div className="mt-3 flex justify-between text-muted">
        <span>17 seats taken · 1 held at checkout</span>
        <span>2 left</span>
      </div>
    </div>
  );
}

function Live() {
  return (
    <div className={screen}>
      <div className="flex items-center gap-2">
        <span className="size-2 animate-pulse rounded-full bg-gold" />
        <span className="font-semibold">Live now · Python Basics</span>
        <span className="ml-auto rounded-full bg-brand px-3 py-1 text-[11px] font-medium text-canvas">Join class</span>
      </div>
      <div className="mt-4 space-y-0">
        {[
          ["Aarav Mehta", true],
          ["Diya Shah", true],
          ["Kabir Rao", false],
          ["Meera Iyer", true],
        ].map(([n, p]) => (
          <div key={String(n)} className={row}>
            <span>{n}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${p ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"}`}>{p ? "Present" : "Absent"}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-muted">Students are marked present as they join, and absent if they miss it.</div>
    </div>
  );
}

function Tests() {
  const bars = [42, 64, 88, 71, 55, 93, 77];
  return (
    <div className={screen}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Mid-term mock test · Results</span>
        <span className="text-muted">31 attempts</span>
      </div>
      <div className="mt-4 flex h-28 items-end gap-2">
        {bars.map((b, i) => (
          <span key={i} className="flex-1 rounded-t-md bg-brand/85" style={{ height: `${b}%` }} />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ["72%", "Average"],
          ["6", "To grade"],
          ["12", "Assignments due"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-lg bg-canvas py-2">
            <div className="tabular text-[16px] font-semibold">{v}</div>
            <div className="text-[11px] text-muted">{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Fees() {
  return (
    <div className={screen}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Checkout · Tally for beginners</span>
        <span className="text-muted">Seat held for 10 min</span>
      </div>
      <div className="mt-3 space-y-0">
        <div className={row}>
          <span className="text-muted">Course fee</span>
          <span className="tabular">₹6,000.00</span>
        </div>
        <div className={row}>
          <span className="text-muted">CGST 9%</span>
          <span className="tabular">₹540.00</span>
        </div>
        <div className={row}>
          <span className="text-muted">SGST 9%</span>
          <span className="tabular">₹540.00</span>
        </div>
        <div className={`${row} text-[15px] font-semibold`}>
          <span>Total</span>
          <span className="tabular">₹7,080.00</span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[12px] font-medium">
        {["UPI", "Card", "Netbanking"].map((m) => (
          <span key={m} className="rounded-lg border border-line py-2">
            {m}
          </span>
        ))}
      </div>
      <div className="mt-3 text-muted">The GST invoice is issued and emailed the moment the payment clears.</div>
    </div>
  );
}

function Certificates() {
  return (
    <div className={screen}>
      <div className="rounded-xl border-2 border-gold/60 bg-[#fffaf0] p-5 text-center">
        <div className="text-[11px] text-muted">Certificate of completion</div>
        <div className={`${SERIF} mt-2 text-[24px] leading-tight font-semibold`}>Meera Iyer</div>
        <div className="mt-1 text-muted">completed Machine Learning Foundations</div>
        <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-brand">
          <span className="size-1.5 rounded-full bg-brand" />
          Anyone can check it at zinny/verify
        </div>
      </div>
      <div className="mt-3 text-muted">Issued on completion, by hand or automatically, with your institute&apos;s template.</div>
    </div>
  );
}

function Website() {
  return (
    <div className={`${screen} p-0`}>
      <div className="rounded-t-2xl bg-brand-deep px-5 pt-5 pb-6 text-canvas">
        <div className="text-[11px] text-canvas/60">yourinstitute · Home · Courses · Faculty · Blog</div>
        <div className={`${SERIF} mt-3 text-[22px] leading-tight font-semibold`}>Coaching that gets results, in Navi Mumbai.</div>
        <div className="mt-3 inline-block rounded-full bg-gold px-3 py-1 text-[11px] font-semibold text-brand-deep">Next batch starts Monday</div>
      </div>
      <div className="grid grid-cols-2 gap-3 p-5">
        <div className="rounded-lg bg-canvas p-3">
          <div className="font-semibold">Python Basics</div>
          <div className="text-[11px] text-muted">₹4,000 + GST · 2 seats left</div>
        </div>
        <div className="rounded-lg bg-canvas p-3">
          <div className="font-semibold">Ask us anything</div>
          <div className="text-[11px] text-muted">Enquiries land in your inbox</div>
        </div>
      </div>
    </div>
  );
}

function Selling() {
  return (
    <div className={screen}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">Marketplace sales</span>
        <span className="tabular text-[16px] font-semibold">₹38,987</span>
      </div>
      <div className="mt-3 space-y-0">
        {[
          ["Data Analytics, recorded", "₹2,999", "40% off", "13 buyers"],
          ["Python + Data Analytics combo", "₹4,499", "36% off", "4 buyers"],
          ["Neural networks, one lecture", "₹399", "", "21 buyers"],
        ].map(([t, p, d, b]) => (
          <div key={t} className={row}>
            <span className="min-w-0 truncate">{t}</span>
            <span className="flex shrink-0 items-center gap-2">
              {d && <span className="rounded-full bg-gold px-1.5 text-[10px] font-semibold text-brand-deep">{d}</span>}
              <span className="tabular font-medium">{p}</span>
              <span className="text-[11px] text-muted">{b}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-[12px]">
        <span className="font-mono font-semibold">DIWALI20</span>
        <span className="text-muted">20% off everything you sell · 48 of 100 used</span>
      </div>
    </div>
  );
}

function People() {
  return (
    <div className={screen}>
      <div className="font-semibold">Roles and permissions</div>
      <div className="mt-3 space-y-0">
        {[
          ["Institute Admin", "Everything"],
          ["Head of department", "Their department's courses, staff and students"],
          ["Faculty", "Their own batches: classes, attendance, grading"],
          ["Accounts and fees", "Payments, refunds and reports"],
          ["Students and parents", "The learner app, nothing else"],
        ].map(([r, a]) => (
          <div key={r} className={row}>
            <span className="font-medium">{r}</span>
            <span className="max-w-[60%] text-right text-[12px] text-muted">{a}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PARTS: { key: string; title: string; line: string; Screen: () => ReactNode }[] = [
  { key: "batches", title: "Courses and batches", line: "Timings, seats and faculty for every batch, with students switching batch on request.", Screen: Batches },
  { key: "live", title: "Live classes and attendance", line: "Classes run from the timetable, and attendance takes care of itself.", Screen: Live },
  { key: "tests", title: "Tests and assignments", line: "Question pools, timed tests, grading and results students can see.", Screen: Tests },
  { key: "fees", title: "Fees with UPI and GST invoices", line: "Students pay online, seats are held while they do, invoices go out on their own.", Screen: Fees },
  { key: "marketplace", title: "Selling on the marketplace", line: "Courses, single lectures and combos, with deals and discount codes.", Screen: Selling },
  { key: "certificates", title: "Certificates", line: "Issued on completion, and verifiable by anyone with the link.", Screen: Certificates },
  { key: "website", title: "Your own website", line: "Courses, faculty, reviews and an enquiry form, with no web agency.", Screen: Website },
  { key: "people", title: "People and permissions", line: "Every person sees exactly their part, from the owner to a visiting teacher.", Screen: People },
];

const DWELL = 5600;

/**
 * Everything an institute runs on, as a tour of the product: pick a part and its screen comes
 * up beside it. It walks through the parts on its own, and stops for good once the visitor
 * picks one or moves into it.
 */
export function Features() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  const pick = useCallback((i: number, byHand: boolean) => {
    if (byHand) setAuto(false);
    setActive(i);
  }, []);

  // The walk-through: a progress line fills under the current part, then the next one comes up.
  useEffect(() => {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setActive((i) => (i + 1) % PARTS.length), DWELL);
    bar.current?.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: DWELL, easing: "linear" });
    return () => clearTimeout(t);
  }, [active, auto]);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.fromTo(stage.current!.firstElementChild, { opacity: 0, y: 18, rotateX: 6 }, { opacity: 1, y: 0, rotateX: 0, duration: 0.55, ease: "power3.out" });
      });
      return () => mm.revert();
    },
    { dependencies: [active], scope: stage },
  );

  const { Screen } = PARTS[active];

  return (
    <section aria-labelledby="features" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <h2 id="features" className={`${SERIF} ${css.headline} max-w-[18ch] text-[clamp(2.4rem,5vw,4.4rem)] leading-[1.04] tracking-[-0.02em] text-ink`}>
          Everything your institute runs on, <span className="text-brand">in one place.</span>
        </h2>
        <p className="mt-5 max-w-[38rem] text-[17px] leading-relaxed text-ink/70">
          No spreadsheet for fees, no group chat for timetables, no separate app for tests. Each part below is a real part of Zinny.
        </p>

        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16" onMouseEnter={() => setAuto(false)}>
          <div role="tablist" aria-label="Parts of Zinny" aria-orientation="vertical" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:p-0">
            {PARTS.map((p, i) => {
              const on = i === active;
              return (
                <button
                  key={p.key}
                  role="tab"
                  type="button"
                  id={`part-${p.key}`}
                  aria-selected={on}
                  aria-controls="part-stage"
                  onClick={() => pick(i, true)}
                  onFocus={() => pick(i, true)}
                  className={`relative shrink-0 rounded-2xl px-4 py-3 text-left [transition-property:background-color,color] duration-200 lg:block lg:w-full lg:px-5 lg:py-4 ${
                    on ? "bg-brand-deep text-canvas" : "bg-surface text-ink ring-1 ring-line hover:bg-canvas lg:bg-transparent lg:ring-0"
                  }`}
                >
                  <span className="block text-[15px] font-semibold whitespace-nowrap lg:text-[17px] lg:whitespace-normal">{p.title}</span>
                  <span className={`mt-1 hidden text-[14px] leading-snug lg:block ${on ? "text-canvas/70" : "text-muted"}`}>{p.line}</span>
                  {on && auto && <span ref={bar} aria-hidden className="absolute inset-x-5 bottom-2 hidden h-0.5 origin-left rounded-full bg-gold lg:block" />}
                </button>
              );
            })}
          </div>
          <div className="lg:sticky lg:top-28 lg:self-start">
            <div id="part-stage" role="tabpanel" aria-labelledby={`part-${PARTS[active].key}`} ref={stage} className="[perspective:1400px]">
              <div key={PARTS[active].key}>
                <Screen />
              </div>
            </div>
            <p className="mt-4 text-[14px] text-muted lg:hidden">{PARTS[active].line}</p>
            <p className="mt-3 text-[12px] text-muted">Illustrations of Zinny. The names and numbers are examples.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
