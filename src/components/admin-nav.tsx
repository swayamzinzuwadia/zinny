"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export type NavSection = { key: string; label: string; hint: string; access: string; items: { label: string; href: string }[] };

/** The gold triangle from the logo marks where you are. */
function Marker() {
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" className="absolute -left-[3px] top-1/2 -translate-y-1/2" aria-hidden>
      <path d="M0 0 L8 5 L0 10 Z" fill="#D4A72A" />
    </svg>
  );
}

/**
 * The one menu item that owns `path`: an exact match, or else the item with the longest
 * prefix. So /leaderboards/badges marks "Badges", not "Leaderboard" (/leaderboards) as well.
 */
export function activeHref(path: string, base: string, hrefs: string[]): string | null {
  const matches = hrefs.filter((h) => (h === "" ? path === base : path === base + h || path.startsWith(base + h + "/")));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function AdminNav({ base, sections }: { base: string; sections: NavSection[] }) {
  const path = usePathname();
  const current = activeHref(
    path,
    base,
    sections.flatMap((s) => s.items.map((i) => i.href)),
  );
  const isActive = (href: string) => href === current;

  return (
    <nav className="space-y-6">
      {sections.map((s) => (
        <div key={s.key}>
          <div className="mb-1.5 flex items-center justify-between px-3 text-[12px]">
            <span className="text-canvas/55">{s.label}</span>
            {s.access !== "Full" && <span className="rounded-full bg-canvas/10 px-2 py-px text-[10.5px] text-canvas/60">{s.access}</span>}
          </div>
          <ul className="space-y-0.5">
            {s.items.map((i) => {
              const active = isActive(i.href);
              return (
                <li key={i.href} className="relative">
                  {active && <Marker />}
                  <Link
                    href={base + i.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "block rounded-xl px-3 py-1.5 text-[14px] transition-colors",
                      active ? "bg-canvas/10 font-medium text-canvas" : "text-canvas/75 hover:bg-canvas/5 hover:text-canvas",
                    )}
                  >
                    {i.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
