import Link from "next/link";
import type { CSSProperties } from "react";
import { cx } from "@/components/ui";
import type { ListingKind } from "../schema";
import { KIND_LABEL, Price } from "./price";

/**
 * The marketplace is a bookshop of recordings: every listing is a cloth-bound book in one of the
 * homepage shelf's bookcloth colours, picked from its id so a listing keeps its colour for good.
 */
const CLOTHS = [
  { cloth: "bg-brand text-canvas", sticker: "bg-gold text-brand-deep" },
  { cloth: "bg-brand-deep text-canvas", sticker: "bg-gold text-brand-deep" },
  { cloth: "bg-[#2f4a72] text-canvas", sticker: "bg-gold text-brand-deep" },
  { cloth: "bg-gold text-brand-deep", sticker: "bg-brand-deep text-gold" },
  { cloth: "bg-[#7a3d66] text-canvas", sticker: "bg-gold text-brand-deep" },
  { cloth: "bg-[#a8402c] text-canvas", sticker: "bg-gold text-brand-deep" },
] as const;

/** FNV-1a over the id: ids that differ by a character still land on different cloths. */
function clothFor(id: string) {
  let h = 0x811c9dc5;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
  return CLOTHS[h % CLOTHS.length];
}

/** Playfair, from the --font-playfair variable the marketplace layout sets (importing next/font here would tie it to the app runtime). */
const SERIF: CSSProperties = { fontFamily: "var(--font-playfair), Georgia, serif" };

/** Woven cloth, drawn at a hair's width so it reads as material, not pattern. */
const WEAVE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(0deg, rgb(255 255 255 / 0.045) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgb(0 0 0 / 0.05) 0 1px, transparent 1px 3px)",
};

export type JacketItem = { id: string; kind: ListingKind; title: string; institute: string; lessons: number; percentOff: number | null };

function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`;
}

export const lessonsLine = (lessons: number, minutes: number) =>
  `${lessons} ${lessons === 1 ? "lesson" : "lessons"}${minutes > 0 ? ` · ${duration(minutes)}` : ""}`;

/**
 * The front of the book: imprint, title, and what kind of recording it is. Everything is sized
 * in container units, so the same jacket works as a shelf thumbnail and as the listing's cover.
 * A deal wears a round price sticker, the way a bookshop marks one.
 */
export function Jacket({ item, className }: { item: JacketItem; className?: string }) {
  const c = clothFor(item.id);
  return (
    <div className={cx("@container relative aspect-[3/4] w-full", className)}>
      <div
        className={cx(
          "absolute inset-0 overflow-hidden rounded-[3px_9px_9px_3px] shadow-[0_22px_34px_-20px_rgb(6_58_47/0.7),0_2px_5px_rgb(6_58_47/0.18)]",
          c.cloth,
        )}
      >
        <div aria-hidden className="absolute inset-0" style={WEAVE} />
        <div aria-hidden className="absolute inset-y-0 left-0 w-[7%] bg-black/20 shadow-[inset_-1px_0_0_rgb(255_255_255/0.18)]" />
        <div aria-hidden className="absolute inset-y-0 left-[7%] w-[2.5%] bg-white/10" />
        <div className="relative flex h-full flex-col py-[10%] pr-[10%] pl-[17%]">
          <span className="line-clamp-2 text-[6.2cqw] leading-tight font-medium opacity-80">{item.institute}</span>
          <span aria-hidden className="mt-[6%] h-[0.8cqw] min-h-px w-[22%] bg-current opacity-40" />
          <span style={SERIF} className="mt-auto line-clamp-5 text-[11.5cqw] leading-[1.06] font-semibold [text-wrap:balance] [font-variant-numeric:lining-nums]">
            {item.title}
          </span>
          <span className="mt-[9%] text-[5.6cqw] opacity-75">
            {KIND_LABEL[item.kind]} · {item.lessons} {item.lessons === 1 ? "lesson" : "lessons"}
          </span>
        </div>
      </div>
      {item.percentOff && (
        <span
          className={cx(
            "absolute -top-[4%] -right-[5%] flex size-[27%] rotate-[-9deg] flex-col items-center justify-center rounded-full text-center leading-none font-semibold shadow-[0_6px_14px_-6px_rgb(6_58_47/0.6)]",
            c.sticker,
          )}
        >
          <span className="text-[8.5cqw]">{item.percentOff}%</span>
          <span className="mt-[1.5cqw] text-[4.6cqw] font-medium">off</span>
        </span>
      )}
    </div>
  );
}

export type ShelfItem = JacketItem & { pricePaise: number; compareAtPaise: number | null; minutes: number; instituteSlug: string };

/** A book face-out on a shelf: the jacket, then title, imprint and price under it. The whole card opens the listing. */
export function BookCard({ item, showInstitute = true }: { item: ShelfItem; showInstitute?: boolean }) {
  return (
    <Link href={`/marketplace/${item.id}`} className="group flex flex-col rounded-[14px] outline-offset-4">
      <Jacket item={item} className="transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1.5 group-focus-visible:-translate-y-1.5" />
      <span className="mt-4 line-clamp-2 text-[15px] leading-snug font-medium text-ink group-hover:text-brand">{item.title}</span>
      <span className="mt-1 text-[13px] text-muted">
        {showInstitute ? `${item.institute} · ` : ""}
        {lessonsLine(item.lessons, item.minutes)}
      </span>
      <Price pricePaise={item.pricePaise} compareAtPaise={item.compareAtPaise} className="mt-2" />
    </Link>
  );
}

/** A spine on the shop-front shelf. Lessons set its height, so a long course stands taller. Pulled up on hover, like taking it off the shelf. */
export function Spine({ item }: { item: JacketItem }) {
  const c = clothFor(item.id);
  const height = Math.min(100, 64 + item.lessons * 2.4);
  return (
    <Link
      href={`/marketplace/${item.id}`}
      title={`${item.title} · ${item.institute}`}
      style={{ height: `${height}%` }}
      className={cx(
        "relative flex w-[clamp(2.4rem,3.6vw,3.4rem)] shrink-0 items-center justify-center overflow-hidden rounded-[5px_5px_2px_2px] outline-offset-2 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-3 focus-visible:-translate-y-3",
        c.cloth,
      )}
    >
      <span aria-hidden className="absolute inset-0" style={WEAVE} />
      <span aria-hidden className="absolute inset-x-0 top-[7%] h-[3px] bg-current opacity-30" />
      <span aria-hidden className="absolute inset-x-0 bottom-[7%] h-[3px] bg-current opacity-30" />
      <span style={SERIF} className="relative line-clamp-1 max-h-[80%] rotate-180 px-1 text-[clamp(12px,1.05vw,15px)] font-semibold [writing-mode:vertical-rl]">
        {item.title}
      </span>
    </Link>
  );
}

const LEAN = ["rotate-[-2.5deg]", "rotate-[1.5deg]", "rotate-[-1deg]"];

/**
 * The shop-front shelf: the first few books stand face-out, leaning a little as books do, and the
 * rest show their spines. Deals go face-out first. Every book is a link to its listing.
 */
export function ShopShelf({ items, empty }: { items: JacketItem[]; empty: string }) {
  const faceOut = [...items].sort((a, b) => (b.percentOff ?? 0) - (a.percentOff ?? 0)).slice(0, items.length >= 6 ? 3 : 2);
  const shown = new Set(faceOut.map((i) => i.id));
  const spines = items.filter((i) => !shown.has(i.id)).slice(0, 12);
  return (
    <div role="group" aria-label="On the shelf" className="self-end">
      <div className="flex h-[clamp(14rem,27vw,22rem)] items-end gap-2 overflow-x-auto px-3 pt-8 [scrollbar-width:none] sm:gap-3">
        {items.length === 0 ? (
          <p className="mb-8 w-full text-center text-[15px] text-canvas/55">{empty}</p>
        ) : (
          <>
            {faceOut.map((item, i) => (
              <Link
                key={item.id}
                href={`/marketplace/${item.id}`}
                aria-label={`${item.title}, ${item.institute}`}
                className={cx(
                  "w-[clamp(7.5rem,13vw,10.75rem)] shrink-0 origin-bottom transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-3 hover:rotate-0 focus-visible:-translate-y-3",
                  LEAN[i],
                )}
              >
                <Jacket item={item} />
              </Link>
            ))}
            {spines.map((item) => (
              <Spine key={item.id} item={item} />
            ))}
          </>
        )}
      </div>
      <div aria-hidden className="h-3.5 rounded-t-[2px] bg-[#04291f] shadow-[0_-1px_0_rgb(250_246_234/0.08)]" />
    </div>
  );
}
