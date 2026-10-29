/**
 * Building blocks of the public site. Colours come from the site's palette as CSS variables
 * (--site-primary, --site-deep, --site-soft, --site-line, --site-on-primary) set by the layout.
 */
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { formatDate, formatINR, initials } from "../../format";
import type { MediaRef, PublicCourseCard, PublicFacultyCard, PublicPostCard, SiteInfo } from "../../public";

export const container = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8";

export function SiteImage({ image, sizes, className, priority, alt }: { image: MediaRef; sizes: string; className?: string; priority?: boolean; alt?: string }) {
  return <Image src={image.src} width={image.width} height={image.height} alt={alt ?? image.alt} sizes={sizes} className={className} priority={priority} />;
}

export function Monogram({ site, size = 40 }: { site: Pick<SiteInfo, "name" | "logo" | "brandingLogoUrl">; size?: number }) {
  if (site.logo) {
    return <Image src={site.logo.src} width={site.logo.width} height={site.logo.height} alt="" className="shrink-0 object-contain" style={{ width: size, height: size }} sizes={`${size * 2}px`} />;
  }
  if (site.brandingLogoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={site.brandingLogoUrl} alt="" className="shrink-0 object-contain" style={{ width: size, height: size }} />;
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-[30%] bg-[var(--site-primary)] font-semibold text-[var(--site-on-primary)]"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(site.name) || site.name[0]}
    </span>
  );
}

export function SectionHead({ id, heading, intro, action }: { id?: string; heading: string; intro?: string; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 sm:mb-10">
      <div className="max-w-2xl">
        <h2 id={id ? `${id}-heading` : undefined} className="text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[34px]">
          {heading}
        </h2>
        {intro && <p className="mt-3 text-[17px] leading-relaxed text-muted">{intro}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stars({ rating, size = 16, className }: { rating: number; size?: number; className?: string }) {
  const full = Math.round(rating * 2) / 2;
  return (
    <span className={cx("inline-flex gap-0.5", className)} role="img" aria-label={`${rating.toFixed(1).replace(/\.0$/, "")} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 20 20" aria-hidden>
          <defs>
            <linearGradient id={`half-${i}-${size}`}>
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="var(--site-line)" />
            </linearGradient>
          </defs>
          <path
            d="M10 1.6l2.5 5.3 5.8.7-4.3 4 1.1 5.8L10 14.6l-5.1 2.8 1.1-5.8-4.3-4 5.8-.7z"
            fill={i <= full ? "currentColor" : i - 0.5 === full ? `url(#half-${i}-${size})` : "var(--site-line)"}
          />
        </svg>
      ))}
    </span>
  );
}

export function priceLine(c: { pricePaise: number; gstRateBp: number }) {
  if (!c.pricePaise) return "Free";
  return `${formatINR(c.pricePaise)} + ${c.gstRateBp / 100}% GST`;
}

/** "Starts Mon 2 Nov" or "Running now". */
export function startLine(b: { startDate: string; started: boolean }) {
  return b.started ? "Running now, join any week" : `Starts ${formatDate(b.startDate, { weekday: true })}`;
}

/** Seats left, with gold only when few are left (it needs attention now). */
export function SeatsLeft({ n, limit }: { n: number; limit?: number }) {
  if (n <= 0) return <span className="text-muted">Full</span>;
  const few = n <= 5 && (!limit || n / limit <= 0.5);
  return (
    <span className={cx("inline-flex items-center gap-1.5", few ? "font-medium text-gold-strong" : "text-ink")}>
      {few && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden />}
      {n === 1 ? "1 seat left" : `${n} seats left`}
    </span>
  );
}

/** A course as a prospectus row: what, when, how many seats, how much. */
export function CourseRow({ uni, c }: { uni: string; c: PublicCourseCard }) {
  return (
    <li>
      <Link
        href={`/site/${uni}/courses/${c.id}`}
        className="group grid gap-x-8 gap-y-2 py-6 transition-colors sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center"
      >
        <div className="min-w-0">
          <div className="text-[13px] text-muted">{c.departmentName}</div>
          <div className="mt-0.5 text-[21px] font-semibold leading-snug tracking-[-0.01em] group-hover:text-[var(--site-primary)]">{c.title}</div>
          {c.description && <p className="mt-1 line-clamp-2 text-[15px] text-muted">{c.description}</p>}
        </div>
        <div className="text-[14px] leading-relaxed">
          {c.nextBatch ? (
            <>
              <div className="font-medium">{startLine(c.nextBatch)}</div>
              <div className="text-muted">{c.nextBatch.timings}</div>
              <div className="mt-0.5">
                <SeatsLeft n={c.seatsLeft} />
                {c.openBatches > 1 && <span className="text-muted">, {c.openBatches} batches</span>}
              </div>
            </>
          ) : (
            <div className="text-muted">{c.openBatches ? "All batches are full" : "New batches announced soon"}</div>
          )}
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <span className="text-[15px] font-medium tabular-nums">{priceLine(c)}</span>
          <span
            aria-hidden
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--site-line)] text-[var(--site-primary)] transition-colors group-hover:bg-[var(--site-primary)] group-hover:text-[var(--site-on-primary)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16">
              <path d="M6 3.5l4.5 4.5L6 12.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </Link>
    </li>
  );
}

export function FacultyCard({ uni, f }: { uni: string; f: PublicFacultyCard }) {
  return (
    <Link href={`/site/${uni}/faculty/${f.id}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[22px] bg-[var(--site-soft)]">
        {f.photo ? (
          <SiteImage image={f.photo} alt={`Photo of ${f.name}`} sizes="(min-width: 1024px) 270px, (min-width: 640px) 33vw, 50vw" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[40px] font-semibold text-[var(--site-primary)]">{initials(f.name)}</span>
        )}
      </div>
      <div className="mt-3 font-semibold group-hover:text-[var(--site-primary)]">{f.name}</div>
      <div className="text-[14px] leading-snug text-muted">{f.headline}</div>
    </Link>
  );
}

export function PostCard({ uni, p, large }: { uni: string; p: PublicPostCard; large?: boolean }) {
  return (
    <Link href={`/site/${uni}/blog/${p.slug}`} className={cx("group block", large && "md:grid md:grid-cols-[1.25fr_1fr] md:items-center md:gap-10")}>
      <div className="relative aspect-[16/10] overflow-hidden rounded-[22px] bg-[var(--site-soft)]">
        {p.cover && (
          <SiteImage
            image={p.cover}
            alt=""
            sizes={large ? "(min-width: 768px) 600px, 100vw" : "(min-width: 768px) 360px, 100vw"}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        )}
      </div>
      <div className={cx("mt-4", large && "md:mt-0")}>
        <div className="text-[13px] text-muted">
          {formatDate(p.publishedAt.slice(0, 10))}, {p.minutes} min read
        </div>
        <h3 className={cx("mt-1 font-semibold leading-snug tracking-[-0.01em] group-hover:text-[var(--site-primary)]", large ? "text-[26px] sm:text-[30px]" : "text-[19px]")}>
          {p.title}
        </h3>
        <p className={cx("mt-2 text-muted", large ? "line-clamp-4 text-[16px]" : "line-clamp-3 text-[15px]")}>{p.excerpt}</p>
        {large && p.authorName && <div className="mt-4 text-[14px]">By {p.authorName}</div>}
      </div>
    </Link>
  );
}

export function SocialLinks({ social, tone = "dark" }: { social: SiteInfo["social"]; tone?: "dark" | "light" }) {
  const labels: Record<string, string> = { website: "Website", instagram: "Instagram", linkedin: "LinkedIn", youtube: "YouTube", facebook: "Facebook", x: "X" };
  const entries = Object.entries(social).filter(([, v]) => v);
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
      {entries.map(([k, url]) => (
        <li key={k}>
          <a href={url} target="_blank" rel="noopener noreferrer me" className={cx("underline decoration-1 underline-offset-4", tone === "light" ? "text-[var(--site-on-primary)]/85 hover:text-[var(--site-on-primary)]" : "text-[var(--site-primary)]")}>
            {labels[k] ?? k}
          </a>
        </li>
      ))}
    </ul>
  );
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
export const whatsappHref = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;

/** Paragraphs from plain text with blank lines between them. */
export function Paragraphs({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i} className={cx("whitespace-pre-line", className)}>
            {p}
          </p>
        ))}
    </>
  );
}

/** JSON-LD for search engines, escaped so it can't close the script tag. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
