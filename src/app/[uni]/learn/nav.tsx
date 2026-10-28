"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

/** Bottom tab bar on phones (the learner app is mobile first), pills on larger screens. */
export function LearnNav({ base, parentOnly }: { base: string; parentOnly: boolean }) {
  const path = usePathname();
  const items = parentOnly
    ? [{ href: base, label: "Home" }]
    : [
        { href: base, label: "Today" },
        { href: `${base}/timetable`, label: "Timetable" },
        { href: `${base}/courses`, label: "Courses" },
        { href: `${base}/my`, label: "My learning" },
      ];
  const active = (href: string) => (href === base ? path === base : path.startsWith(href));
  return (
    <nav className="fixed inset-x-3 bottom-3 z-20 rounded-full bg-brand-deep p-1.5 shadow-[0_8px_30px_rgb(6_58_47/0.25)] sm:static sm:inset-auto sm:mb-8 sm:inline-flex sm:shadow-none">
      <ul className="flex justify-between gap-1">
        {items.map((i) => (
          <li key={i.href} className="flex-1 sm:flex-none">
            <Link
              href={i.href}
              aria-current={active(i.href) ? "page" : undefined}
              className={cx(
                "block whitespace-nowrap rounded-full px-2 py-2 text-center text-[13px] sm:px-4 sm:text-[14px]",
                active(i.href) ? "bg-gold font-medium text-brand-deep" : "text-canvas/75 hover:text-canvas",
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
