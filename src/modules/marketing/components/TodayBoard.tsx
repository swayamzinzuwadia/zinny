"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { motionTokens, springs } from "../motion";
import css from "../landing.module.css";
import { CountUp } from "./CountUp";

/*
 * The hero's product moment: the Today board, as the admin panel opens on it. The day's
 * classes drop into a bell schedule and the gold "now" line glides to the current time.
 */

const START = 9;
const END = 19;
const HOURS = Array.from({ length: END - START + 1 }, (_, i) => START + i);
const at = (h: number) => ((h - START) / (END - START)) * 100;
const NOW = 11 + 40 / 60;

type Slot = { lane: number; from: number; to: number; title: string; meta: string };

const LANES = ["Hall A", "Hall B", "Online"];
const SLOTS: Slot[] = [
  { lane: 0, from: 10, to: 12, title: "Machine Learning Foundations", meta: "Morning · 8 of 10 seats" },
  { lane: 1, from: 11, to: 12.5, title: "Data Analytics", meta: "Weekday morning · 9 students" },
  { lane: 2, from: 13, to: 14, title: "Statistics refresher", meta: "Extra class" },
  { lane: 0, from: 14.5, to: 16, title: "Python Basics", meta: "Afternoon · 5 students" },
  { lane: 1, from: 17, to: 19, title: "Digital Marketing", meta: "Evening · 5 students" },
];

const label = (h: number) => (h === 12 ? "12 pm" : h > 12 ? `${h - 12} pm` : `${h} am`);
const time = (h: number) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const shown = hh > 12 ? hh - 12 : hh;
  return `${shown}:${String(mm).padStart(2, "0")}`;
};

const board = {
  hidden: {},
  shown: { transition: { staggerChildren: motionTokens.stagger.normal, delayChildren: 0.35 } },
};
const drop = {
  hidden: { opacity: 0, y: -motionTokens.distance.md, scale: motionTokens.scale.subtle },
  shown: { opacity: 1, y: 0, scale: 1, transition: springs.gentle },
};
const grid = {
  hidden: { scaleY: 0, opacity: 0 },
  shown: { scaleY: 1, opacity: 1, transition: { duration: motionTokens.duration.slow, ease: motionTokens.easing.smooth } },
};

export function TodayBoard() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 40%", "end start"] });
  const scale = useTransform(scrollYProgress, [0, 1], [1, 0.94]);
  const y = useTransform(scrollYProgress, [0, 1], [0, -40]);

  return (
    <motion.div ref={ref} style={reduce ? undefined : { scale, y }} className="relative mx-auto max-w-6xl">
      <motion.div
        variants={board}
        initial="hidden"
        animate="shown"
        className={`relative overflow-hidden rounded-[28px] bg-brand-deep p-5 text-canvas sm:p-8 ${css.sheet}`}
      >
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <motion.div variants={drop}>
            <p className="text-[13px] text-canvas/60">Thursday, 29 October · Demo University</p>
            <p className="mt-1 text-[26px] leading-tight font-medium tracking-tight sm:text-[30px]">Good morning, Asha</p>
          </motion.div>
          <motion.ul variants={drop} className="flex flex-wrap gap-2 text-[13px]">
            <li className="rounded-full bg-canvas/10 px-3 py-1.5">5 classes today</li>
            <li className="rounded-full bg-canvas/10 px-3 py-1.5">1 switch request</li>
            <li className="rounded-full bg-gold/15 px-3 py-1.5 text-gold">2 live now</li>
          </motion.ul>
        </div>

        {/* Bell schedule (tablet and up) */}
        <div className="mt-8 hidden pb-6 md:block">
          <div className="grid grid-cols-[72px_1fr] gap-3">
            <div />
            <div className="relative h-5 text-[11px] text-canvas/45">
              {HOURS.map((h) => (
                <span key={h} className="absolute -translate-x-1/2 whitespace-nowrap tabular" style={{ left: `${at(h)}%` }}>
                  {label(h)}
                </span>
              ))}
            </div>
            {LANES.map((lane, i) => (
              <Lane key={lane} name={lane} slots={SLOTS.filter((s) => s.lane === i)} first={i === 0} />
            ))}
          </div>
        </div>

        {/* Agenda (phones) */}
        <motion.ol variants={board} className="mt-6 space-y-2 md:hidden">
          {[...SLOTS].sort((a, b) => a.from - b.from).map((s) => {
            const live = s.from <= NOW && NOW < s.to;
            return (
              <motion.li
                key={s.title}
                variants={drop}
                className={`relative flex items-center gap-4 rounded-2xl px-4 py-3 ${live ? "bg-brand" : "bg-canvas/[0.06]"}`}
              >
                {live && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-full bg-gold" />}
                <span className="w-12 shrink-0 text-[13px] text-canvas/60 tabular">{time(s.from)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium">{s.title}</span>
                  <span className="block truncate text-[12px] text-canvas/60">{s.meta}</span>
                </span>
                {live && <span className="ml-auto shrink-0 text-[12px] text-gold">Now</span>}
              </motion.li>
            );
          })}
        </motion.ol>
      </motion.div>

      {/* Floating glass card: what needs Asha today */}
      <motion.aside
        aria-label="Needs you"
        initial={{ opacity: 0, y: motionTokens.distance.lg }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...springs.gentle, delay: 1.3 }}
        className={`relative z-10 mx-3 -mt-6 rounded-3xl p-5 text-ink sm:mx-auto sm:max-w-md md:absolute md:right-[-12px] md:-bottom-14 md:mx-0 md:mt-0 md:w-[340px] lg:right-[-36px] ${css.glass}`}
      >
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium">Needs you</p>
          <p className="text-[12px] text-muted">2 items</p>
        </div>
        <div className="mt-3 rounded-2xl bg-surface p-3.5 ring-1 ring-line">
          <p className="text-[13px] leading-snug">
            <span className="font-medium">Kabir Mehta</span> wants to switch to Weekday evening
          </p>
          <p className="mt-0.5 text-[12px] text-muted">Data Analytics · 5 seats free</p>
          <div className="mt-2.5 flex gap-2 text-[12px]">
            <span className="rounded-full bg-brand px-3 py-1 text-canvas">Approve</span>
            <span className="rounded-full px-3 py-1 ring-1 ring-line">Decline</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-2xl px-3.5 py-2.5 text-[13px]">
          <span>Seats filled this term</span>
          <CountUp to={86} suffix="%" className="font-medium text-brand" />
        </div>
      </motion.aside>
    </motion.div>
  );
}

function Lane({ name, slots, first }: { name: string; slots: Slot[]; first: boolean }) {
  return (
    <>
      <motion.div variants={drop} className="flex h-[68px] items-center text-[12px] text-canvas/55">
        {name}
      </motion.div>
      <div className="relative h-[68px] rounded-2xl bg-canvas/[0.04]">
        {HOURS.slice(1, -1).map((h) => (
          <motion.span
            key={h}
            aria-hidden
            variants={grid}
            className="absolute inset-y-2 w-px origin-top bg-canvas/[0.07]"
            style={{ left: `${at(h)}%` }}
          />
        ))}
        {slots.map((s) => {
          const live = s.from <= NOW && NOW < s.to;
          return (
            <motion.div
              key={s.title}
              variants={drop}
              className={`absolute inset-y-1.5 overflow-hidden rounded-xl px-3 py-2 ${
                live ? "bg-brand ring-1 ring-canvas/15" : "bg-canvas/[0.07]"
              }`}
              style={{ left: `calc(${at(s.from)}% + 3px)`, width: `calc(${at(s.to) - at(s.from)}% - 6px)` }}
            >
              <p className="truncate text-[13px] leading-tight font-medium">{s.title}</p>
              <p className="mt-0.5 truncate text-[11px] text-canvas/60">
                {time(s.from)}–{time(s.to)} · {s.meta}
              </p>
            </motion.div>
          );
        })}
        {first && <NowLine />}
      </div>
    </>
  );
}

/** Spans all three lanes from the first lane's box; glides from 9 am to the current time. */
function NowLine() {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 z-10 h-[calc(300%+24px)] w-full"
      initial={{ x: "0%", opacity: 0 }}
      animate={{ x: `${at(NOW)}%`, opacity: 1 }}
      transition={{ duration: motionTokens.duration.glide, ease: motionTokens.easing.smooth, delay: 0.9 }}
    >
      <span className="absolute inset-y-0 left-0 w-[2px] -translate-x-1/2 rounded-full bg-gold" />
      <span className="now-dot absolute -top-1 left-0 size-2.5 -translate-x-1/2 rounded-full bg-gold" />
      <span className="absolute -bottom-7 left-0 -translate-x-1/2 rounded-full bg-gold px-2 py-0.5 text-[11px] font-medium text-brand-deep tabular">
        11:40
      </span>
    </motion.div>
  );
}
