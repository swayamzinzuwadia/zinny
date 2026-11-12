import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { getSite } from "@/modules/website-builder/cached";
import type { RecordedCatalogItem } from "../service";
import { BookCard } from "./jacket";
import type { InstituteFace } from "./live";

/** The pieces the marketplace's browse pages share: the page width, the green top, search, filters and headings. */
export const shell = "mx-auto max-w-6xl px-4 sm:px-6";

/** The green top of a browse page: where you are, what this page is, and its search and filters. */
export function BrowseTop({ id, crumb, title, lede, children }: { id: string; crumb?: { href: string; label: string }; title: ReactNode; lede: ReactNode; children?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="bg-brand-deep text-canvas">
      <div className={cx(shell, "pt-8 pb-10 sm:pt-12 sm:pb-12")}>
        {crumb && (
          <Link href={crumb.href} className="text-[14px] text-canvas/65 hover:text-canvas">
            {crumb.label}
          </Link>
        )}
        <h1 id={id} className="mt-2 max-w-[18ch] text-[clamp(2.3rem,5.4vw,3.9rem)] leading-[1.04] font-semibold [text-wrap:balance]">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed text-canvas/75">{lede}</p>
        {children}
      </div>
    </section>
  );
}

/** A search box that keeps the page's other filters (passed as hidden fields). */
export function SearchBar({ action, q, placeholder, label, hidden = {} }: { action: string; q: string; placeholder: string; label: string; hidden?: Record<string, string | undefined> }) {
  return (
    <form action={action} role="search" className="mt-7 flex max-w-xl items-center rounded-full bg-canvas p-1.5 shadow-[0_18px_40px_-20px_rgb(0_0_0/0.6)]">
      {Object.entries(hidden).map(([name, value]) => value && <input key={name} type="hidden" name={name} value={value} />)}
      <svg aria-hidden viewBox="0 0 20 20" className="ml-4 size-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="8.5" cy="8.5" r="5.5" />
        <path d="m13 13 4 4" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[16px] text-ink outline-none placeholder:text-muted [&:focus-visible]:outline-none"
      />
      <button className="shrink-0 rounded-full bg-brand px-5 py-2.5 text-[15px] font-medium text-canvas [transition-property:background-color] duration-150 hover:bg-brand-strong">Search</button>
    </form>
  );
}

/** A filter on the green top: filled when it is the one in use. */
export function Pill({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cx(
        "rounded-full px-4 py-1.5 whitespace-nowrap [transition-property:background-color,color] duration-150",
        on ? "bg-canvas font-medium text-brand-deep" : "text-canvas/80 ring-1 ring-canvas/25 hover:bg-canvas/10 hover:text-canvas",
      )}
    >
      {children}
    </Link>
  );
}

export function SectionHead({ id, title, href, more, note }: { id?: string; title: ReactNode; href?: string; more?: string; note?: ReactNode }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-6 border-b border-line pb-4">
      <div className="min-w-0">
        <h2 id={id} className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">
          {title}
        </h2>
        {note && <p className="mt-1 text-[14px] text-muted">{note}</p>}
      </div>
      {href && more && (
        <Link href={href} className="shrink-0 pb-1 text-[14px] font-medium text-brand hover:underline">
          {more}
        </Link>
      )}
    </div>
  );
}

/** Sort links under a results heading: the one in use is underlined in gold ("now"). */
export function SortLinks<K extends string>({ options, current, href }: { options: { key: K; label: string }[]; current: K; href: (key: K) => string }) {
  return (
    <nav aria-label="Sort" className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
      {options.map((s) => {
        const on = current === s.key;
        return (
          <Link
            key={s.key}
            href={href(s.key)}
            aria-current={on ? "page" : undefined}
            className={on ? "font-medium text-ink underline decoration-gold decoration-2 underline-offset-[6px]" : "text-muted hover:text-ink"}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** What a shelf says when it has nothing on it, with one way onward. */
export function EmptyShelf({ title, children, href, action }: { title: string; children: ReactNode; href?: string; action?: string }) {
  return (
    <div className="rounded-[20px] bg-surface px-6 py-12 text-center ring-1 ring-line">
      <p className="text-[19px] font-medium">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">{children}</p>
      {href && action && (
        <Link href={href} className="mt-5 inline-block rounded-full bg-brand px-5 py-2.5 text-[15px] font-medium text-canvas hover:bg-brand-strong">
          {action}
        </Link>
      )}
    </div>
  );
}

export function BookGrid({ items, showInstitute = true }: { items: RecordedCatalogItem[]; showInstitute?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 sm:gap-x-7 lg:grid-cols-4">
      {items.map((item) => (
        <BookCard key={item.id} item={item} showInstitute={showInstitute} />
      ))}
    </div>
  );
}

/** A query string from the filters in use; empty values are left out. */
export function query(base: string, params: Record<string, string | undefined | false>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * How each institute looks on the marketplace: its line about itself, city, logo and colour
 * come from its published website (website-builder), when it has one. Without a published
 * site it shows by name and brand colour alone.
 */
export async function instituteFaces<T extends { name: string; slug: string; brandColor?: string | null; recorded: number; live: number }>(
  list: T[],
): Promise<(InstituteFace & { hasSite: boolean; fullAbout: string })[]> {
  const sites = await Promise.all(list.map((i) => getSite(i.slug).catch(() => null)));
  return list.map((i, n) => {
    const site = sites[n]?.live ? sites[n] : null;
    return {
      name: i.name,
      slug: i.slug,
      about: site ? site.tagline || site.about : "",
      fullAbout: site ? site.about || site.tagline : "",
      city: site?.city ?? "",
      logoSrc: site ? (site.logo?.src ?? site.brandingLogoUrl) : null,
      color: site ? site.palette.primary : (i.brandColor ?? null),
      recorded: i.recorded,
      live: i.live,
      hasSite: !!site,
    };
  });
}
