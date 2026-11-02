import { display } from "../fonts";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

const SERIF = display.className;

/** What Zinny already does for the way Indian institutes work. Each line is something the product does today. */
const FACTS = [
  ["UPI, cards and netbanking", "Students pay online through Razorpay, and a seat is held for them while they do."],
  ["GST invoices on every sale", "CGST and SGST worked out for each course, numbered in your institute's own series, emailed on payment."],
  ["Your records stay yours", "Every institute's data is walled off from every other institute's, down to the database."],
  ["Certificates anyone can check", "Each certificate has a public link that proves it is real."],
  ["A place for every role", "Owner, heads of department, permanent and visiting faculty, accounts, students and parents."],
  ["Built for phones", "Students and parents use Zinny on the phone they already have, with nothing to install."],
];

export function India() {
  return (
    <section aria-labelledby="india" className="py-24 sm:py-32">
      <Reveal className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <h2 id="india" data-reveal className={`${SERIF} ${css.headline} max-w-[18ch] text-[clamp(2.4rem,5vw,4.4rem)] leading-[1.04] tracking-[-0.02em] text-ink`}>
          Made for how Indian institutes <span className="text-brand">actually work.</span>
        </h2>
        <dl className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {FACTS.map(([t, d]) => (
            <div key={t} data-reveal className="relative pt-5">
              <span data-rule aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gold" />
              <dt className={`${SERIF} ${css.accent} text-[24px] leading-tight text-ink`}>{t}</dt>
              <dd className="mt-2 text-[16px] leading-relaxed text-ink/70">{d}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </section>
  );
}
