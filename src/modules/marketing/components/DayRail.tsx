"use client";

import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";

/*
 * The whole app as one day's timetable, in the hero. Every block is a part of Zinny and
 * links to where the page shows it. The gold "now" line walks through the day, as it does
 * on an institute's real Today board.
 */

const START = 7;
const END = 21;
const HOURS = [7, 9, 11, 13, 15, 17, 19, 21];
const at = (h: number) => ((h - START) / (END - START)) * 100;

/** Where the line rests when motion is off. */
const RESTING = 11 + 40 / 60;
const WALK_SECONDS = 70;

type Block = { from: number; to: number; title: string; href: string };

const LANES: { name: string; blocks: Block[]; solid?: boolean }[] = [
  {
    name: "Front office",
    blocks: [
      { from: 7.5, to: 9, title: "Enrolment", href: "#stop-find" },
      { from: 13, to: 14.75, title: "Fees and GST", href: "#stop-fees" },
      { from: 19.5, to: 21, title: "Reports", href: "#stop-report" },
    ],
  },
  {
    name: "Classroom",
    blocks: [
      { from: 9, to: 11.25, title: "Live class", href: "#stop-class" },
      { from: 11.5, to: 13, title: "Tests", href: "#stop-test" },
      { from: 15, to: 17, title: "Assignments", href: "#everything" },
      { from: 17.75, to: 19.25, title: "Certificates", href: "#stop-certificate" },
    ],
  },
  {
    name: "Marketplace",
    solid: true,
    blocks: [
      { from: 7.5, to: 12.5, title: "Learners buy recorded courses", href: "#marketplace" },
      { from: 16.5, to: 18, title: "Lecture listed", href: "#stop-sell" },
      { from: 18, to: 21, title: "Still on sale after hours", href: "#marketplace" },
    ],
  },
];

const AGENDA = [
  { time: "7:30", title: "Website and batches", href: "#stop-find" },
  { time: "9:00", title: "Live class and attendance", href: "#stop-class" },
  { time: "11:30", title: "Tests", href: "#stop-test" },
  { time: "1:00", title: "Fees and GST invoices", href: "#stop-fees" },
  { time: "5:00", title: "Today's lecture on the marketplace", href: "#stop-sell" },
  { time: "8:00", title: "Board reports", href: "#stop-report" },
];

function hourLabel(h: number) {
  return h === 12 ? "12 pm" : h > 12 ? `${h - 12} pm` : `${h} am`;
}

function clock(h: number) {
  const hour = Math.floor(h);
  const minutes = Math.floor((h - hour) * 60);
  const shown = hour > 12 ? hour - 12 : hour;
  return `${shown}:${String(minutes).padStart(2, "0")}`;
}

export function DayRail() {
  const reduce = useReducedMotion();
  const hour = useMotionValue(RESTING);
  const left = useTransform(hour, (h) => `${at(h)}%`);
  const label = useTransform(hour, clock);
  const [live, setLive] = useState<string | null>(null);

  useEffect(() => {
    if (reduce) return;
    const walk = animate(hour, END, { from: START, duration: WALK_SECONDS, ease: "linear", repeat: Infinity });
    return () => walk.stop();
  }, [hour, reduce]);

  useMotionValueEvent(hour, "change", (h) => {
    const block = LANES.flatMap((l) => l.blocks).find((b) => b.from <= h && h < b.to);
    setLive(block?.title ?? null);
  });

  return (
    <div>
      {/* Wide screens: the day as a bell schedule. Narrower, its blocks can't hold their names. */}
      <div className="hidden xl:block">
        <div className="grid grid-cols-[104px_1fr] gap-x-3">
          <div />
          <div className="relative h-6 text-[12px] text-canvas/45">
            {HOURS.map((h) => (
              <span key={h} className={cx("absolute whitespace-nowrap tabular", h === START ? "" : h === END ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${at(h)}%` }}>
                {hourLabel(h)}
              </span>
            ))}
          </div>
          <div className="grid gap-1.5">
            {LANES.map((lane) => (
              <div key={lane.name} className={cx("flex h-12 items-center text-[13px]", lane.solid ? "font-medium text-canvas" : "text-canvas/60")}>
                {lane.name}
              </div>
            ))}
          </div>
          <div className="relative">
            <div className="grid gap-1.5">
              {LANES.map((lane) => (
                <div key={lane.name} className="relative h-12 rounded-2xl bg-canvas/[0.04]">
                  {lane.blocks.map((b) => (
                    <a
                      key={b.title}
                      href={b.href}
                      className={cx(
                        "absolute inset-y-1 flex items-center overflow-hidden rounded-xl px-2.5 text-[13px] font-medium whitespace-nowrap [transition-property:background-color,box-shadow,transform] duration-200 hover:-translate-y-px",
                        lane.solid ? "bg-canvas text-brand-deep hover:bg-surface" : "bg-canvas/[0.09] text-canvas hover:bg-canvas/[0.16]",
                        live === b.title && "ring-1 ring-gold",
                      )}
                      style={{ left: `calc(${at(b.from)}% + 2px)`, width: `calc(${at(b.to) - at(b.from)}% - 4px)` }}
                    >
                      <span className="truncate">{b.title}</span>
                    </a>
                  ))}
                </div>
              ))}
            </div>
            <motion.div aria-hidden className="pointer-events-none absolute -inset-y-1 z-10 w-0" style={{ left }}>
              <span className="absolute inset-y-0 left-0 w-[2px] -translate-x-1/2 rounded-full bg-gold" />
              <span className="now-dot absolute -top-1 left-0 size-2.5 -translate-x-1/2 rounded-full bg-gold" />
              <motion.span className="absolute -bottom-6 left-0 -translate-x-1/2 rounded-full bg-gold px-2 py-0.5 text-[11px] font-medium text-brand-deep tabular">{label}</motion.span>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Phones, tablets and small laptops: the same day as an agenda */}
      <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 xl:hidden">
        {AGENDA.map((a) => (
          <li key={a.title}>
            <a href={a.href} className="flex items-center gap-4 rounded-2xl bg-canvas/[0.07] px-4 py-3 text-[14px] font-medium [transition-property:background-color] duration-150 active:bg-canvas/[0.14]">
              <span className="w-10 shrink-0 text-[13px] font-normal text-gold tabular">{a.time}</span>
              {a.title}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
