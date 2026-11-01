import Link from "next/link";
import { demoHref } from "../config";
import { display } from "../fonts";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

/** A picture of the marketplace, so like the other product pictures it shows demo institutes. */
const PREVIEW = [
  { institute: "Demo Institute", kind: "Course", title: "Data Analytics: the full recordings", detail: "8 lessons · 2 h 46 min", price: "₹4,129" },
  { institute: "Demo Institute", kind: "Lecture", title: "Python in an hour: the big picture", detail: "1 lesson · 1 h", price: "₹353" },
  { institute: "Riverside College of Commerce", kind: "Course", title: "GST for small businesses", detail: "12 lessons · 6 h", price: "₹2,950" },
];

const STUDENTS = [
  "Buy a whole recorded course, or one lecture on the topic you need",
  "Watch at your own pace, with your progress saved",
  "Get a GST invoice with every purchase, and keep what you buy in My library",
  "Open to independent learners and to alumni of any institute on Zinny",
];

const INSTITUTES = [
  "List a whole course or a single video lecture you've already recorded",
  "Set your own price, separate from what your students pay",
  "Reach learners beyond your own batches",
  "Pause a listing any time. People who bought it keep their access",
];

function Points({ items, onDark }: { items: string[]; onDark?: boolean }) {
  return (
    <ul className={`mt-6 space-y-3 text-[15px] leading-relaxed ${onDark ? "text-canvas/80" : "text-muted"}`}>
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span aria-hidden className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function Preview() {
  return (
    <div aria-hidden className={`rounded-[28px] bg-surface p-4 sm:p-6 ${css.sheet}`}>
      <div className="grid gap-3 md:grid-cols-3">
        {PREVIEW.map((p) => (
          <div key={p.title} className="flex flex-col rounded-[20px] border border-line bg-canvas/50 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <span className="min-w-0 truncate text-muted">{p.institute}</span>
              <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-0.5 font-medium text-brand-strong">{p.kind}</span>
            </div>
            <p className={`${display.className} ${css.accent} mt-3 text-[21px] leading-[1.2] text-ink`}>{p.title}</p>
            <div className="mt-auto flex items-baseline justify-between gap-3 pt-5">
              <span className="text-[12px] text-muted">{p.detail}</span>
              <span className="tabular text-[15px] font-medium text-ink">{p.price}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The marketplace, for both sides of it: institutes sell their recordings and students buy them. */
export function Marketplace() {
  return (
    <section id="marketplace" aria-labelledby="marketplace-title" className="scroll-mt-24 px-4 pt-8 pb-28 md:pb-36">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-[14px] text-brand">The Zinny marketplace</p>
          <h2
            id="marketplace-title"
            className={`${display.className} ${css.heading} mt-4 text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[0.98] tracking-[-0.02em] ${css.balance}`}
          >
            Learn from institutes, <em className="text-brand">at your own pace.</em>
          </h2>
          <p className={`mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-muted ${css.pretty}`}>
            Institutes sell their recorded courses and lectures directly to students, and anyone can sign up to buy them, with or without an institute of their own.
          </p>
        </Reveal>

        <Reveal className="mt-12">
          <Preview />
        </Reveal>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Reveal className="h-full">
            <div className="flex h-full flex-col rounded-[28px] border border-line bg-surface p-6 sm:p-8">
              <p className="text-[14px] text-brand">For students</p>
              <h3 className={`${display.className} ${css.subheading} mt-3 text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.08]`}>Buy what you want to learn</h3>
              <Points items={STUDENTS} />
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-8">
                <Link
                  href="/signup"
                  className="inline-flex h-12 items-center rounded-full bg-brand px-7 text-[15px] font-medium text-canvas [transition-property:background-color,transform] duration-150 hover:bg-brand-strong active:scale-[0.96]"
                >
                  Create a student account
                </Link>
                <Link href="/login?next=/marketplace" className="inline-flex h-12 items-center rounded-full px-6 text-[15px] text-ink ring-1 ring-line [transition-property:background-color,box-shadow] duration-150 hover:bg-canvas hover:ring-faint">
                  Sign in
                </Link>
              </div>
            </div>
          </Reveal>

          <Reveal className="h-full" delay={0.08}>
            <div className="flex h-full flex-col rounded-[28px] bg-brand-deep p-6 text-canvas sm:p-8">
              <p className="text-[14px] text-gold">For institutes</p>
              <h3 className={`${display.className} ${css.subheading} mt-3 text-[clamp(1.75rem,3vw,2.5rem)] leading-[1.08]`}>Sell what you already teach</h3>
              <Points items={INSTITUTES} onDark />
              <div className="mt-auto pt-8">
                <a
                  href={demoHref}
                  className="inline-flex h-12 items-center rounded-full bg-canvas px-7 text-[15px] font-medium text-brand-deep [transition-property:background-color,transform] duration-150 hover:bg-surface active:scale-[0.96]"
                >
                  Book a demo
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
