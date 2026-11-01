"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cx } from "./ui";

/*
 * Next.js shows nothing between a click and the finished page, so a page that takes a
 * second looks like a dead click, and every extra click asks the server for it again.
 * This answers each click at once with a gold bar along the top, moves the menu highlight
 * to where you are going, and ignores repeat clicks on a page that is already on its way.
 */

/** Stop waiting after this long, so a navigation that failed can't leave the bar running. */
const GIVE_UP_MS = 20_000;

let target: string | null = null;
const listeners = new Set<() => void>();

function setTarget(next: string | null) {
  if (next === target) return;
  target = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const useTarget = () =>
  useSyncExternalStore(
    subscribe,
    () => target,
    () => null,
  );

/** The path you are on, or the one you just clicked while it loads. */
export function useNavPath() {
  const path = usePathname();
  return useTarget()?.split("?")[0] ?? path;
}

const here = () => location.pathname + location.search;

/** Where a plain left click on a same-site link goes, or null for any other click. */
function destination(e: MouseEvent): string | null {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
  if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return null;
  const url = new URL(link.href);
  if (url.origin !== location.origin) return null;
  const to = url.pathname + url.search;
  // A jump to a spot on this page isn't a navigation.
  return url.hash && to === here() ? null : to;
}

export function NavigationProgress() {
  const path = usePathname();
  const search = useSearchParams().toString();
  const going = useTarget();
  const [shown, setShown] = useState(false);

  useEffect(() => setTarget(null), [path, search]);

  useEffect(() => {
    const stopRepeat = (e: MouseEvent) => {
      const to = destination(e);
      if (to && (to === target || to === here())) e.preventDefault();
    };
    // Only Next's links cancel the click by the time it bubbles here. A plain link is a
    // full page load or a file download, which the browser shows for itself.
    const track = (e: MouseEvent) => {
      const to = destination(e);
      if (to && e.defaultPrevented && to !== here()) setTarget(to);
    };
    const reset = () => setTarget(null);
    document.addEventListener("click", stopRepeat, true);
    document.addEventListener("click", track);
    window.addEventListener("popstate", reset);
    window.addEventListener("pageshow", reset);
    return () => {
      document.removeEventListener("click", stopRepeat, true);
      document.removeEventListener("click", track);
      window.removeEventListener("popstate", reset);
      window.removeEventListener("pageshow", reset);
    };
  }, []);

  useEffect(() => {
    if (going) {
      setShown(true);
      const t = setTimeout(() => setTarget(null), GIVE_UP_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown(false), 260);
    return () => clearTimeout(t);
  }, [going]);

  return shown ? <div aria-hidden className={cx("nav-bar", !going && "nav-bar-done")} /> : null;
}
