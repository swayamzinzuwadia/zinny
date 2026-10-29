"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cx } from "./ui";

/*
 * The dark green sidebar menu shared by the admin panel and the Zinny team panel.
 * A section with one page is a single link. A section with several pages is a group that
 * opens and closes; the group holding the current page starts open, the rest start closed.
 */

export type SidebarSection = { key: string; label: string; access?: string; items: { label: string; href: string }[] };

/**
 * The one menu item that owns `path`: an exact match, or else the item with the longest
 * prefix. So /leaderboards/badges marks "Badges", not "Leaderboard" (/leaderboards) as well.
 */
export function activeHref(path: string, base: string, hrefs: string[]): string | null {
  const matches = hrefs.filter((h) => (h === "" ? path === base : path === base + h || path.startsWith(base + h + "/")));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function SidebarNav({ base, sections, label }: { base: string; sections: SidebarSection[]; label: string }) {
  const path = usePathname();
  const current = activeHref(
    path,
    base,
    sections.flatMap((s) => s.items.map((i) => i.href)),
  );

  return (
    <nav aria-label={label} className="space-y-0.5">
      {sections.map((s) =>
        s.items.length === 1 ? (
          <Single key={s.key} section={s} href={base + s.items[0].href} active={s.items[0].href === current} />
        ) : (
          <Group key={s.key} section={s} base={base} current={current} />
        ),
      )}
    </nav>
  );
}

const row = "group/row relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] [transition-property:background-color,color] duration-150";

function Single({ section, href, active }: { section: SidebarSection; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(row, active ? "bg-canvas/[0.12] font-medium text-canvas" : "text-canvas/70 hover:bg-canvas/[0.06] hover:text-canvas")}
    >
      {active && <Marker />}
      <Icon name={section.key} active={active} />
      <span className="truncate">{section.label}</span>
      {section.access && <Access text={section.access} />}
    </Link>
  );
}

function Group({ section, base, current }: { section: SidebarSection; base: string; current: string | null }) {
  const holdsCurrent = section.items.some((i) => i.href === current);
  const [open, setOpen] = useState(holdsCurrent);
  const id = `nav-${section.key}`;

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cx(row, holdsCurrent ? "text-canvas" : "text-canvas/70 hover:bg-canvas/[0.06] hover:text-canvas")}
      >
        <Icon name={section.key} active={holdsCurrent} />
        <span className="truncate">{section.label}</span>
        {section.access && <Access text={section.access} />}
        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className={cx(
            "ml-auto size-3.5 shrink-0 text-canvas/45 [transition-property:transform] duration-200 group-hover/row:text-canvas/70",
            open && "rotate-90",
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </button>
      {/* Grid rows animate from 0fr to 1fr, so the group opens to its natural height. */}
      <div
        id={id}
        className={cx(
          "grid [transition-property:grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <ul className="ml-[22px] min-h-0 space-y-px overflow-hidden border-l border-canvas/10 pl-3" inert={!open}>
          {section.items.map((i, n) => {
            const active = i.href === current;
            return (
              <li key={i.href} className={cx("relative", n === 0 && "pt-1", n === section.items.length - 1 && "pb-1.5")}>
                {active && <span aria-hidden className="absolute top-1/2 -left-[13.5px] h-4 w-[2px] -translate-y-1/2 rounded-full bg-gold" />}
                <Link
                  href={base + i.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "block truncate rounded-lg px-2.5 py-1.5 text-[13.5px] [transition-property:background-color,color] duration-150",
                    active ? "bg-canvas/[0.12] font-medium text-canvas" : "text-canvas/60 hover:bg-canvas/[0.06] hover:text-canvas",
                  )}
                >
                  {i.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** The gold triangle from the logo marks where you are. */
function Marker() {
  return (
    <svg width="8" height="10" viewBox="0 0 8 10" className="absolute top-1/2 -left-[3px] -translate-y-1/2" aria-hidden>
      <path d="M0 0 L8 5 L0 10 Z" fill="#D4A72A" />
    </svg>
  );
}

function Access({ text }: { text: string }) {
  return <span className="shrink-0 rounded-full bg-canvas/10 px-1.5 py-px text-[10px] leading-4 text-canvas/55">{text}</span>;
}

/* Simple line icons, one per section. Unknown sections get a small dot. */
const PATHS: Record<string, React.ReactNode> = {
  dashboard: <path d="M3 3h5.5v6.5H3zM11.5 3H17v4h-5.5zM11.5 10H17v7h-5.5zM3 12.5h5.5V17H3z" />,
  overview: <path d="M3.5 9 10 3.5 16.5 9v7.5h-4.5v-5H8v5H3.5z" />,
  products: <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5zM4 16.5A1.5 1.5 0 0 0 5.5 18H16v-3M7.5 6.5h5" />,
  users: <path d="M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 17a5 5 0 0 1 10 0M13 3.8a3 3 0 0 1 0 5.4M15 12.5a5 5 0 0 1 2.5 4.5" />,
  leaderboards: <path d="M6 3.5h8v3.5a4 4 0 0 1-8 0zM6 5H3.5v1a3 3 0 0 0 3 3M14 5h2.5v1a3 3 0 0 1-3 3M10 11v3M7 17h6M8 14h4v3H8z" />,
  finance: <path d="M3 6h14v10H3zM3 9h14M13 12.5h1.5M6 3.5h8" />,
  billing: <path d="M5 2.5h10v15l-2-1.3-1.5 1.3L10 16.2l-1.5 1.3L7 16.2l-2 1.3zM7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" />,
  website: <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM2.5 10h15M10 2.5c2 2.2 3 4.7 3 7.5s-1 5.3-3 7.5c-2-2.2-3-4.7-3-7.5s1-5.3 3-7.5Z" />,
  marketing: <path d="M3 8v4h2.5l6 3.5v-11l-6 3.5zM14.5 7.5a3.5 3.5 0 0 1 0 5M5.5 12l1 4.5h2l-.8-4" />,
  community: <path d="M3 4h10v7H7l-3 2.5V11H3zM13 7.5h4v6.5h-1v2.5l-3-2.5H9V11" />,
  insights: <path d="M3 17h14M5.5 14V9.5M10 14V5M14.5 14v-6.5" />,
  analytics: <path d="M3 17h14M5.5 14V9.5M10 14V5M14.5 14v-6.5" />,
  settings: <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7" />,
  universities: <path d="M2.5 8 10 3.5 17.5 8M4.5 8.5v6.5M8 8.5v6.5M12 8.5v6.5M15.5 8.5v6.5M2.5 17h15" />,
  support: <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4.7 4.7l3.2 3.2M12.1 12.1l3.2 3.2M15.3 4.7l-3.2 3.2M7.9 12.1l-3.2 3.2" />,
  content: <path d="M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5M7.5 11l2 2 3.5-3.5" />,
  partners: <path d="M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 17a5 5 0 0 1 10 0M14.5 6.5v5M12 9h5" />,
  team: <path d="M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 17a5 5 0 0 1 10 0M13 3.8a3 3 0 0 1 0 5.4M15 12.5a5 5 0 0 1 2.5 4.5" />,
};

function Icon({ name, active }: { name: string; active: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={cx("size-[18px] shrink-0", active ? "text-gold" : "text-canvas/55 group-hover/row:text-canvas/80")}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name] ?? <circle cx="10" cy="10" r="2" fill="currentColor" />}
    </svg>
  );
}
