"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export type NavSection = { key: string; label: string; hint: string; access: string; items: { label: string; href: string }[] };

export function AdminNav({ base, sections }: { base: string; sections: NavSection[] }) {
  const path = usePathname();
  const isActive = (href: string) => (href === "" ? path === base : path === base + href || path.startsWith(base + href + "/"));

  return (
    <nav className="space-y-5">
      {sections.map((s) => (
        <div key={s.key}>
          <div className="mb-1 flex items-center justify-between px-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">{s.label}</span>
            {s.access !== "full" && <span className="text-[10px] text-faint">{s.access}</span>}
          </div>
          <ul>
            {s.items.map((i) => (
              <li key={i.href}>
                <Link
                  href={base + i.href}
                  className={cx(
                    "block rounded-lg px-3 py-1.5 text-[14px]",
                    isActive(i.href) ? "bg-brand-soft font-medium text-brand-strong" : "text-ink hover:bg-canvas",
                  )}
                >
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
