"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useNavPath } from "./nav-progress";
import { cx } from "./ui";

/*
 * The dark green sidebar menu shared by the admin panel and the Zinny team panel.
 * Every link is visible: links sit flat under plain headings, with nothing to open or close.
 * A link with pages of its own (Marketplace's combos, Settings' roles) shows them under it
 * only while you are inside it, so they unfold from the link you just used.
 */

export type SidebarLink = { label: string; href: string };
/**
 * `own` false means the link has no page of its own and leads to its first child. `covers`
 * are the other pages of the link's screen (its tabs): being on one keeps the link marked.
 */
export type SidebarItem = { key: string; icon: string; label: string; href: string; own: boolean; access?: string; children: SidebarLink[]; covers?: SidebarLink[] };
export type SidebarGroup = { key: string; label?: string; items: SidebarItem[] };

/**
 * The one menu item that owns `path`: an exact match, or else the item with the longest
 * prefix. So /leaderboards/badges marks "Badges", not "Leaderboard" (/leaderboards) as well.
 */
export function activeHref(path: string, base: string, hrefs: string[]): string | null {
  const matches = hrefs.filter((h) => (h === "" ? path === base : path === base + h || path.startsWith(base + h + "/")));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function SidebarNav({ base, groups, label }: { base: string; groups: SidebarGroup[]; label: string }) {
  const path = useNavPath();
  const current = activeHref(
    path,
    base,
    groups.flatMap((g) => g.items.flatMap((i) => [i.href, ...i.children.map((c) => c.href), ...(i.covers ?? []).map((c) => c.href)])),
  );

  return (
    <nav aria-label={label}>
      {groups.map((g, n) => (
        <div key={g.key} role={g.label ? "group" : undefined} aria-label={g.label} className={cx(n > 0 && (g.label ? "mt-3" : "mt-3 border-t border-canvas/10 pt-3"))}>
          {g.label && <div className="px-3 pb-1 text-[12px] leading-4 font-medium text-canvas/40">{g.label}</div>}
          <div className="space-y-px">
            {g.items.map((i) => (
              <Item key={i.key} item={i} base={base} current={current} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

// Rows are kept short so the whole menu fits a laptop screen without scrolling.
const row = "group/row relative flex w-full items-center gap-3 rounded-xl px-3 py-1.5 text-[14px] leading-5 [transition-property:background-color,color] duration-150";

function Item({ item, base, current }: { item: SidebarItem; base: string; current: string | null }) {
  // On the link's own page the link is marked; on one of its pages the link stays lit and the page is marked below it.
  const here = item.own && (item.href === current || (item.covers ?? []).some((c) => c.href === current));
  const inside = item.children.some((c) => c.href === current);
  const open = here || inside;
  const id = `nav-${item.key}`;
  // On a short screen the pages can unfold below the edge of the menu: bring them into view.
  const box = useRef<HTMLDivElement>(null);
  const reveal = () => box.current?.scrollIntoView({ block: "nearest" });
  const unfolds = open && item.children.length > 0;
  useEffect(() => {
    if (unfolds) box.current?.scrollIntoView({ block: "nearest" });
  }, [unfolds]);

  return (
    <div ref={box}>
      <Link
        href={base + item.href}
        aria-current={here ? "page" : undefined}
        aria-expanded={item.children.length > 0 ? open : undefined}
        aria-controls={item.children.length > 0 ? id : undefined}
        title={item.access}
        className={cx(row, here ? "bg-canvas/[0.12] font-medium text-canvas" : inside ? "text-canvas" : "text-canvas/70 hover:bg-canvas/[0.06] hover:text-canvas")}
      >
        {here && <Marker />}
        <Icon name={item.icon} active={open} />
        <span className="truncate">{item.label}</span>
      </Link>
      {item.children.length > 0 && (
        // Grid rows animate from 0fr to 1fr, so the pages unfold from their link to their natural height.
        <div
          id={id}
          onTransitionEnd={(e) => e.target === e.currentTarget && open && reveal()}
          className={cx(
            "grid [transition-property:grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <ul className="ml-[22px] min-h-0 space-y-px overflow-hidden border-l border-canvas/10 pl-3" inert={!open}>
            {item.children.map((c, n) => {
              const active = c.href === current;
              return (
                <li key={c.href} className={cx("relative", n === 0 && "pt-1", n === item.children.length - 1 && "pb-1.5")}>
                  {active && <span aria-hidden className="absolute top-1/2 -left-[13.5px] h-4 w-[2px] -translate-y-1/2 rounded-full bg-gold" />}
                  <Link
                    href={base + c.href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "block truncate rounded-lg px-2.5 py-1.5 text-[13.5px] [transition-property:background-color,color] duration-150",
                      active ? "bg-canvas/[0.12] font-medium text-canvas" : "text-canvas/60 hover:bg-canvas/[0.06] hover:text-canvas",
                    )}
                  >
                    {c.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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


/* Simple line icons, one per section. Unknown sections get a small dot. */
const PATHS: Record<string, React.ReactNode> = {
  dashboard: <path d="M3 3h5.5v6.5H3zM11.5 3H17v4h-5.5zM11.5 10H17v7h-5.5zM3 12.5h5.5V17H3z" />,
  overview: <path d="M3.5 9 10 3.5 16.5 9v7.5h-4.5v-5H8v5H3.5z" />,
  products: <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H16v12H5.5A1.5 1.5 0 0 0 4 16.5zM4 16.5A1.5 1.5 0 0 0 5.5 18H16v-3M7.5 6.5h5" />,
  users: <path d="M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 17a5 5 0 0 1 10 0M13 3.8a3 3 0 0 1 0 5.4M15 12.5a5 5 0 0 1 2.5 4.5" />,
  marketplace: <path d="M3 7.5 4.5 3h11L17 7.5M3 7.5h14M3 7.5a2.3 2.3 0 0 0 4.7 0 2.3 2.3 0 0 0 4.6 0 2.3 2.3 0 0 0 4.7 0M4.5 10v7h11v-7M8 17v-4h4v4" />,
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
  people: <path d="M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 17a5 5 0 0 1 10 0M13 3.8a3 3 0 0 1 0 5.4M15 12.5a5 5 0 0 1 2.5 4.5" />,
  batches: <path d="M3.5 5h13v11.5h-13zM3.5 8.5h13M7 3v3.5M13 3v3.5M7 11.5h2M11.5 11.5h1.5M7 14h2" />,
  timetable: <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM10 6v4l2.5 2" />,
  tests: <path d="M7 4H4.5v13.5h11V4H13M7 2.5h6v3H7zM7.5 11.5l1.8 1.8 3.4-3.6" />,
  certificates: <path d="M10 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM7.3 10.6 6.2 17.5 10 15.3l3.8 2.2-1.1-6.9" />,
  students: <path d="M2 8l8-4 8 4-8 4zM5.5 9.8v3.6c1.2 1.3 2.7 1.9 4.5 1.9s3.3-.6 4.5-1.9V9.8M18 8v4.5" />,
  enquiries: <path d="M3 4h14v9.5H9.5L5.5 17v-3.5H3zM6.5 7.5h7M6.5 10h4.5" />,
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
