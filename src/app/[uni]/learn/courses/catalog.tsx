"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { cx } from "@/components/ui";

export type CatalogCourse = {
  id: string;
  href: string;
  title: string;
  description: string | null;
  department: string;
  price: string;
  openBatches: number;
  seatsLeft: number;
  enrolled: boolean;
};

/* Chalkboard covers in the brand palette; a course always gets the same one. */
const COVERS = [
  { bg: "bg-brand-deep", ink: "text-canvas", line: "#faf6ea" },
  { bg: "bg-[#1f3a5c]", ink: "text-canvas", line: "#faf6ea" },
  { bg: "bg-[#5e2e4f]", ink: "text-canvas", line: "#faf6ea" },
  { bg: "bg-gold-soft", ink: "text-brand-deep", line: "#0b5e4c" },
];
const coverFor = (id: string) => COVERS[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % COVERS.length];
const monogram = (title: string) =>
  title
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

export function CourseCatalog({ courses }: { courses: CatalogCourse[] }) {
  const departments = useMemo(() => [...new Set(courses.map((c) => c.department))].sort(), [courses]);
  const [dept, setDept] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = courses.filter(
    (c) =>
      (!dept || c.department === dept) &&
      (!q || c.title.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q) || c.department.toLowerCase().includes(q)),
  );

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="group" aria-label="Filter by department" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
          {[null, ...departments].map((d) => {
            const on = dept === d;
            return (
              <button
                key={d ?? "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setDept(d)}
                className={cx(
                  "shrink-0 rounded-full px-4 py-2 text-[13px] whitespace-nowrap [transition-property:background-color,color,box-shadow] duration-150",
                  on ? "bg-brand-deep text-canvas" : "bg-surface text-muted ring-1 ring-line hover:text-ink hover:ring-faint",
                )}
              >
                {d ?? "All courses"}
              </button>
            );
          })}
        </div>
        <label className="relative block sm:w-64">
          <span className="sr-only">Search courses</span>
          <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="9" cy="9" r="5.5" />
            <path d="m13.5 13.5 3.5 3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search courses"
            className="h-10 w-full rounded-full border border-line bg-surface pr-4 pl-10 text-[14px] outline-none placeholder:text-faint focus:border-brand"
          />
        </label>
      </div>

      {shown.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-board)] border border-dashed border-line px-6 py-14 text-center">
          <p className="font-medium">No courses match</p>
          <button
            type="button"
            onClick={() => {
              setDept(null);
              setQuery("");
            }}
            className="mt-2 text-[14px] text-brand hover:underline"
          >
            Show every course
          </button>
        </div>
      ) : (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li key={c.id}>
              <CourseCard course={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CourseCard({ course: c }: { course: CatalogCourse }) {
  const cover = coverFor(c.id);
  const full = c.seatsLeft === 0;
  const few = !full && c.seatsLeft <= 5;
  return (
    <Link
      href={c.href}
      className="group flex h-full flex-col overflow-hidden rounded-[26px] border border-line bg-surface [transition-property:transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_18px_40px_-20px_rgb(6_58_47/0.35)]"
    >
      <div className={cx("relative h-36 overflow-hidden px-5 pt-4", cover.bg, cover.ink)}>
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.09]"
          style={{ backgroundImage: `linear-gradient(to bottom, ${cover.line} 1px, transparent 1px)`, backgroundSize: "100% 22px" }}
        />
        <span
          aria-hidden
          className="absolute -right-2 -bottom-6 text-[96px] leading-none font-semibold tracking-tight opacity-[0.16] [transition-property:transform] duration-300 group-hover:-translate-x-1.5"
        >
          {monogram(c.title)}
        </span>
        <div className="relative flex items-start justify-between gap-3">
          <span className="rounded-full bg-black/10 px-2.5 py-1 text-[12px] backdrop-blur-sm">{c.department}</span>
          {c.enrolled ? (
            <span className="rounded-full bg-gold px-2.5 py-1 text-[12px] font-medium text-brand-deep">Enrolled</span>
          ) : (
            <span className="rounded-full bg-canvas px-2.5 py-1 text-[12px] font-medium text-brand-deep tabular">{c.price}</span>
          )}
        </div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h2 className="text-[18px] leading-snug font-semibold tracking-tight group-hover:text-brand">{c.title}</h2>
        {c.description && <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-muted">{c.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-5 text-[13px]">
          <span className="text-muted">
            {c.openBatches} batch{c.openBatches === 1 ? "" : "es"} open
          </span>
          <span
            className={cx(
              "rounded-full px-2.5 py-1 font-medium tabular",
              full ? "bg-canvas text-faint" : few ? "bg-gold-soft text-gold-strong" : "bg-brand-soft text-brand",
            )}
          >
            {full ? "Full" : `${c.seatsLeft} seat${c.seatsLeft === 1 ? "" : "s"} left`}
          </span>
        </div>
        <span className="mt-4 flex items-center gap-1.5 border-t border-line pt-4 text-[14px] font-medium text-brand">
          {c.enrolled ? "Go to your course" : "See batches and timings"}
          <svg aria-hidden viewBox="0 0 16 16" className="size-4 [transition-property:transform] duration-200 group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </span>
      </div>
    </Link>
  );
}
