import type { PlatformNavSection } from "../lib/access";

/**
 * Adds "Sign-ups" under Institutes. The Institutes section only exists for people holding
 * platform.manage_universities, so the new entry is gated by that permission too (the page
 * itself checks again). A plain module, so the layout and the client menu can both use it.
 */
export function withSignups(sections: PlatformNavSection[]): PlatformNavSection[] {
  return sections.map((s) =>
    s.key === "universities" && !s.items.some((i) => i.href === "/signups") ? { ...s, items: [...s.items, { label: "Sign-ups", href: "/signups" }] } : s,
  );
}
