import { Reveal } from "./Reveal";

/** Where testimonials would go, true product facts instead. */
const FACTS = [
  { title: "Row-level security", body: "on every table that holds an institute's data, enforced by the database itself" },
  { title: "A GST invoice", body: "for every paid order, with CGST and SGST or IGST worked out for you" },
  { title: "Seats held for 10 minutes", body: "while a student pays. Five students, one seat: exactly one gets it" },
  { title: "Timetables that build themselves", body: "and update the moment a class is moved or cancelled" },
];

export function Facts() {
  return (
    <section aria-label="What Zinny guarantees" className="px-4 pt-8 pb-28 md:pt-16 md:pb-36">
      <ul className="mx-auto grid max-w-6xl gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {FACTS.map((f, i) => (
          <li key={f.title}>
            <Reveal delay={i * 0.08} className="border-t border-line pt-5">
              <p className="text-[15px] font-medium text-ink">{f.title}</p>
              <p className="mt-1.5 text-[14px] leading-relaxed text-muted">{f.body}</p>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}
