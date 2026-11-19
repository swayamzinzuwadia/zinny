"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cx } from "./ui";

/**
 * A way back from any page below a section: "‹ Courses" on a course's own page, for example.
 * `parents` lists path prefixes (relative to `base`) and where each one leads back to. A
 * nested page that matches none of them gets a plain "Back" that uses the browser history.
 */
export type TrailParent = { prefix: string; href: string; label: string };

const pill =
  "mb-5 inline-flex items-center gap-1 rounded-full bg-surface/70 py-1.5 pr-3.5 pl-2 text-[13px] text-muted ring-1 ring-line [transition-property:background-color,color,box-shadow] duration-150 hover:bg-surface hover:text-ink hover:ring-faint";

export function PageTrail({ base, parents }: { base: string; parents: TrailParent[] }) {
  const path = usePathname();
  const router = useRouter();
  if (!path.startsWith(base)) return null;
  const rel = path.slice(base.length);
  if (rel === "" || rel === "/") return null;

  const match = parents
    .filter((p) => p.prefix && (rel === p.prefix || rel.startsWith(p.prefix + "/")))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];

  if (match) {
    if (rel === match.href) return null;
    return (
      <Link href={base + match.href} aria-label={`Back to ${match.label}`} className={pill}>
        <Chevron />
        {match.label}
      </Link>
    );
  }

  // Only nested pages (two or more segments below the base) get the history fallback.
  if (rel.split("/").filter(Boolean).length < 2) return null;
  return (
    <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push(base))} className={pill}>
      <Chevron />
      Back
    </button>
  );
}

function Chevron() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 3.5 5.5 8 10 12.5" />
    </svg>
  );
}

/* ─────────────────────────── Breadcrumbs ─────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Crumb = { href: string; label: string; current: boolean };

/**
 * The path to the current page as crumbs: the section root, then every level below it.
 * A level takes its name from `parents` (the menu), then `labels`, then the address itself
 * ("new" becomes "New", an id becomes "Details").
 */
export function crumbsFor(path: string, base: string, rootLabel: string, parents: TrailParent[], labels: Record<string, string> = {}): Crumb[] {
  const rel = path.startsWith(base) ? path.slice(base.length) : "";
  const segments = rel.split("/").filter(Boolean);
  const out: Crumb[] = [{ href: base, label: rootLabel, current: segments.length === 0 }];
  let href = "";
  segments.forEach((seg, i) => {
    href += `/${seg}`;
    const known = parents.find((p) => p.href === href)?.label ?? labels[href];
    const label = known ?? (UUID.test(seg) ? "Details" : seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " "));
    out.push({ href: base + href, label, current: i === segments.length - 1 });
  });
  return out;
}

type TrailProps = { base: string; rootLabel: string; parents: TrailParent[]; labels?: Record<string, string> };

/** Where you are as a trail, "Zinny team › Institutes › Details", each earlier step a link. */
export function Breadcrumbs({ base, rootLabel, parents, labels }: TrailProps) {
  const path = usePathname();
  const crumbs = crumbsFor(path, base, rootLabel, parents, labels);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[13.5px]">
        {crumbs.map((c, i) => (
          <li key={c.href} className={cx("flex min-w-0 items-center gap-1", i < crumbs.length - 2 && "hidden sm:flex")}>
            {i > 0 && (
              <svg aria-hidden viewBox="0 0 16 16" className="size-3.5 shrink-0 text-faint" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3.5 10.5 8 6 12.5" />
              </svg>
            )}
            {c.current ? (
              <span aria-current="page" className="truncate font-medium text-ink">
                {c.label}
              </span>
            ) : (
              <Link href={c.href} className="truncate rounded-md px-1 py-0.5 text-muted [transition-property:color,background-color] duration-150 hover:bg-canvas hover:text-ink">
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A way back to the page one level up, from any page that has one. */
export function BackButton({ base, rootLabel, parents, labels }: TrailProps) {
  const path = usePathname();
  const crumbs = crumbsFor(path, base, rootLabel, parents, labels);
  if (crumbs.length < 2) return null;
  const parent = crumbs[crumbs.length - 2];
  return (
    <Link
      href={parent.href}
      aria-label={`Back to ${parent.label}`}
      title={`Back to ${parent.label}`}
      className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-muted [transition-property:background-color,color,border-color] duration-150 hover:border-faint hover:text-ink"
    >
      <Chevron />
    </Link>
  );
}
