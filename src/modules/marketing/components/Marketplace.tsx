import Link from "next/link";
import { demoHref } from "../config";
import { display } from "../fonts";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";
import { Shelf } from "./Shelf";

const STUDENTS = [
  "Buy a whole recorded course, or one lecture on the topic you need",
  "Watch at your own pace, with your progress saved",
  "Get a GST invoice with every purchase, and keep it all in My library",
  "Open to independent learners and to alumni of any institute on Zinny",
];

const INSTITUTES = [
  "List a whole course or a single video lecture you've already recorded",
  "Set your own price, separate from what your students pay",
  "Reach learners beyond your own batches",
  "Pause a listing any time. People who bought it keep their access",
];

function Points({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 divide-y divide-line border-y border-line text-[15px] leading-relaxed">
      {items.map((item) => (
        <li key={item} className="py-3">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** The main business: institutes stock the shelf, anyone can learn from it. */
export function Marketplace() {
  return (
    <section id="marketplace" aria-labelledby="marketplace-title" className="scroll-mt-20 px-5 py-24 sm:px-8 md:py-36 lg:px-12">
      <div className="mx-auto max-w-[1296px]">
        <Reveal className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end lg:gap-14">
          <div>
            <p className="text-[15px] text-brand">The Zinny marketplace</p>
            <h2 id="marketplace-title" className={`${display.className} ${css.heading} mt-4 text-[clamp(2.75rem,6.4vw,6rem)] leading-[0.98] tracking-[-0.022em]`}>
              Institutes stock the shelf. <em className="text-brand">Anyone can learn from it.</em>
            </h2>
          </div>
          <p className={`max-w-md text-[17px] leading-relaxed text-muted ${css.pretty}`}>
            Recorded courses and single lectures, sold directly by the institutes that teach them. No institute of your own needed.
          </p>
        </Reveal>

        <Reveal>
          <Shelf />
        </Reveal>

        <div className="mt-20 grid gap-14 lg:grid-cols-2 lg:gap-20">
          <Reveal>
            <p className="text-[15px] text-brand">For students</p>
            <h3 className={`${display.className} ${css.subheading} mt-3 text-[clamp(2rem,3.4vw,3rem)] leading-[1.06]`}>Buy what you want to learn</h3>
            <Points items={STUDENTS} />
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center rounded-full bg-brand px-7 text-[15px] font-medium text-canvas [transition-property:background-color,transform] duration-150 hover:bg-brand-strong active:scale-[0.96]"
              >
                Create a student account
              </Link>
              <Link href="/login?next=/marketplace" className="inline-flex h-12 items-center rounded-full px-6 text-[15px] text-ink ring-1 ring-line [transition-property:background-color,box-shadow] duration-150 hover:bg-surface hover:ring-faint">
                Sign in
              </Link>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <p className="text-[15px] text-brand">For institutes</p>
            <h3 className={`${display.className} ${css.subheading} mt-3 text-[clamp(2rem,3.4vw,3rem)] leading-[1.06]`}>Sell what you already teach</h3>
            <Points items={INSTITUTES} />
            <div className="mt-7">
              <a
                href={demoHref}
                className="inline-flex h-12 items-center rounded-full bg-brand-deep px-7 text-[15px] font-medium text-canvas [transition-property:background-color,transform] duration-150 hover:bg-brand active:scale-[0.96]"
              >
                Book a demo
              </a>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
