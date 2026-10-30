"use client";

import { motion } from "motion/react";
import { display } from "../fonts";
import { motionTokens } from "../motion";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

/*
 * Privacy, said simply: every institute is a room with its own walls. The walls draw in,
 * then a support-mode entry types out, because the Zinny team only gets in on the record.
 */

const ROOMS = [
  { name: "Your institute", people: "Your courses, students and fees", roles: ["Admin", "HOD", "Faculty", "Students"] },
  { name: "Another institute", people: "Can't see yours", roles: ["Admin", "Accounts", "Board", "Students"] },
  { name: "Every other one", people: "Can't see either", roles: ["Admin", "Faculty", "Parents", "Students"] },
];

const POINTS = [
  {
    title: "Walled off by the database",
    body: "Each institute's records sit behind row-level security. Nobody at one institute can reach another's, from any screen.",
  },
  {
    title: "Roles decide every view",
    body: "A HOD sees their department, visiting faculty their own batch, a parent their own child. The server checks every action.",
  },
  {
    title: "Support access, on the record",
    body: "Only Zinny Super Admins can look across institutes, and the team works inside one only in support mode. Sessions end on their own, and every view and action is logged.",
  },
];

export function Campus() {
  return (
    <section aria-labelledby="campus-title" className="px-3 sm:px-5">
      <div className="mx-auto max-w-[1400px] overflow-hidden rounded-[36px] bg-brand-deep px-5 py-24 text-canvas sm:px-10 md:py-32 lg:px-16">
        <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Reveal>
              <p className="text-[14px] text-canvas/60">Privacy</p>
              <h2
                id="campus-title"
                className={`${display.className} mt-4 text-[clamp(2.5rem,5.5vw,4.5rem)] leading-[0.98] tracking-[-0.02em] ${css.balance}`}
              >
                Every institute gets its own <em className="text-gold">private</em> campus.
              </h2>
            </Reveal>
            <ul className="mt-12 space-y-7">
              {POINTS.map((p, i) => (
                <li key={p.title}>
                  <Reveal delay={0.1 + i * 0.08}>
                    <p className="text-[16px] font-medium">{p.title}</p>
                    <p className={`mt-1.5 max-w-md text-[15px] leading-relaxed text-canvas/65 ${css.pretty}`}>{p.body}</p>
                  </Reveal>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {ROOMS.map((room, i) => (
                <Room key={room.name} {...room} index={i} />
              ))}
            </div>
            <SupportLog />
          </div>
        </div>
      </div>
    </section>
  );
}

const WALL = { duration: motionTokens.duration.normal, ease: motionTokens.easing.sharp };

function Room({ name, people, roles, index }: { name: string; people: string; roles: string[]; index: number }) {
  const base = 0.2 + index * 0.25;
  const view = { once: true, margin: "-120px" } as const;
  const wall = "absolute bg-canvas/40";
  return (
    <motion.div
      className="relative rounded-[20px] bg-canvas/[0.04] p-5"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={view}
      transition={{ duration: motionTokens.duration.normal, delay: base }}
    >
      {/* Four walls, drawn in one after another */}
      <motion.span aria-hidden className={`${wall} inset-x-4 top-0 h-px origin-left`} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={view} transition={{ ...WALL, delay: base }} />
      <motion.span aria-hidden className={`${wall} inset-y-4 right-0 w-px origin-top`} initial={{ scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={view} transition={{ ...WALL, delay: base + 0.25 }} />
      <motion.span aria-hidden className={`${wall} inset-x-4 bottom-0 h-px origin-right`} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={view} transition={{ ...WALL, delay: base + 0.5 }} />
      <motion.span aria-hidden className={`${wall} inset-y-4 left-0 w-px origin-bottom`} initial={{ scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={view} transition={{ ...WALL, delay: base + 0.75 }} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-medium">{name}</p>
          <p className="mt-0.5 text-[12px] text-canvas/55">{people}</p>
        </div>
        <Lock />
      </div>
      <ul className="mt-5 flex flex-wrap gap-1.5">
        {roles.map((r) => (
          <li key={r} className="rounded-full bg-canvas/[0.07] px-2.5 py-1 text-[11px] text-canvas/75">
            {r}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function Lock() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5 shrink-0 text-canvas/60" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </svg>
  );
}

function SupportLog() {
  const view = { once: true, margin: "-80px" } as const;
  const type = (delay: number) => ({
    initial: { clipPath: "inset(0 100% 0 0)" },
    whileInView: { clipPath: "inset(0 0% 0 0)" },
    viewport: view,
    transition: { duration: motionTokens.duration.crawl, ease: motionTokens.easing.linear, delay },
  });
  return (
    <motion.div
      className={`mt-3 rounded-[20px] p-5 font-mono text-[12.5px] leading-relaxed ${css.glassDark}`}
      initial={{ opacity: 0, y: motionTokens.distance.md }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={view}
      transition={{ duration: motionTokens.duration.slow, ease: motionTokens.easing.smooth, delay: 1.1 }}
    >
      <div className="flex items-center gap-2 font-sans text-[12px] text-canvas/60">
        <span className="now-dot size-1.5 rounded-full bg-gold" />
        Support mode · Demo University
      </div>
      <motion.p className="mt-3 whitespace-nowrap text-canvas/90" {...type(1.5)}>
        Sid (Support Agent) entered at 11:42
      </motion.p>
      <motion.p className="whitespace-nowrap text-canvas/60" {...type(2.5)}>
        Reason: weekend batch timings not showing
      </motion.p>
      <motion.p className="whitespace-nowrap text-gold" {...type(3.5)}>
        Every action from here is logged.
      </motion.p>
    </motion.div>
  );
}
