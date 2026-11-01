"use client";

import { AnimatePresence, motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { display } from "../fonts";
import { motionTokens } from "../motion";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";
import { CertificateVisual, InvoiceVisual, ReportVisual, SeatMapVisual, SellVisual, TeachVisual, TestVisual, WebsiteVisual } from "./StoryVisuals";

/*
 * One institute's day, from breakfast to night. The clock ticks forward as the page scrolls,
 * the product beside it changes with each stop, and the light goes from morning to dusk.
 * On wide screens the product stays pinned; on phones each stop carries its own view.
 */

type Stop = {
  id: string;
  time: string;
  who: string;
  title: React.ReactNode;
  body: string;
  points: string[];
  sky: string;
  Visual: (p: { active: boolean }) => React.ReactNode;
};

const accent = "text-[var(--day-accent)]";

const STOPS: Stop[] = [
  {
    id: "find",
    time: "7:30 am",
    who: "Your website",
    title: (
      <>
        Tara finds you <em className={accent}>before breakfast.</em>
      </>
    ),
    body: "Every institute gets its own public site with courses, faculty, reviews and a blog. Course cards fill themselves from what you publish, down to the next batch and the seats left.",
    points: ["Draft, preview, then publish", "Enquiries land in one inbox"],
    sky: "#faf6ea",
    Visual: WebsiteVisual,
  },
  {
    id: "batch",
    time: "8:15 am",
    who: "Enrolment",
    title: "She picks the batch that fits her week.",
    body: "Students see every open batch and the seats left. A seat is held for 10 minutes while they pay, and they're warned before anything clashes with their timetable.",
    points: ["Batch switches approved only when a seat is free", "Timetables rebuild the moment a class moves"],
    sky: "#faf6ea",
    Visual: SeatMapVisual,
  },
  {
    id: "class",
    time: "9:00 am",
    who: "Live classes",
    title: (
      <>
        Class starts. <em className={accent}>Attendance takes itself.</em>
      </>
    ),
    body: "Live classes open from the timetable and mark who joined. Lessons open on schedule, while XP, badges and leaderboards keep a batch moving.",
    points: ["Attendance marked as students join", "Video, PDF and text lessons, released on your schedule"],
    sky: "#fffdf7",
    Visual: TeachVisual,
  },
  {
    id: "test",
    time: "11:30 am",
    who: "Tests",
    title: "The mock is marked before lunch.",
    body: "Build tests from a shared question pool with five question types. Objective questions mark themselves, faculty grade the rest, and students see how they did.",
    points: ["Full-screen exits and tab switches recorded", "Test series for exam preparation"],
    sky: "#fffdf7",
    Visual: TestVisual,
  },
  {
    id: "fees",
    time: "1:00 pm",
    who: "Fees",
    title: (
      <>
        Every rupee comes <em className={accent}>with a receipt.</em>
      </>
    ),
    body: "Students pay by UPI, card or netbanking through Razorpay. Every paid order gets a GST invoice with the tax split worked out, and refunds are recorded against it.",
    points: ["A sales view made for accounts staff", "Accounts see money, never marks"],
    sky: "#fbf3dc",
    Visual: InvoiceVisual,
  },
  {
    id: "sell",
    time: "5:00 pm",
    who: "The marketplace",
    title: (
      <>
        This morning&apos;s lecture <em className={accent}>goes on sale.</em>
      </>
    ),
    body: "List a recorded course or a single lecture at your own price. Learners outside your institute buy it, and it opens straight in their library.",
    points: ["Priced separately from what your students pay", "Pause a listing any time"],
    sky: "#f7eccb",
    Visual: SellVisual,
  },
  {
    id: "certificate",
    time: "6:30 pm",
    who: "Certificates",
    title: "Riya finishes, and anyone can check it.",
    body: "Issue certificates in your own design, each with a QR code that opens a public verify page. Learners keep them and share them.",
    points: ["QR verification on every certificate", "Your own designs and signatories"],
    sky: "#f7eccb",
    Visual: CertificateVisual,
  },
  {
    id: "report",
    time: "8:00 pm",
    who: "Reports",
    title: (
      <>
        The board reads the day <em className={accent}>in a minute.</em>
      </>
    ),
    body: "Insights on enrolments, completion, revenue and faculty load, with a table behind every chart. Parents see their own child's week, and nobody sees more than they should.",
    points: ["Reports in CSV and Excel", "Read-only access for the board"],
    sky: "#063a2f",
    Visual: ReportVisual,
  },
];

const NIGHT = STOPS.length - 1;

export function Day() {
  const [active, setActive] = useState(0);
  const night = active === NIGHT;
  const stop = STOPS[active];

  return (
    <motion.section
      id="day"
      aria-labelledby="day-title"
      className="scroll-mt-20 px-5 pt-24 pb-10 [transition-property:color] duration-700 sm:px-8 md:pt-36 lg:px-12"
      initial={false}
      animate={{ backgroundColor: stop.sky }}
      transition={{ duration: motionTokens.duration.crawl, ease: motionTokens.easing.smooth }}
      style={{ color: night ? "#faf6ea" : "#14261f", "--day-accent": night ? "#d4a72a" : "#0b5e4c" } as React.CSSProperties}
    >
      <div className="mx-auto max-w-[1296px]">
        <Reveal className="max-w-4xl">
          <p className={`text-[15px] ${accent}`}>A day on Zinny</p>
          <h2 id="day-title" className={`${display.className} ${css.heading} mt-4 text-[clamp(2.75rem,6.4vw,6rem)] leading-[0.98] tracking-[-0.022em]`}>
            One institute, one day, <em className={accent}>one app.</em>
          </h2>
        </Reveal>

        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-x-16 lg:mt-0 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <ol className="min-w-0">
            {STOPS.map((s, i) => (
              <StopText key={s.id} stop={s} onActive={() => setActive(i)} />
            ))}
          </ol>

          {/* Pinned clock and product view (laptops and up) */}
          <div className="hidden lg:block">
            <div className="sticky top-0 flex h-dvh flex-col justify-center gap-5 pt-20 pb-8">
              <div className="flex items-end justify-between gap-6">
                <div className="relative h-[1.05em] min-w-0 flex-1 overflow-hidden text-[clamp(3rem,5vw,4.5rem)] leading-none">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.p
                      key={stop.time}
                      aria-hidden
                      className={`${display.className} ${css.headline} absolute whitespace-nowrap`}
                      initial={{ y: "100%", opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: "-100%", opacity: 0 }}
                      transition={{ duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth }}
                    >
                      {stop.time}
                    </motion.p>
                  </AnimatePresence>
                </div>
                <DayTrack active={active} />
              </div>
              <div className="relative min-h-0 w-full flex-1 lg:max-h-[580px]">
                {STOPS.map((s, i) => (
                  <motion.div
                    key={s.id}
                    aria-hidden={i !== active}
                    className="absolute inset-0 text-ink"
                    initial={false}
                    animate={{
                      opacity: i === active ? 1 : 0,
                      y: i === active ? 0 : i < active ? -motionTokens.distance.xl : motionTokens.distance.xl,
                      scale: i === active ? 1 : motionTokens.scale.subtle,
                    }}
                    transition={{ duration: motionTokens.duration.slow, ease: motionTokens.easing.smooth }}
                    style={{ pointerEvents: i === active ? "auto" : "none" }}
                  >
                    <s.Visual active={i === active} />
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

/** The day so far: a tick for each stop, with the gold line reaching the current one. */
function DayTrack({ active }: { active: number }) {
  return (
    <div aria-hidden className="relative mb-3 w-44 shrink-0 xl:w-56">
      <div className="h-px w-full bg-current opacity-20" />
      <motion.div
        className="absolute top-0 left-0 h-[2px] w-full origin-left -translate-y-px rounded-full bg-gold"
        initial={false}
        animate={{ scaleX: active / NIGHT }}
        transition={{ duration: motionTokens.duration.slow, ease: motionTokens.easing.smooth }}
      />
      <div className="absolute inset-x-0 -top-[3px] flex justify-between">
        {STOPS.map((s, i) => (
          <span key={s.id} className={`size-[7px] rounded-full ${i <= active ? "bg-gold" : "bg-current opacity-30"}`} />
        ))}
      </div>
    </div>
  );
}

function StopText({ stop, onActive }: { stop: Stop; onActive: () => void }) {
  const ref = useRef<HTMLLIElement>(null);
  // A stop counts as current while it crosses the middle of the screen.
  const current = useInView(ref, { margin: "-45% 0px -45% 0px" });
  // On phones, each stop's own view plays once it is mostly on screen.
  const seen = useInView(ref, { once: true, margin: "-30% 0px -30% 0px" });
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    if (current) onActive();
  }, [current, onActive]);
  useEffect(() => {
    if (seen) setPlayed(true);
  }, [seen]);

  const { Visual } = stop;
  return (
    <li ref={ref} id={`stop-${stop.id}`} className="flex scroll-mt-20 flex-col justify-center py-12 lg:min-h-[86dvh] lg:py-0">
      <Reveal>
        <p className="flex flex-wrap items-baseline gap-x-3 text-[15px]">
          <span className={`${display.className} ${css.subheading} text-[26px] leading-none lg:hidden`}>{stop.time}</span>
          <span className={accent}>{stop.who}</span>
        </p>
        <h3 className={`${display.className} ${css.subheading} mt-4 text-[clamp(2.1rem,3.6vw,3.4rem)] leading-[1.03] tracking-[-0.015em] ${css.balance}`}>{stop.title}</h3>
        <p className={`mt-5 max-w-lg text-[16px] leading-relaxed opacity-75 ${css.pretty}`}>{stop.body}</p>
        <ul className="mt-6 space-y-2.5 text-[15px]">
          {stop.points.map((p) => (
            <li key={p} className="flex items-start gap-3">
              <span aria-hidden className="mt-[0.75em] h-px w-5 shrink-0 bg-current opacity-40" />
              {p}
            </li>
          ))}
        </ul>
      </Reveal>
      {/* Phones: the view takes the height its content needs, so nothing is cut off. */}
      <div className="mt-9 w-full text-ink lg:hidden">
        <Visual active={played} />
      </div>
    </li>
  );
}
