"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { display } from "../fonts";
import { motionTokens, springs } from "../motion";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

/** One product, every role: a switcher that shows what each person actually sees. */

type Role = { id: string; tab: string; who: string; line: string; View: () => React.ReactNode };

const ROLES: Role[] = [
  {
    id: "hod",
    tab: "HOD",
    who: "Hema, Head of Computer Science",
    line: "Approves batch switches, sees visiting faculty access before it lapses, and creates courses only in her own department.",
    View: HodView,
  },
  {
    id: "faculty",
    tab: "Faculty",
    who: "Vikram, visiting faculty",
    line: "Sees his one weekend batch and its students, and nothing else, until the date his access ends.",
    View: FacultyView,
  },
  {
    id: "student",
    tab: "Student",
    who: "Riya, on her phone",
    line: "Her week, her next class with a join button, her progress and her place on the leaderboard.",
    View: StudentView,
  },
  {
    id: "accounts",
    tab: "Accounts",
    who: "Arun, accounts and fees",
    line: "Collections, invoices and refunds. Not marks, not attendance.",
    View: AccountsView,
  },
  {
    id: "board",
    tab: "Board",
    who: "Bharat, board member",
    line: "Reads everything and changes nothing. Insights first, with a table behind every chart.",
    View: BoardView,
  },
];

export function Roles() {
  const [current, setCurrent] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const role = ROLES[current];

  function onKey(e: React.KeyboardEvent) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (current + step + ROLES.length) % ROLES.length;
    setCurrent(next);
    tabs.current[next]?.focus();
  }

  return (
    <section id="roles" aria-labelledby="roles-title" className="scroll-mt-24 px-4 py-28 md:py-40">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mx-auto max-w-3xl text-center">
          <p className="text-[14px] text-brand">Every role</p>
          <h2
            id="roles-title"
            className={`${display.className} mt-4 text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[0.98] tracking-[-0.02em] ${css.balance}`}
          >
            One product. The right view for everyone in it.
          </h2>
        </Reveal>

        <Reveal delay={0.1} className="mt-12 flex justify-center">
          <div role="tablist" aria-label="Roles" onKeyDown={onKey} className={`flex w-full justify-between gap-0.5 rounded-full p-1 sm:w-auto sm:justify-start sm:gap-1 sm:p-1.5 ${css.glass}`}>
            {ROLES.map((r, i) => (
              <button
                key={r.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                role="tab"
                id={`role-tab-${r.id}`}
                aria-selected={i === current}
                aria-controls="role-panel"
                tabIndex={i === current ? 0 : -1}
                onClick={() => setCurrent(i)}
                className="relative min-w-0 flex-1 rounded-full px-1 py-2.5 text-[13px] outline-offset-2 sm:flex-none sm:px-5 sm:text-[14px]"
              >
                {i === current && <motion.span layoutId="role-pill" className="absolute inset-0 rounded-full bg-brand" transition={springs.snappy} />}
                <span className={`relative [transition-property:color] duration-150 ${i === current ? "text-canvas" : "text-muted hover:text-ink"}`}>{r.tab}</span>
              </button>
            ))}
          </div>
        </Reveal>

        <div
          id="role-panel"
          role="tabpanel"
          aria-labelledby={`role-tab-${role.id}`}
          className="mt-12 grid grid-cols-1 items-center gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={role.id}
              initial={{ opacity: 0, y: motionTokens.distance.sm }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -motionTokens.distance.sm }}
              transition={{ duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth }}
              className="text-center lg:text-left"
            >
              <p className={`${display.className} text-[clamp(1.75rem,3vw,2.5rem)] leading-tight`}>{role.who}</p>
              <p className={`mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-muted lg:mx-0 ${css.pretty}`}>{role.line}</p>
            </motion.div>
          </AnimatePresence>
          <div className="relative min-h-[420px]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={role.id}
                className="h-full"
                initial={{ opacity: 0, scale: motionTokens.scale.subtle, filter: "blur(6px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: motionTokens.scale.subtle, filter: "blur(6px)" }}
                transition={{ duration: motionTokens.duration.normal, ease: motionTokens.easing.smooth }}
              >
                <role.View />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

const panel = `rounded-[28px] bg-surface p-6 sm:p-8 ${css.sheet}`;

function Row({ left, right, sub }: { left: string; right: React.ReactNode; sub?: string }) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 text-[14px]">
      <span className="min-w-0">
        <span className="block truncate">{left}</span>
        {sub && <span className="block truncate text-[12px] text-muted">{sub}</span>}
      </span>
      <span className="shrink-0">{right}</span>
    </li>
  );
}

function Fill({ label, taken, seats }: { label: string; taken: number; seats: number }) {
  return (
    <div className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-3 text-[13px]">
      <span className="truncate">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-canvas">
        <span className="block h-full origin-left rounded-full bg-brand" style={{ transform: `scaleX(${taken / seats})` }} />
      </span>
      <span className="text-right text-muted tabular">
        {taken}/{seats}
      </span>
    </div>
  );
}

function HodView() {
  return (
    <div className={panel}>
      <p className="text-[13px] text-muted">Computer Science</p>
      <p className="mt-1 text-[20px] font-medium">Needs you</p>
      <ul className="mt-3 divide-y divide-line">
        <Row
          left="Kabir Mehta wants Weekday evening"
          sub="Data Analytics · 5 seats free"
          right={<span className="rounded-full bg-brand px-3 py-1 text-[12px] text-canvas">Approve</span>}
        />
        <Row
          left="Vikram's access ends on 8 Nov"
          sub="Before Data Analytics, Weekend ends"
          right={<span className="rounded-full bg-gold-soft px-3 py-1 text-[12px] text-gold-strong">Assign faculty</span>}
        />
      </ul>
      <p className="mt-6 text-[13px] text-muted">Data Analytics batches</p>
      <div className="mt-3 space-y-3">
        <Fill label="Weekday morning" taken={9} seats={12} />
        <Fill label="Weekday evening" taken={15} seats={20} />
        <Fill label="Weekend" taken={6} seats={12} />
      </div>
    </div>
  );
}

function FacultyView() {
  return (
    <div className={panel}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] text-muted">Your batch</p>
          <p className="mt-1 text-[20px] font-medium">Data Analytics · Weekend</p>
        </div>
        <span className="rounded-full bg-canvas px-3 py-1 text-[12px] text-muted ring-1 ring-line">Access until 8 Nov</span>
      </div>
      <div className="mt-6 flex items-center justify-between rounded-2xl bg-brand p-5 text-canvas">
        <div>
          <p className="text-[12px] text-canvas/70">Saturday · 10:00 to 12:00</p>
          <p className="mt-1 text-[16px] font-medium">Live class, week 6</p>
        </div>
        <span className="rounded-full bg-canvas px-4 py-2 text-[13px] font-medium text-brand">Start class</span>
      </div>
      <ul className="mt-4 divide-y divide-line">
        <Row left="Students" right={<span className="tabular">6</span>} />
        <Row left="Assignments to grade" right={<span className="rounded-full bg-gold-soft px-2.5 py-0.5 text-[12px] text-gold-strong tabular">8</span>} />
        <Row left="Attendance this month" right={<span className="tabular">91%</span>} />
      </ul>
    </div>
  );
}

function StudentView() {
  return (
    <div className="flex justify-center">
      <div className="w-[300px] rounded-[44px] bg-ink p-2.5 shadow-[0_40px_80px_-30px_rgb(6_58_47/0.6)]">
        <div className="overflow-hidden rounded-[36px] bg-canvas">
          <div className="flex justify-center pt-2.5">
            <span className="h-5 w-24 rounded-full bg-ink" />
          </div>
          <div className="px-5 pt-4 pb-6">
            <p className="text-[12px] text-muted">Hi Riya</p>
            <p className="text-[20px] font-medium">This week</p>
            <ol className="mt-4 space-y-2">
              {[
                { d: "Mon", t: "6:00 pm", c: "Data Analytics" },
                { d: "Wed", t: "6:00 pm", c: "Data Analytics", now: true },
                { d: "Sat", t: "10:00 am", c: "Python Basics" },
              ].map((s) => (
                <li key={s.d} className={`flex items-center gap-3 rounded-2xl p-3 ${s.now ? "bg-brand text-canvas" : "bg-surface ring-1 ring-line"}`}>
                  <span className={`w-9 text-[12px] ${s.now ? "text-canvas/70" : "text-muted"}`}>{s.d}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{s.c}</span>
                    <span className={`block text-[11px] ${s.now ? "text-canvas/70" : "text-muted"}`}>{s.t}</span>
                  </span>
                  {s.now && <span className="rounded-full bg-gold px-2.5 py-1 text-[11px] font-medium text-brand-deep">Join</span>}
                </li>
              ))}
            </ol>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-surface p-3 ring-1 ring-line">
                <p className="text-[11px] text-muted">Progress</p>
                <p className="mt-1 text-[18px] font-medium tabular">62%</p>
              </div>
              <div className="rounded-2xl bg-surface p-3 ring-1 ring-line">
                <p className="text-[11px] text-muted">Leaderboard</p>
                <p className="mt-1 text-[18px] font-medium tabular">#1</p>
              </div>
            </div>
          </div>
          <div className="flex justify-around border-t border-line py-3 text-[11px] text-muted">
            <span className="text-brand">Home</span>
            <span>Courses</span>
            <span>Timetable</span>
            <span>Me</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountsView() {
  return (
    <div className={panel}>
      <p className="text-[13px] text-muted">October collections</p>
      <p className="mt-1 text-[34px] leading-tight font-medium tracking-tight tabular">₹2,46,000</p>
      <ul className="mt-5 divide-y divide-line">
        <Row left="Tara Iyer" sub="INV/26-27/0031 · UPI" right={<span className="tabular">₹12,000</span>} />
        <Row left="Kabir Mehta" sub="INV/26-27/0030 · Card" right={<span className="tabular">₹12,000</span>} />
        <Row left="Arjun Nair" sub="INV/26-27/0029 · UPI" right={<span className="tabular">₹4,000</span>} />
        <Row
          left="Meera Joshi"
          sub="Refund due · INV/26-27/0024"
          right={<span className="rounded-full bg-gold-soft px-2.5 py-0.5 text-[12px] text-gold-strong tabular">₹8,000</span>}
        />
      </ul>
    </div>
  );
}

const WEEKS = [14, 18, 12, 21, 19, 24, 17, 26, 22, 28, 25, 31];

function BoardView() {
  const max = Math.max(...WEEKS);
  return (
    <div className={panel}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] text-muted">Insights · read only</p>
          <p className="mt-1 text-[20px] font-medium">Enrolments per week</p>
        </div>
        <span className="text-[12px] text-muted">Show as a table</span>
      </div>
      <div className="mt-8 flex h-44 items-end gap-2">
        {WEEKS.map((w, i) => (
          <span
            key={i}
            className={`flex-1 origin-bottom rounded-t-md ${i === WEEKS.length - 1 ? "bg-gold" : "bg-brand/80"}`}
            style={{ height: `${(w / max) * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-4 text-[13px] text-muted">This week is the strongest of the last twelve.</p>
    </div>
  );
}
