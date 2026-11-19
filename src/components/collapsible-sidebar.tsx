"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./collapsible-sidebar.css";
import type { SidebarMode } from "./sidebar-mode";
import { cx } from "./ui";

/*
 * The side column of the admin panel and the Zinny team panel, collapsible to an icon rail.
 *
 * The choice is kept in a cookie, so the server renders the right width on the first paint:
 * "1" collapsed, "0" expanded. With no cookie the mode is "auto": expanded on wide screens,
 * a rail on tablets (768 to 1279 px). Width and labels follow the data-collapsed attribute
 * in CSS (collapsible-sidebar.css), so nothing depends on JavaScript to look right.
 * In the rail, hovering or focusing an icon shows its name in a tooltip.
 */

type Rail = { available: boolean; collapsed: boolean; toggle: () => void; expand: () => void };
const RailContext = createContext<Rail>({ available: false, collapsed: false, toggle: () => {}, expand: () => {} });

/** What the menu needs to know: whether the sidebar is a rail right now, and how to open it. */
export const useSidebarRail = () => useContext(RailContext);

const TABLET = "(min-width: 768px) and (max-width: 1279.98px)";

export function CollapsibleAside({ cookie, initial, children }: { cookie: string; initial: SidebarMode; children: ReactNode }) {
  const [mode, setMode] = useState<SidebarMode>(initial);
  const [tablet, setTablet] = useState(false);
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  const aside = useRef<HTMLElement>(null);

  useEffect(() => {
    const mq = window.matchMedia(TABLET);
    const update = () => setTablet(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const collapsed = mode === "1" || (mode === "auto" && tablet);

  const choose = useCallback(
    (next: "1" | "0") => {
      setMode(next);
      setTip(null);
      try {
        document.cookie = `${cookie}=${next}; path=/; max-age=31536000; samesite=lax`;
      } catch {
        // Cookies blocked: the choice lasts until the page is reloaded.
      }
    },
    [cookie],
  );
  const rail = useMemo<Rail>(
    () => ({ available: true, collapsed, toggle: () => choose(collapsed ? "0" : "1"), expand: () => choose("0") }),
    [collapsed, choose],
  );

  function showTip(target: EventTarget | null) {
    const el = (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]");
    if (!el || !aside.current || aside.current.offsetWidth > 120) return;
    const r = el.getBoundingClientRect();
    setTip({ text: el.dataset.tip ?? "", top: r.top + r.height / 2, left: r.right + 10 });
  }

  return (
    <RailContext.Provider value={rail}>
      <aside
        ref={aside}
        data-collapsed={mode === "1" ? "true" : mode === "0" ? "false" : "auto"}
        className="zs-aside hidden shrink-0 bg-brand-deep md:block"
        onPointerOver={(e) => showTip(e.target)}
        onPointerOut={() => setTip(null)}
        onFocusCapture={(e) => showTip(e.target)}
        onBlurCapture={() => setTip(null)}
        onScrollCapture={() => setTip(null)}
      >
        <div className="sticky top-0 h-dvh px-3 py-6">{children}</div>
        {tip && (
          <div role="tooltip" className="zs-tip pointer-events-none fixed z-50 -translate-y-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-[13px] whitespace-nowrap text-canvas shadow-lg" style={{ top: tip.top, left: tip.left }}>
            {tip.text}
          </div>
        )}
      </aside>
    </RailContext.Provider>
  );
}

/** The collapse and expand button. Shows only inside a CollapsibleAside (not in the phone menu). */
export function SidebarToggle() {
  const rail = useSidebarRail();
  if (!rail.available) return null;
  const label = rail.collapsed ? "Expand menu" : "Collapse menu";
  return (
    <button
      type="button"
      onClick={rail.toggle}
      aria-expanded={!rail.collapsed}
      aria-label={label}
      data-tip={label}
      className="zs-row group/row mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] text-canvas/55 [transition-property:background-color,color] duration-150 hover:bg-canvas/[0.06] hover:text-canvas"
    >
      <svg aria-hidden viewBox="0 0 20 20" className={cx("size-[18px] shrink-0 [transition-property:transform] duration-300", rail.collapsed && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 4v12M16.5 10H7.5M11 6.5 7.5 10l3.5 3.5" />
      </svg>
      <span className="zs-label truncate">Collapse menu</span>
    </button>
  );
}
