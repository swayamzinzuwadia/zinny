import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/components/ui";
import { formatDate } from "@/server/lib/dates";
import { fewSeatsLeft, startsSoon, type LiveCatalogItem, type LiveInfo } from "../service";
import { FORMAT_LINE, Price } from "./price";

/** Playfair, from the --font-playfair variable the marketplace layout sets. */
const SERIF: CSSProperties = { fontFamily: "var(--font-playfair), Georgia, serif" };

/** "Starts tomorrow", "Starts in 9 days", or "Starts 12 Jan" when it is more than two weeks away. */
export function startsLine(live: Pick<LiveInfo, "phase" | "startsInDays" | "startDate">) {
  if (live.phase === "running") return "Running now";
  if (live.startsInDays === 1) return "Starts tomorrow";
  return live.startsInDays <= 14 ? `Starts in ${live.startsInDays} days` : `Starts ${formatDate(live.startDate, { year: false })}`;
}

/** "12 Jan to 30 Mar 2027"; the first year is said only when the batch runs across a new year. */
export function datesLine(live: Pick<LiveInfo, "startDate" | "endDate">) {
  const sameYear = live.startDate.slice(0, 4) === live.endDate.slice(0, 4);
  return `${formatDate(live.startDate, { year: !sameYear })} to ${formatDate(live.endDate)}`;
}

export const classesLine = (n: number) => `${n} ${n === 1 ? "class" : "classes"}`;

export const seatsLine = (n: number) => `${n} ${n === 1 ? "seat" : "seats"} left`;

const chip = "inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] leading-none font-medium whitespace-nowrap";

/**
 * Where a batch stands, in one or two chips. Gold only for what needs acting on now: few seats
 * left, or starting within a week. A full batch says so and nothing else.
 */
export function LiveBadges({ live, className }: { live: LiveInfo; className?: string }) {
  if (live.seatsLeft === 0) {
    return (
      <span className={cx("flex flex-wrap gap-1.5", className)}>
        <span className={cx(chip, "bg-line text-ink")}>Batch full</span>
      </span>
    );
  }
  const soon = startsSoon(live);
  return (
    <span className={cx("flex flex-wrap gap-1.5", className)}>
      <span className={cx(chip, soon ? "bg-gold text-brand-deep" : "bg-brand-soft text-brand-deep")}>{startsLine(live)}</span>
      {fewSeatsLeft(live) && <span className={cx(chip, "bg-gold text-brand-deep")}>{seatsLine(live.seatsLeft)}</span>}
    </span>
  );
}

const ICONS = {
  dates: <path d="M4 5.5h12v11H4zM4 8.5h12M7.5 3.5v3M12.5 3.5v3" />,
  time: <path d="M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM10 6v4l2.5 2" />,
  faculty: <path d="M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.5 16.5a5.5 5.5 0 0 1 11 0" />,
  seats: <path d="M5.5 10V6.5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2V10M4 10h12v4H4zM5.5 14v2M14.5 14v2" />,
  classes: <path d="M3.5 5h13v9h-13zM7.5 17h5M10 14v3" />,
} as const;

export function FactIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="mt-[1px] size-[18px] shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {ICONS[name]}
    </svg>
  );
}

/** The start date as a calendar leaf: what tells a live batch from a book at a glance. */
export function DateLeaf({ live, size = "md" }: { live: Pick<LiveInfo, "startDate" | "phase">; size?: "md" | "lg" }) {
  const [day, month] = formatDate(live.startDate, { year: false }).split(" ");
  return (
    <span
      className={cx(
        "flex shrink-0 flex-col items-center justify-center rounded-[12px] bg-brand-deep text-center text-canvas",
        size === "lg" ? "w-[5.25rem] py-3.5" : "w-[4.25rem] py-2.5",
      )}
    >
      <span className="text-[11px] leading-none text-canvas/70">{live.phase === "upcoming" ? "Starts" : "Started"}</span>
      <span style={SERIF} className={cx("mt-1 leading-none font-semibold [font-variant-numeric:lining-nums]", size === "lg" ? "text-[36px]" : "text-[28px]")}>
        {day}
      </span>
      <span className="mt-1 text-[12.5px] leading-none">{month}</span>
    </span>
  );
}

/**
 * A seat in a live batch, as a card: the start date, the course, when it meets, who teaches and
 * what is left. The top opens the listing; the institute's name opens the institute's page.
 */
export function LiveCard({ item, showInstitute = true }: { item: LiveCatalogItem; showInstitute?: boolean }) {
  const live = item.live;
  return (
    <article className="flex flex-col overflow-hidden rounded-[18px] bg-surface shadow-[0_18px_36px_-28px_rgb(6_58_47/0.55)] ring-1 ring-line [transition-property:box-shadow,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:shadow-[0_26px_44px_-26px_rgb(6_58_47/0.6)]">
      <Link href={`/marketplace/${item.id}`} className="group flex flex-1 flex-col outline-offset-[-3px]">
        <span className="flex gap-4 p-4 pb-0 sm:p-5 sm:pb-0">
          <DateLeaf live={live} />
          <span className="flex min-w-0 flex-col">
            <span className="text-[12px] font-medium text-brand">{FORMAT_LINE.live}</span>
            <span className="mt-1 line-clamp-2 text-[17px] leading-snug font-medium text-ink group-hover:text-brand">{item.title}</span>
            <span className="mt-0.5 truncate text-[13px] text-muted">{live.batchName}</span>
          </span>
        </span>
        <span className="mt-4 flex flex-col gap-1.5 px-4 text-[13.5px] text-ink/85 sm:px-5">
          <span className="flex gap-2">
            <FactIcon name="dates" />
            <span>
              {datesLine(live)} · {classesLine(live.classes)}
            </span>
          </span>
          <span className="flex gap-2">
            <FactIcon name="time" />
            <span>{live.timings}</span>
          </span>
          {live.faculty.length > 0 && (
            <span className="flex gap-2">
              <FactIcon name="faculty" />
              <span className="line-clamp-1">{live.faculty.join(", ")}</span>
            </span>
          )}
        </span>
        <LiveBadges live={live} className="mt-4 px-4 pb-4 sm:px-5" />
      </Link>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-t border-dashed border-line px-4 py-3.5 sm:px-5">
        <Price pricePaise={item.pricePaise} compareAtPaise={item.compareAtPaise} />
        {showInstitute && (
          <Link href={`/marketplace/institutes/${item.instituteSlug}`} className="min-w-0 truncate text-[13px] text-muted hover:text-brand hover:underline">
            {item.institute}
          </Link>
        )}
      </div>
    </article>
  );
}

export function LiveGrid({ items, showInstitute = true }: { items: LiveCatalogItem[]; showInstitute?: boolean }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <LiveCard key={item.id} item={item} showInstitute={showInstitute} />
      ))}
    </div>
  );
}

/* ───────────────────────────── Institutes ───────────────────────────── */

export type InstituteFace = {
  name: string;
  slug: string;
  /** From the institute's public website, when it has one: a line about it, where it is, its logo and colour. */
  about?: string;
  city?: string;
  logoSrc?: string | null;
  color?: string | null;
  recorded: number;
  live: number;
};

/** "8 recorded · 3 live batches", or what to expect when nothing is on sale. */
export function countsLine(i: { recorded: number; live: number }) {
  const parts = [i.recorded > 0 && `${i.recorded} recorded`, i.live > 0 && `${i.live} live ${i.live === 1 ? "batch" : "batches"}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing on sale yet";
}

/** The first sentence or so of a longer text, for a card. */
export function firstLine(text: string, max = 130) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60)).replace(/[,;:.\s]+$/, "")}…`;
}

/** The institute's logo, or its initial on its own colour (Zinny green when it has none). */
export function InstituteMark({ face, size = 56 }: { face: Pick<InstituteFace, "name" | "logoSrc" | "color">; size?: number }) {
  if (face.logoSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- institutes upload logos of any size; the media route already serves a small file
      <img src={face.logoSrc} alt="" width={size} height={size} className="shrink-0 rounded-[14px] bg-surface object-contain ring-1 ring-line" style={{ width: size, height: size }} />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[14px] bg-brand font-semibold text-canvas"
      style={{ ...SERIF, width: size, height: size, fontSize: size * 0.46, ...(face.color ? { backgroundColor: face.color } : {}) }}
    >
      {face.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** An institute in the directory, and under every listing: who they are and how much they sell here. */
export function InstituteCard({ face, action }: { face: InstituteFace; action?: ReactNode }) {
  const selling = face.recorded + face.live > 0;
  return (
    <Link
      href={`/marketplace/institutes/${face.slug}`}
      className="group flex h-full gap-4 rounded-[18px] bg-surface p-5 ring-1 ring-line outline-offset-2 [transition-property:box-shadow,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 hover:shadow-[0_24px_40px_-28px_rgb(6_58_47/0.6)]"
    >
      <InstituteMark face={face} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[17px] leading-snug font-medium text-ink group-hover:text-brand">{face.name}</span>
        {face.city && <span className="mt-0.5 text-[13px] text-muted">{face.city}</span>}
        {face.about && <span className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-ink/80">{firstLine(face.about)}</span>}
        <span className={cx("mt-auto pt-3 text-[13.5px]", selling ? "font-medium text-brand-deep" : "text-muted")}>{countsLine(face)}</span>
        {action}
      </span>
    </Link>
  );
}
