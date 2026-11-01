"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cx } from "@/components/ui";
import { display } from "../fonts";
import { motionTokens, springs } from "../motion";
import css from "../landing.module.css";

/*
 * The marketplace as what it is: a shelf. Each spine is a course or lecture, and choosing one
 * pulls it out. It's a picture of the product, so like the others it shows demo institutes.
 */

type Book = { title: string; institute: string; kind: "Course" | "Lecture"; meta: string; price: string; height: number; tone: string };

const BOOKS: Book[] = [
  { title: "Data Analytics", institute: "Demo Institute", kind: "Course", meta: "8 lessons · 2 h 46 min", price: "₹4,129", height: 312, tone: "bg-brand text-canvas" },
  { title: "Python in an hour", institute: "Demo Institute", kind: "Lecture", meta: "1 lesson · 1 h", price: "₹353", height: 262, tone: "bg-gold text-brand-deep" },
  { title: "GST for small businesses", institute: "Riverside College of Commerce", kind: "Course", meta: "12 lessons · 6 h", price: "₹2,950", height: 330, tone: "bg-[#2f4a72] text-canvas" },
  { title: "Brand storytelling", institute: "Demo Institute", kind: "Lecture", meta: "1 lesson · 5 min", price: "₹118", height: 248, tone: "bg-surface text-brand-deep ring-1 ring-line" },
  { title: "Machine Learning Foundations", institute: "Demo Institute", kind: "Course", meta: "14 lessons · 9 h", price: "₹5,899", height: 372, tone: "bg-brand-deep text-canvas" },
  { title: "Reading a balance sheet", institute: "Riverside College of Commerce", kind: "Lecture", meta: "1 lesson · 40 min", price: "₹236", height: 300, tone: "bg-[#7a3d66] text-canvas" },
  { title: "Digital Marketing", institute: "Demo Institute", kind: "Course", meta: "10 lessons · 5 h", price: "₹3,540", height: 300, tone: "bg-[#a8402c] text-canvas" },
  { title: "Neural networks, explained", institute: "Demo Institute", kind: "Lecture", meta: "1 lesson · 19 min", price: "₹177", height: 322, tone: "bg-brand-soft text-brand-deep" },
  { title: "Business Accounting", institute: "Riverside College of Commerce", kind: "Course", meta: "16 lessons · 8 h", price: "₹4,720", height: 322, tone: "bg-gold-strong text-canvas" },
];

export function Shelf() {
  const [open, setOpen] = useState(0);
  const book = BOOKS[open];

  return (
    <div className="mt-12 grid gap-8 lg:mt-16 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-end lg:gap-12">
      <div className="min-w-0">
        <div className="-mx-5 overflow-x-auto px-5 pt-5 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <div className="flex min-w-max items-end gap-1.5 sm:min-w-0 sm:gap-2">
            {BOOKS.map((b, i) => {
              const on = i === open;
              return (
                <motion.button
                  key={b.title}
                  type="button"
                  onClick={() => setOpen(i)}
                  aria-pressed={on}
                  aria-label={`${b.title}, ${b.kind.toLowerCase()} from ${b.institute}, ${b.price}`}
                  className={cx("relative flex w-[60px] shrink-0 flex-col items-center overflow-hidden rounded-t-md rounded-b-sm px-1 py-3 sm:w-auto sm:min-w-0 sm:flex-1", b.tone)}
                  style={{ height: b.height }}
                  animate={{ y: on ? -16 : 0 }}
                  whileHover={{ y: on ? -16 : -8 }}
                  transition={springs.snappy}
                >
                  <span aria-hidden className="absolute inset-x-0 top-5 h-px bg-current opacity-30" />
                  <span aria-hidden className="absolute inset-x-0 top-6 h-px bg-current opacity-30" />
                  <span aria-hidden className="absolute inset-x-0 bottom-9 h-px bg-current opacity-30" />
                  <span className={`${display.className} ${css.spineText} ${css.accent} mt-5 mb-9 flex-1 overflow-hidden text-[17px] leading-tight whitespace-nowrap sm:text-[19px]`}>{b.title}</span>
                  <span className="absolute bottom-2.5 text-[11px] opacity-75">{b.kind === "Course" ? "Course" : "Lecture"}</span>
                </motion.button>
              );
            })}
          </div>
          {/* The plank the books stand on */}
          <div aria-hidden className="h-3.5 rounded-b-lg bg-brand-deep shadow-[0_18px_30px_-16px_rgb(6_58_47/0.55)]" />
        </div>
        <p className="mt-3 text-[13px] text-muted">Example listings. Choose a spine to pull it out.</p>
      </div>

      <div className={`rounded-[28px] bg-surface p-6 ${css.sheet}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={book.title}
            initial={{ opacity: 0, y: motionTokens.distance.sm }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -motionTokens.distance.sm }}
            transition={{ duration: motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
          >
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-muted">{book.institute}</span>
              <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-0.5 text-[12px] font-medium text-brand-strong">{book.kind}</span>
            </div>
            <p className={`${display.className} ${css.subheading} mt-4 min-h-[2.3em] text-[27px] leading-[1.14]`}>{book.title}</p>
            <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-line pt-4">
              <span className="text-[13px] text-muted">{book.meta}</span>
              <span className="tabular text-[20px] font-medium">{book.price}</span>
            </div>
          </motion.div>
        </AnimatePresence>
        <Link href="/signup" className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-full bg-brand text-[15px] font-medium text-canvas [transition-property:background-color,transform] duration-150 hover:bg-brand-strong active:scale-[0.96]">
          Create an account to buy
        </Link>
      </div>
    </div>
  );
}
