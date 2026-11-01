import Link from "next/link";
import { display } from "../fonts";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

const POINTS = [
  { title: "Recorded courses and single lectures", body: "sold directly by the institutes that teach them" },
  { title: "Yours once you've paid", body: "everything you buy stays in My library, with a GST invoice for each purchase" },
  { title: "Open to alumni too", body: "graduates of any institute on Zinny can keep learning here" },
];

/** The student's way in: sign up on your own and buy from institutes on the marketplace. */
export function Marketplace() {
  return (
    <section aria-labelledby="marketplace-title" className="px-4 py-28 md:py-36">
      <Reveal className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <div>
          <p className="text-[14px] text-brand">For students</p>
          <h2
            id="marketplace-title"
            className={`${display.className} ${css.heading} mt-4 text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[0.98] tracking-[-0.02em] ${css.balance}`}
          >
            Not at an institute? <em className="text-brand">Learn from one.</em>
          </h2>
          <p className={`mt-6 max-w-xl text-[17px] leading-relaxed text-muted ${css.pretty}`}>
            Create a free account and buy recorded lessons straight from institutes on Zinny, then watch them at your own pace.
          </p>
          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center rounded-full bg-brand px-7 text-[15px] font-medium text-canvas [transition-property:background-color,transform] duration-150 hover:bg-brand-strong active:scale-[0.96]"
            >
              Create a student account
            </Link>
            <Link href="/login" className="inline-flex h-12 items-center rounded-full px-6 text-[15px] text-ink ring-1 ring-line [transition-property:background-color,box-shadow] duration-150 hover:bg-surface hover:ring-faint">
              Sign in
            </Link>
          </div>
        </div>
        <ul className="space-y-6">
          {POINTS.map((p) => (
            <li key={p.title} className="border-t border-line pt-5">
              <p className="text-[15px] font-medium text-ink">{p.title}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{p.body}</p>
            </li>
          ))}
        </ul>
      </Reveal>
    </section>
  );
}
