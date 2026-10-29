"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

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
