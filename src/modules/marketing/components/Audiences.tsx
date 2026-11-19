"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useRef, useState, type ReactNode } from "react";
import { display } from "../fonts";
import css from "../landing.module.css";

gsap.registerPlugin(useGSAP);

const SERIF = display.className;
const card = "rounded-2xl bg-surface p-5 text-[13px] text-ink shadow-[0_30px_60px_-30px_rgb(6_58_47/0.55),0_0_0_1px_rgb(20_38_31/0.07)]";
const line = "flex items-center justify-between gap-3 border-b border-line py-2 last:border-0";

/* Small illustrative screens, one per kind of person. Names and numbers are examples. */

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-brand-soft">
      <div data-bar className="h-full origin-left rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </div>
  );
}

function InstitutePreview() {
  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-semibold">Data Analytics · Weekday morning</div>
          <div className="mt-0.5 text-muted">Mon to Fri, 9 to 11 am · Prof. Farah</div>
        </div>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">12 seats left</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 text-center">
        {[
          ["28", "students"],
          ["96%", "attendance"],
          ["3", "tests this month"],
        ].map(([n, l]) => (
          <div key={l} data-row className="rounded-xl bg-brand-soft/60 py-3">
            <div className="tabular text-[20px] font-semibold text-brand">{n}</div>
            <div className="text-[12px] text-muted">{l}</div>
          </div>
        ))}
      </div>
      <div className="mt-3">
        {[
          ["Fees collected this month", "₹3,36,000"],
          ["Timetable for next week", "Ready"],
          ["Parents told about Friday's test", "Sent"],
        ].map(([a, b]) => (
          <div key={a} data-row className={line}>
            <span>{a}</span>
            <span className="font-medium text-brand">{b}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UniversityPreview() {
  return (
    <div className={card}>
      <div className="text-[15px] font-semibold">Departments</div>
      <div className="mt-2">
        {[
          ["Computer Science", "Head: Dr. Rao", "420 students"],
          ["Commerce", "Head: Dr. Menon", "610 students"],
          ["Law", "Head: Prof. Iqbal", "280 students"],
        ].map(([d, h, s]) => (
          <div key={d} data-row className={line}>
            <span>
              <span className="block font-medium">{d}</span>
              <span className="text-[12px] text-muted">{h}</span>
            </span>
            <span className="tabular text-muted">{s}</span>
          </div>
        ))}
      </div>
      <div data-row className="mt-3 rounded-xl bg-brand-soft/60 p-3 text-[12px] text-ink/80">
        Each person sees only their part: a head of department sees their department, a visiting teacher sees their batches.
      </div>
    </div>
  );
}

function TeacherPreview() {
  const rows = [
    ["Ananya, Pune", "bought the full course", "₹1,499"],
    ["Rahul, Guwahati", "bought Lecture 7", "₹199"],
    ["Meera, Jaipur", "bought the SQL combo", "₹2,499"],
  ];
  return (
    <div className={card}>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold">Python Basics: recorded course</span>
        <span className="flex items-center gap-1.5 text-muted">
          <span aria-hidden className="size-2 rounded-full bg-gold" />
          New sales
        </span>
      </div>
      <div className="mt-2">
        {rows.map(([w, what, amt]) => (
          <div key={w} data-row className={line}>
            <span>
              <b className="font-semibold">{w}</b> <span className="text-muted">{what}</span>
            </span>
            <span className="tabular font-semibold">{amt}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-muted">Record a class once and list it. Learners can buy it any day, at the price you set.</p>
    </div>
  );
}

function StudentPreview() {
  return (
    <div className={card}>
      <div className="text-[15px] font-semibold">My learning</div>
      <div className="mt-3 space-y-3">
        {[
          ["Python Basics", 72],
          ["Spoken English", 45],
          ["Maths: Class 10", 90],
        ].map(([t, p]) => (
          <div key={t} data-row>
            <div className="mb-1 flex justify-between">
              <span className="font-medium">{t}</span>
              <span className="tabular text-muted">{p}%</span>
            </div>
            <Bar pct={Number(p)} />
          </div>
        ))}
      </div>
      <div data-row className="mt-4 rounded-xl bg-gold-soft px-3 py-2.5 text-gold-strong">
        Test tomorrow: Functions, 20 questions
      </div>
    </div>
  );
}

function ProfessionalPreview() {
  const steps = [
    ["Watch 8 short recorded lessons", true],
    ["Take the timed test", true],
    ["Get your certificate", false],
  ] as const;
  return (
    <div className={card}>
      <div className="text-[15px] font-semibold">Learn SQL in two weeks</div>
      <div className="mt-0.5 text-muted">Evenings and weekends, at your own pace</div>
      <ol className="mt-3">
        {steps.map(([s, done]) => (
          <li key={s} data-row className={`${line} justify-start`}>
            <span aria-hidden className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${done ? "bg-brand text-canvas" : "bg-gold-soft text-gold-strong"}`}>
              {done ? "✓" : "·"}
            </span>
            <span className={done ? "text-muted" : "font-medium"}>{s}</span>
          </li>
        ))}
      </ol>
      <div data-stamp className="mt-3 rounded-xl border border-dashed border-brand/40 px-3 py-2.5 text-[12px] text-brand">
        Your certificate has a public link, so anyone can check it is real.
      </div>
    </div>
  );
}

function ParentPreview() {
  return (
    <div className={card}>
      <div className="text-[15px] font-semibold">Aarav · Class 10</div>
      <div className="mt-2">
        {[
          ["Attendance this month", "22 of 23 days"],
          ["Next test", "Friday, Maths"],
          ["Last test", "42 of 50"],
        ].map(([a, b]) => (
          <div key={a} data-row className={line}>
            <span className="text-muted">{a}</span>
            <span className="font-medium">{b}</span>
          </div>
        ))}
      </div>
      <div data-row className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-gold-soft px-3 py-2.5 text-gold-strong">
        <span>Fee instalment due on 5 December</span>
        <span className="font-medium whitespace-nowrap">Pay by UPI</span>
      </div>
    </div>
  );
}

const PEOPLE: { key: string; name: string; who: string; how: string; benefit: string; Preview: () => ReactNode }[] = [
  {
    key: "institutes",
    name: "Coaching institutes and academies",
    who: "Owners and managers running batches of students.",
    how: "Run admissions, timetables, live classes, attendance, tests and fees from one login. Put your recorded classes on the marketplace.",
    benefit: "Less chasing across spreadsheets and chats, and income from classes you have already taught.",
    Preview: InstitutePreview,
  },
  {
    key: "universities",
    name: "Universities and colleges",
    who: "Departments, faculty and administrators.",
    how: "Give every department its own courses and batches, and every person only the access their role needs.",
    benefit: "One system across departments, with your data kept private from every other institute.",
    Preview: UniversityPreview,
  },
  {
    key: "teachers",
    name: "Teachers and independent educators",
    who: "Anyone who teaches and wants a wider audience.",
    how: "Record your classes, list a course, a single lecture or a combo, and set the price. Learners across India buy and watch at their own pace.",
    benefit: "A class you taught once keeps earning, and you do not need your own website or app.",
    Preview: TeacherPreview,
  },
  {
    key: "students",
    name: "Students",
    who: "School, college and exam learners.",
    how: "Join your institute's batches, see the timetable, watch recordings, take tests and track your progress on your mobile.",
    benefit: "Everything for your course in one place, with nothing to install.",
    Preview: StudentPreview,
  },
  {
    key: "professionals",
    name: "Working professionals upskilling",
    who: "People who want a new skill without a long break from work.",
    how: "Pick a short recorded course, learn in the evenings, take the test and earn a certificate you can share.",
    benefit: "Learn a skill easily and in a short time, on your schedule.",
    Preview: ProfessionalPreview,
  },
  {
    key: "parents",
    name: "Parents",
    who: "Families of students at an institute.",
    how: "See your child's attendance, test results and fee dates, and get messages from the institute.",
    benefit: "You know how your child is doing without calling the office.",
    Preview: ParentPreview,
  },
];

/**
 * Who uses Zinny, and how: pick a kind of person and see what they do on Zinny, what they get,
 * and a small illustration of their screen. Illustrations only; names and numbers are examples.
 */
export function Audiences() {
  const [active, setActive] = useState(0);
  const stage = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const panel = stage.current!;
        const q = (s: string) => panel.querySelectorAll<HTMLElement>(s);
        const tl = gsap.timeline();
        tl.fromTo(panel, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, 0);
        const rows = q("[data-row]");
        if (rows.length) tl.from(rows, { opacity: 0, x: -12, duration: 0.4, stagger: 0.07, ease: "power2.out" }, 0.1);
        const bars = q("[data-bar]");
        if (bars.length) tl.from(bars, { scaleX: 0, duration: 0.7, stagger: 0.08, ease: "power3.out" }, 0.2);
        const stamps = q("[data-stamp]");
        if (stamps.length) tl.from(stamps, { opacity: 0, scale: 0.9, duration: 0.4, ease: "back.out(2)" }, 0.4);
      });
      return () => mm.revert();
    },
    { dependencies: [active], scope: stage },
  );

  const p = PEOPLE[active];

  return (
    <section id="who-uses" aria-labelledby="who-uses-title" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <h2 id="who-uses-title" className={`${SERIF} ${css.headline} max-w-[24ch] text-[clamp(2.4rem,5vw,4.4rem)] leading-[1.04] tracking-[-0.02em] text-ink`}>
          Who uses Zinny, <span className="text-brand">and how.</span>
        </h2>
        <p className="mt-5 max-w-[40rem] text-[17px] leading-relaxed text-ink/70">
          Zinny is one AI-enabled marketplace where institutes teach, educators sell, and learners pick up new skills.
        </p>
        <p className="mt-4 max-w-[40rem] rounded-2xl bg-brand-soft px-5 py-4 text-[16px] leading-relaxed text-brand-deep">
          <b className="font-semibold">Want a new skill?</b> Zinny helps you learn it easily and in a short time: recorded courses you watch when you can, tests to check what you learned, and a certificate at the end.
        </p>

        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div role="tablist" aria-label="Who uses Zinny" aria-orientation="vertical" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 [scrollbar-width:none] lg:mx-0 lg:block lg:space-y-1 lg:overflow-visible lg:p-0">
            {PEOPLE.map((x, i) => {
              const on = i === active;
              return (
                <button
                  key={x.key}
                  role="tab"
                  type="button"
                  id={`who-${x.key}`}
                  aria-selected={on}
                  aria-controls="who-panel"
                  onClick={() => setActive(i)}
                  className={`shrink-0 rounded-2xl px-4 py-3 text-left [transition-property:background-color,color] duration-200 lg:block lg:w-full lg:px-5 lg:py-4 ${
                    on ? "bg-brand-deep text-canvas" : "bg-surface text-ink ring-1 ring-line hover:bg-brand-soft lg:bg-transparent lg:ring-0"
                  }`}
                >
                  <span className="block text-[15px] font-semibold whitespace-nowrap lg:text-[17px] lg:whitespace-normal">{x.name}</span>
                  <span className={`mt-1 hidden text-[14px] leading-snug lg:block ${on ? "text-canvas/70" : "text-muted"}`}>{x.who}</span>
                </button>
              );
            })}
          </div>
          <div id="who-panel" role="tabpanel" aria-labelledby={`who-${p.key}`} className="lg:sticky lg:top-28 lg:self-start">
            <div ref={stage}>
              <h3 className={`${SERIF} ${css.accent} text-[26px] leading-tight text-ink`}>{p.name}</h3>
              <dl className="mt-3 grid gap-3 text-[15px] leading-relaxed">
                <div>
                  <dt className="font-semibold text-ink">How they use it</dt>
                  <dd className="text-ink/75">{p.how}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink">What they get</dt>
                  <dd className="text-ink/75">{p.benefit}</dd>
                </div>
              </dl>
              <div className="mt-5">
                <p.Preview />
              </div>
              <p className="mt-3 text-[13px] text-muted">An illustration. Names and numbers are examples.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
