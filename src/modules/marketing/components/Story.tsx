"use client";

import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { display } from "../fonts";
import { motionTokens, springs } from "../motion";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";
import { CertificateVisual, InvoiceVisual, SeatMapVisual, TeachVisual, WebsiteVisual } from "./StoryVisuals";

/*
 * The scroll story. On wide screens the chapter text scrolls while the product view stays
 * pinned and changes with it. On phones each chapter carries its own view, no pinning.
 */

type Chapter = {
  id: string;
  short: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  Visual: (p: { active: boolean }) => React.ReactNode;
};

const CHAPTERS: Chapter[] = [
  {
    id: "run",
    short: "Run",
    eyebrow: "Run the institute",
    title: "Batches that fill fairly. Timetables that keep up.",
    body: "Departments, courses and batches with real seat limits. Students pick the batch that fits their week, seats are held while they pay, and every timetable rebuilds itself the moment a class moves.",
    points: ["Seat held for 10 minutes while paying", "A clash warning before anyone enrols", "Batch switches approved only when a seat is free"],
    Visual: SeatMapVisual,
  },
  {
    id: "teach",
    short: "Teach",
    eyebrow: "Teach and engage",
    title: "Classes that take their own attendance.",
    body: "Live classes open from the timetable and mark who joined. Lessons open on schedule, tests draw from a shared question pool, and assignments follow the late rules you set. Polls, leaderboards and badges keep a batch moving.",
    points: ["Attendance marked as students join", "Question pools with five question types", "XP for lessons, tests, classes and assignments"],
    Visual: TeachVisual,
  },
  {
    id: "paid",
    short: "Get paid",
    eyebrow: "Get paid properly",
    title: "Every rupee comes with a receipt.",
    body: "Students pay by UPI, card or netbanking through Razorpay. Every paid order gets a GST invoice with the tax split worked out, refunds are recorded against it, and accounts staff see sales without seeing anything else.",
    points: ["A GST invoice for every paid order", "Refunds tracked against the invoice", "A sales view made for accounts"],
    Visual: InvoiceVisual,
  },
  {
    id: "prove",
    short: "Prove it",
    eyebrow: "Prove it",
    title: "Certificates anyone can check.",
    body: "Issue certificates in your own design, each with a QR code that opens a public verify page. The board gets reports and insights on enrolments, completion, revenue and faculty load, ready to export.",
    points: ["QR verification on every certificate", "Reports in CSV and Excel", "Insights the board can read in a minute"],
    Visual: CertificateVisual,
  },
  {
    id: "site",
    short: "Website",
    eyebrow: "Your own website",
    title: "A website that knows your seat counts.",
    body: "Every institute gets a public site with courses, faculty, reviews, a gallery, a blog and an enquiry form. Course cards fill themselves from what you publish, with the next batch and the seats left.",
    points: ["Draft, preview, then publish", "Faculty profiles you approve", "Enquiries land in one inbox"],
    Visual: WebsiteVisual,
  },
];

export function Story() {
  const [active, setActive] = useState(0);

  return (
    <section id="story" aria-labelledby="story-title" className="scroll-mt-24 px-4 pt-32 pb-16 md:pt-44">
      <div className="mx-auto max-w-6xl">
        <Reveal className="max-w-3xl">
          <p className="text-[14px] text-brand">How it works</p>
          <h2
            id="story-title"
            className={`${display.className} mt-4 text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[0.98] tracking-[-0.02em] ${css.balance}`}
          >
            Everything an institute runs, from one quiet place.
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-x-16 lg:mt-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <ol>
            {CHAPTERS.map((c, i) => (
              <ChapterText key={c.id} chapter={c} index={i} onActive={() => setActive(i)} />
            ))}
          </ol>

          {/* Pinned product view (desktop) */}
          <div className="hidden lg:block">
            <div className="sticky top-0 flex h-dvh items-center py-24">
              <div className="w-full">
                <ChapterTabs active={active} />
                <div className="relative mt-6 aspect-[10/9] w-full">
                  {CHAPTERS.map((c, i) => (
                    <motion.div
                      key={c.id}
                      aria-hidden={i !== active}
                      className="absolute inset-0"
                      initial={false}
                      animate={{
                        opacity: i === active ? 1 : 0,
                        y: i === active ? 0 : i < active ? -motionTokens.distance.xl : motionTokens.distance.xl,
                        scale: i === active ? 1 : motionTokens.scale.subtle,
                      }}
                      transition={{ duration: motionTokens.duration.slow, ease: motionTokens.easing.smooth }}
                      style={{ pointerEvents: i === active ? "auto" : "none" }}
                    >
                      <c.Visual active={i === active} />
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChapterTabs({ active }: { active: number }) {
  return (
    <ol aria-hidden className="flex gap-1 text-[13px]">
      {CHAPTERS.map((c, i) => (
        <li key={c.id} className="relative px-3 py-1.5">
          {i === active && (
            <motion.span
              layoutId="chapter-pill"
              className="absolute inset-0 rounded-full bg-surface ring-1 ring-line"
              transition={springs.snappy}
            />
          )}
          <span className={`relative flex items-center gap-1.5 ${i === active ? "text-ink" : "text-faint"}`}>
            {i === active && <span className="size-1.5 rounded-full bg-gold" />}
            {c.short}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ChapterText({ chapter, index, onActive }: { chapter: Chapter; index: number; onActive: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  // A chapter counts as current while it crosses the middle of the screen.
  const current = useInView(ref, { margin: "-45% 0px -45% 0px" });
  // On phones, each chapter's own view plays once it is mostly on screen.
  const seen = useInView(ref, { once: true, margin: "-30% 0px -30% 0px" });
  const [mobileActive, setMobileActive] = useState(false);

  useEffect(() => {
    if (current) onActive();
  }, [current, onActive]);
  useEffect(() => {
    if (seen) setMobileActive(true);
  }, [seen]);

  const { Visual } = chapter;
  return (
    <li ref={ref} className="flex flex-col justify-center py-14 lg:min-h-dvh lg:py-0">
      <Reveal>
        <p className="flex items-center gap-3 text-[14px] text-brand">
          <span className="text-faint tabular">{String(index + 1).padStart(2, "0")}</span>
          {chapter.eyebrow}
        </p>
        <h3 className={`${display.className} mt-4 text-[clamp(2rem,3.6vw,3.25rem)] leading-[1.02] tracking-[-0.015em] ${css.balance}`}>
          {chapter.title}
        </h3>
        <p className={`mt-5 max-w-lg text-[16px] leading-relaxed text-muted ${css.pretty}`}>{chapter.body}</p>
        <ul className="mt-7 space-y-2.5">
          {chapter.points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-[15px]">
              <span aria-hidden className="mt-[0.75em] h-px w-5 shrink-0 bg-brand/40" />
              {p}
            </li>
          ))}
        </ul>
      </Reveal>
      {/* Phones: the view takes the height its content needs, so nothing is cut off. */}
      <div className="mt-10 w-full lg:hidden">
        <Visual active={mobileActive} />
      </div>
    </li>
  );
}
