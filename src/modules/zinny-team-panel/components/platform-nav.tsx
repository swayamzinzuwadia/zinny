"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { PlatformNavSection } from "../lib/access";

/** The gold triangle from the logo marks where you are (same as the admin panel). */
function Marker() {
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" className="absolute -left-[3px] top-1/2 -translate-y-1/2" aria-hidden>
      <path d="M0 0 L8 5 L0 10 Z" fill="#D4A72A" />
    </svg>
  );
}

const BASE = "/platform";

export function PlatformNav({ sections }: { sections: PlatformNavSection[] }) {
  const path = usePathname();
  // The longest matching href wins, so /support/log doesn't also light up /support.
  const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
  const matches = (href: string) => (href === "" ? path === BASE : path === BASE + href || path.startsWith(BASE + href + "/"));
  const current = hrefs.filter(matches).sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="space-y-6" aria-label="Zinny team panel">
      {sections.map((s) => (
        <div key={s.key}>
          <div className="mb-1.5 flex items-center justify-between px-3 text-[12px]">
            <span className="text-canvas/55">{s.label}</span>
            {s.access && <span className="rounded-full bg-canvas/10 px-2 py-px text-[10.5px] text-canvas/60">{s.access}</span>}
          </div>
          <ul className="space-y-0.5">
            {s.items.map((i) => {
              const active = i.href === current;
              return (
                <li key={i.href} className="relative">
                  {active && <Marker />}
                  <Link
                    href={BASE + i.href}
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
