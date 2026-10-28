"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

/** Bottom tab bar on phones (learner app is mobile first), tabs on larger screens. */
export function LearnNav({ base, parentOnly }: { base: string; parentOnly: boolean }) {
  const path = usePathname();
  const items = parentOnly
    ? [{ href: base, label: "Home" }]
    : [
        { href: base, label: "Home" },
        { href: `${base}/courses`, label: "Courses" },
        { href: `${base}/timetable`, label: "Timetable" },
        { href: `${base}/my`, label: "My learning" },
      ];
  const active = (href: string) => (href === base ? path === base : path.startsWith(href));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur sm:static sm:mb-6 sm:border-0 sm:bg-transparent sm:px-6">
      <ul className="mx-auto flex max-w-5xl justify-around sm:justify-start sm:gap-1">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              className={cx(
                "block px-4 py-3 text-[13px] font-medium sm:rounded-full sm:py-1.5 sm:text-[14px]",
                active(i.href) ? "text-brand sm:bg-brand-soft" : "text-muted hover:text-ink",
              )}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
