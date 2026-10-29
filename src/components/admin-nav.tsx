"use client";

import { SidebarNav, type SidebarSection } from "./sidebar-nav";

export { activeHref } from "./sidebar-nav";

export type NavSection = { key: string; label: string; hint: string; access: string; items: { label: string; href: string }[] };

/** The admin panel menu. Access is shown only where it is less than full. */
export function AdminNav({ base, sections }: { base: string; sections: NavSection[] }) {
  const items: SidebarSection[] = sections.map((s) => ({
    key: s.key,
    label: s.label,
    access: s.access !== "Full" ? s.access : undefined,
    items: s.items,
  }));
  return <SidebarNav base={base} sections={items} label="Admin panel" />;
}
