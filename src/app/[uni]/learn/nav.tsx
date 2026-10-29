"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";
import type { TrailParent } from "@/components/page-trail";

type Item = { href: string; label: string };

/** The learner app's sections. The first four are the phone tab bar; the rest join them on wider screens. */
export function learnSections(base: string, parentOnly: boolean): { primary: Item[]; more: Item[] } {
  if (parentOnly) return { primary: [{ href: base, label: "Home" }], more: [] };
  return {
    primary: [
      { href: base, label: "Today" },
      { href: `${base}/timetable`, label: "Timetable" },
      { href: `${base}/courses`, label: "Courses" },
      { href: `${base}/my`, label: "My learning" },
    ],
    more: [
      { href: `${base}/assignments`, label: "Assignments" },
      { href: `${base}/leaderboard`, label: "Leaderboard" },
      { href: `${base}/certificates`, label: "Certificates" },
    ],
  };
}

/** Where each deeper learner page leads back to (relative to /<uni>/learn). */
export const LEARN_PARENTS: TrailParent[] = [
  { prefix: "/timetable", href: "/timetable", label: "Timetable" },
  { prefix: "/courses", href: "/courses", label: "Courses" },
  { prefix: "/checkout", href: "/courses", label: "Courses" },
  { prefix: "/my", href: "/my", label: "My learning" },
  { prefix: "/lessons", href: "/my", label: "My learning" },
  { prefix: "/tests", href: "/tests", label: "Tests" },
  { prefix: "/assignments", href: "/assignments", label: "Assignments" },
  { prefix: "/leaderboard", href: "/leaderboard", label: "Leaderboard" },
  { prefix: "/certificates", href: "/certificates", label: "Certificates" },
  { prefix: "/invoices", href: "/invoices", label: "Invoices" },
  { prefix: "/polls", href: "", label: "Today" },
  { prefix: "/settings", href: "", label: "Today" },
  { prefix: "/join", href: "/timetable", label: "Timetable" },
];

function useActive(base: string) {
  const path = usePathname();
  return (href: string) => (href === base ? path === base : path === href || path.startsWith(href + "/"));
}

/** Tabs across the top on tablets and desktops. */
export function LearnTabs({ base, parentOnly, className }: { base: string; parentOnly: boolean; className?: string }) {
  const active = useActive(base);
  const { primary, more } = learnSections(base, parentOnly);
  return (
    <nav aria-label="Learner app" className={cx("min-w-0", className)}>
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
        {[...primary, ...more].map((i) => {
          const on = active(i.href);
          return (
            <li key={i.href} className="shrink-0">
              <Link
                href={i.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "block rounded-full px-3.5 py-2 text-[14px] whitespace-nowrap [transition-property:background-color,color] duration-150",
                  on ? "bg-brand-deep font-medium text-canvas" : "text-muted hover:bg-surface hover:text-ink",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  Today: <path d="M4 5.5h12v11H4zM4 8.5h12M7.5 3.5v3M12.5 3.5v3M9.5 12h1" />,
  Home: <path d="M3.5 9 10 3.5 16.5 9v7.5h-4.5v-5H8v5H3.5z" />,
  Timetable: <path d="M3.5 4.5h13v12h-13zM3.5 8h13M7.5 11h1.5M11 11h1.5M7.5 13.5h1.5" />,
  Courses: <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5zM4 16.5A1.5 1.5 0 0 0 5.5 18H16v-3" />,
  "My learning": <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM8.5 7l4 3-4 3z" />,
};

/** The tab bar on phones (the learner app is mobile first). */
export function LearnBottomBar({ base, parentOnly }: { base: string; parentOnly: boolean }) {
  const active = useActive(base);
  const { primary } = learnSections(base, parentOnly);
  return (
    <nav
      data-learn-chrome
      aria-label="Learner app"
      className="fixed inset-x-3 bottom-3 z-30 rounded-[26px] bg-brand-deep p-1.5 shadow-[0_8px_30px_rgb(6_58_47/0.3)] sm:hidden"
    >
      <ul className="flex justify-between gap-1">
        {primary.map((i) => {
          const on = active(i.href);
          return (
            <li key={i.href} className="flex-1">
              <Link
                href={i.href}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "flex flex-col items-center gap-0.5 rounded-[20px] px-1 py-1.5 text-[11px] whitespace-nowrap [transition-property:background-color,color] duration-150",
                  on ? "bg-gold font-medium text-brand-deep" : "text-canvas/70 active:bg-canvas/10",
                )}
              >
                <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  {ICONS[i.label]}
                </svg>
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
