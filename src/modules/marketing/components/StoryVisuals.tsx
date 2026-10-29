"use client";

import { AnimatePresence, motion } from "motion/react";
import { display } from "../fonts";
import { motionTokens, springs } from "../motion";
import css from "../landing.module.css";

/*
 * The product views beside each chapter of the scroll story. Each one plays its moment when
 * `active` turns true, and shows its finished state otherwise, so nothing reads as empty.
 */

type Props = { active: boolean };

const card = `relative h-full w-full overflow-hidden rounded-[28px] bg-surface ${css.sheet}`;
const ease = motionTokens.easing.smooth;

/* ───────────── Run the institute: a batch filling up ───────────── */

const SEATS = 20;
const TAKEN = 14;

export function SeatMapVisual({ active }: Props) {
  return (
    <div className={`${card} flex flex-col p-6 sm:p-8`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-muted">Data Analytics · Computer Science</p>
          <p className="mt-1 text-[22px] font-medium tracking-tight">Weekday evening</p>
          <p className="mt-1 text-[13px] text-muted">Mon, Wed, Fri · 6–8 pm · Neha Rao</p>
        </div>
        <SeatsLeft active={active} />
      </div>

      <div className="mt-8 grid grid-cols-10 gap-1.5 sm:gap-2">
        {Array.from({ length: SEATS }, (_, i) => {
          const held = i === TAKEN;
          const taken = i < TAKEN;
          return (
            <motion.span
              key={i}
              aria-hidden
              className={`relative aspect-square rounded-lg ${held ? "bg-gold-soft ring-1 ring-gold" : "bg-canvas ring-1 ring-line"}`}
            >
              {taken && (
                <motion.span
                  className="absolute inset-0 rounded-lg bg-brand"
                  initial={false}
                  animate={{ scale: active ? 1 : 0.6, opacity: active ? 1 : 0 }}
                  transition={{ ...springs.snappy, delay: active ? 0.15 + i * motionTokens.stagger.tight : 0 }}
                />
              )}
              {held && <span className="now-dot absolute top-1 right-1 size-1.5 rounded-full bg-gold" />}
            </motion.span>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[12px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-brand" />Taken</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-gold" />Held while paying</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm ring-1 ring-line" />Open</span>
      </div>

      <WeekStrip active={active} />

      <div className="mt-auto pt-6">
        <AnimatePresence>
          {active && (
            <motion.div
              key="switch"
              className={`flex items-center gap-3 rounded-2xl p-3.5 ${css.glass}`}
              initial={{ opacity: 0, y: motionTokens.distance.md }}
              animate={{ opacity: 1, y: 0, transition: { ...springs.gentle, delay: 1.4 } }}
              exit={{ opacity: 0, transition: { duration: motionTokens.duration.fast } }}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[12px] font-medium text-brand">TI</span>
              <p className="min-w-0 text-[13px] leading-snug">
                <span className="font-medium">Seat 15 held for Tara</span>
                <span className="block text-muted">9:42 left to pay · then it opens again</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const WEEK = [
  { day: "Mon", time: "6 pm" },
  { day: "Tue", time: "" },
  { day: "Wed", time: "6 pm", moved: true },
  { day: "Thu", time: "" },
  { day: "Fri", time: "6 pm" },
  { day: "Sat", time: "" },
];

/** The batch's week; Wednesday's class moves to Thursday and the week rebuilds itself. */
function WeekStrip({ active }: Props) {
  return (
    <div className="mt-6 grid grid-cols-6 gap-1.5 border-t border-line pt-5">
      {WEEK.map((d, i) => {
        const movedHere = d.day === "Thu";
        const show = d.moved ? !active : movedHere ? active : !!d.time;
        return (
          <div key={d.day} className="text-center">
            <p className="text-[11px] text-muted">{d.day}</p>
            <div className="mt-1.5 grid h-9 place-items-center rounded-lg bg-canvas">
              <AnimatePresence initial={false}>
                {show && (
                  <motion.span
                    key={d.day}
                    className={`rounded-md px-1.5 py-0.5 text-[11px] tabular ${movedHere ? "bg-gold-soft text-gold-strong" : "bg-brand-soft text-brand"}`}
                    initial={{ opacity: 0, scale: motionTokens.scale.press }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: motionTokens.scale.press }}
                    transition={{ duration: motionTokens.duration.normal, delay: active ? 0.8 + i * 0.05 : 0 }}
                  >
                    6 pm
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SeatsLeft({ active }: Props) {
  return (
    <div className="shrink-0 text-right">
      <p className="text-[12px] text-muted">Seats left</p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={active ? "5" : "20"}
          className="text-[30px] leading-tight font-medium text-brand tabular"
          initial={{ opacity: 0, y: motionTokens.distance.sm }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -motionTokens.distance.sm }}
          transition={{ duration: motionTokens.duration.fast, delay: active ? 1.0 : 0 }}
        >
          {active ? 5 : SEATS}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

/* ───────────── Teach and engage: attendance and a leaderboard ───────────── */

const ROSTER = [
  { name: "Riya Sharma", status: "Present" },
  { name: "Kabir Mehta", status: "Present" },
  { name: "Tara Iyer", status: "Late" },
  { name: "Arjun Nair", status: "Present" },
  { name: "Meera Joshi", status: "Present" },
];
const BOARD = [
  { name: "Riya Sharma", xp: 1240, w: 1 },
  { name: "Arjun Nair", xp: 1085, w: 0.87 },
  { name: "Meera Joshi", xp: 960, w: 0.77 },
];

export function TeachVisual({ active }: Props) {
  return (
    <div className="grid h-full w-full grid-rows-[1.25fr_1fr] gap-3">
      <div className={`${card} p-6`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] text-muted">Python Basics · Afternoon</p>
            <p className="mt-0.5 text-[18px] font-medium">Attendance</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full bg-gold-soft px-2.5 py-1 text-[12px] text-gold-strong">
            <span className="now-dot size-1.5 rounded-full bg-gold" />
            Live now
          </span>
        </div>
        <ul className="mt-4 divide-y divide-line">
          {ROSTER.map((r, i) => (
            <li key={r.name} className="flex items-center justify-between py-2 text-[14px]">
              <span>{r.name}</span>
              <motion.span
                className={`flex items-center gap-1.5 text-[12px] ${r.status === "Late" ? "text-warn" : "text-brand"}`}
                initial={false}
                animate={{ opacity: active ? 1 : 0, x: active ? 0 : motionTokens.distance.sm }}
                transition={{ duration: motionTokens.duration.normal, ease, delay: active ? 0.3 + i * 0.18 : 0 }}
              >
                <Tick />
                {r.status}
              </motion.span>
            </li>
          ))}
        </ul>
      </div>
      <div className={`${card} p-6`}>
        <div className="flex items-baseline justify-between">
          <p className="text-[15px] font-medium">This week&apos;s leaderboard</p>
          <p className="text-[12px] text-muted">XP</p>
        </div>
        <ol className="mt-4 space-y-3">
          {BOARD.map((b, i) => (
            <li key={b.name} className="grid grid-cols-[1.25rem_7rem_1fr_3rem] items-center gap-2 text-[13px]">
              <span className="text-muted tabular">{i + 1}</span>
              <span className="truncate">{b.name}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-canvas">
                <motion.span
                  className="block h-full origin-left rounded-full bg-brand"
                  initial={false}
                  animate={{ scaleX: active ? b.w : 0.08 }}
                  transition={{ duration: motionTokens.duration.crawl, ease, delay: active ? 0.9 + i * 0.1 : 0 }}
                />
              </span>
              <span className="text-right tabular">{b.xp.toLocaleString("en-IN")}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Tick() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </svg>
  );
}

/* ───────────── Get paid properly: a GST invoice printing ───────────── */

const LINES = [
  { label: "Data Analytics · Weekday evening", value: "₹10,169.50", strong: false },
  { label: "CGST 9%", value: "₹915.25", strong: false },
  { label: "SGST 9%", value: "₹915.25", strong: false },
  { label: "Total paid", value: "₹12,000.00", strong: true },
];

export function InvoiceVisual({ active }: Props) {
  return (
    <div className={`${card} flex flex-col p-6 sm:p-9`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] text-muted">Tax invoice</p>
          <p className="mt-1 text-[18px] font-medium tabular">INV/26-27/0031</p>
        </div>
        <div className="text-right text-[12px] leading-relaxed text-muted">
          <p className="text-ink">Demo University</p>
          <p>GSTIN 27ABCDE1234F1Z5</p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4 border-y border-line py-4 text-[13px]">
        <div>
          <p className="text-muted">Billed to</p>
          <p className="mt-0.5">Tara Iyer</p>
        </div>
        <div className="text-right">
          <p className="text-muted">Paid on</p>
          <p className="mt-0.5 tabular">29 Oct 2026</p>
        </div>
      </div>
      <ul className="mt-2">
        {LINES.map((l, i) => (
          <motion.li
            key={l.label}
            className={`flex justify-between py-3 text-[14px] ${l.strong ? "mt-1 border-t border-ink/80 font-medium" : "border-b border-dashed border-line"}`}
            initial={false}
            animate={{ clipPath: active ? "inset(0 0% 0 0)" : "inset(0 100% 0 0)" }}
            transition={{ duration: motionTokens.duration.slow, ease, delay: active ? 0.2 + i * 0.3 : 0 }}
          >
            <span className={l.strong ? "" : "text-muted"}>{l.label}</span>
            <span className="tabular">{l.value}</span>
          </motion.li>
        ))}
      </ul>
      <div className="mt-auto flex items-end justify-between pt-6">
        <p className="max-w-[16rem] text-[12px] leading-relaxed text-muted">Refunds are recorded against this invoice and show in the accounts sales view.</p>
        <motion.span
          className="rounded-lg border-2 border-brand px-3 py-1 text-[13px] font-semibold text-brand"
          initial={false}
          animate={{ opacity: active ? 1 : 0, scale: active ? 1 : 1.3, rotate: active ? -6 : 0 }}
          transition={{ ...springs.snappy, delay: active ? 1.6 : 0 }}
        >
          Paid · UPI
        </motion.span>
      </div>
    </div>
  );
}

/* ───────────── Prove it: a certificate, verified by QR ───────────── */

// A fixed pseudo-random QR-like pattern, so server and client render the same squares.
const QR = Array.from({ length: 121 }, (_, i) => ((i * 7919) % 13) % 3 === 0);
const isFinder = (i: number) => {
  const r = Math.floor(i / 11);
  const c = i % 11;
  return (r < 3 && c < 3) || (r < 3 && c > 7) || (r > 7 && c < 3);
};

export function CertificateVisual({ active }: Props) {
  return (
    <div className="relative h-full w-full">
      <motion.div
        className={`${card} flex flex-col justify-between p-6 sm:p-9`}
        initial={false}
        animate={{ scale: active ? 0.94 : 1, x: active ? "-3%" : "0%" }}
        transition={{ duration: motionTokens.duration.slow, ease, delay: active ? 0.9 : 0 }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-3 rounded-[20px] border border-gold/50" />
        <div aria-hidden className="pointer-events-none absolute inset-[18px] rounded-[16px] border border-line" />
        <div className="relative text-center">
          <p className="text-[12px] text-muted">Demo University</p>
          <p className={`${display.className} mt-3 text-[clamp(1.5rem,3vw,2.25rem)] leading-none`}>Certificate of completion</p>
          <p className="mt-5 text-[12px] text-muted">This certifies that</p>
          <p className={`${display.className} mt-1 text-[clamp(1.75rem,3.6vw,2.75rem)] leading-none text-brand italic`}>Riya Sharma</p>
          <p className="mt-3 text-[13px] text-muted">completed Machine Learning Foundations on 12 October 2026</p>
        </div>
        <div className="relative flex items-end justify-between">
          <div className="text-[11px] text-muted">
            <p className="text-ink">Asha Menon</p>
            <p>Institute Admin</p>
          </div>
          <div className="flex items-end gap-3">
            <p className="text-right text-[11px] text-muted tabular">
              ZC-7F3K-92QD
              <br />
              Scan to verify
            </p>
            <div aria-hidden className="grid size-14 grid-cols-11 gap-px rounded-md bg-surface p-1 ring-1 ring-line">
              {QR.map((on, i) => (
                <span key={i} className={on || isFinder(i) ? "bg-ink" : ""} />
              ))}
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {active && (
          <motion.div
            key="verified"
            className={`absolute right-[-4%] bottom-[-6%] w-[58%] max-w-[300px] rounded-[24px] p-5 ${css.glass}`}
            initial={{ opacity: 0, y: motionTokens.distance.xl, rotate: 4 }}
            animate={{ opacity: 1, y: 0, rotate: 0, transition: { ...springs.gentle, delay: 1.2 } }}
            exit={{ opacity: 0, transition: { duration: motionTokens.duration.fast } }}
          >
            <div className="flex items-center gap-2.5">
              <svg aria-hidden viewBox="0 0 32 32" className="size-8 text-brand" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="16" cy="16" r="14" className="text-brand-soft" stroke="currentColor" fill="currentColor" />
                <motion.path
                  d="M10 16.5 14 20.5 22 12"
                  stroke="#0b5e4c"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: motionTokens.duration.slow, ease, delay: 1.6 }}
                />
              </svg>
              <div>
                <p className="text-[14px] font-medium">Certificate verified</p>
                <p className="text-[12px] text-muted">zinny · verify</p>
              </div>
            </div>
            <dl className="mt-4 space-y-1.5 text-[12px]">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Issued to</dt>
                <dd>Riya Sharma</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Course</dt>
                <dd className="truncate">ML Foundations</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Issued by</dt>
                <dd>Demo University</dd>
              </div>
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────── Your own website: course cards with live seat counts ───────────── */

const COURSES = [
  { title: "Data Analytics", next: "Next batch 4 Nov", from: 6, to: 5 },
  { title: "Machine Learning Foundations", next: "Next batch 11 Nov", from: 4, to: 2 },
  { title: "Digital Marketing", next: "Next batch 18 Nov", from: 9, to: 9 },
];

export function WebsiteVisual({ active }: Props) {
  return (
    <div className={`${card} flex flex-col`}>
      <div className="flex items-center gap-3 border-b border-line bg-canvas/60 px-4 py-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-line" />
          <span className="size-2.5 rounded-full bg-line" />
          <span className="size-2.5 rounded-full bg-line" />
        </span>
        <span className="mx-auto rounded-full bg-surface px-4 py-1 text-[12px] text-muted ring-1 ring-line">demo-university.in</span>
      </div>
      <div className="relative bg-brand px-6 pt-8 pb-10 text-canvas sm:px-8">
        <p className="text-[12px] text-canvas/70">Pune · Since 1998</p>
        <p className={`${display.className} mt-2 text-[clamp(1.75rem,3.4vw,2.6rem)] leading-none`}>Demo University</p>
        <p className="mt-2 max-w-xs text-[13px] text-canvas/75">Evening and weekend courses for working professionals.</p>
        <span className="mt-5 inline-block rounded-full bg-canvas px-4 py-1.5 text-[12px] font-medium text-brand">Send an enquiry</span>
      </div>
      <div className="grid flex-1 gap-2.5 p-4 sm:grid-cols-3 sm:p-5">
        {COURSES.map((c, i) => {
          const left = active ? c.to : c.from;
          const low = left <= 3;
          return (
            <div key={c.title} className="flex flex-col rounded-2xl bg-canvas p-3.5 ring-1 ring-line">
              <p className="text-[13px] leading-snug font-medium">{c.title}</p>
              <p className="mt-1 text-[11px] text-muted">{c.next}</p>
              <div className="mt-auto flex items-center justify-between pt-4 text-[11px]">
                <span className="text-muted">Seats left</span>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={left}
                    className={`rounded-full px-2 py-0.5 font-medium tabular ${low ? "bg-gold-soft text-gold-strong" : "bg-brand-soft text-brand"}`}
                    initial={{ opacity: 0, y: motionTokens.distance.xs }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -motionTokens.distance.xs }}
                    transition={{ duration: motionTokens.duration.fast, delay: active ? 0.8 + i * 0.5 : 0 }}
                  >
                    {left}
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
