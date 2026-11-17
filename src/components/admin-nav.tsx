"use client";

import { SidebarNav, type SidebarGroup } from "./sidebar-nav";

export { activeHref } from "./sidebar-nav";

/** The admin panel menu. Access is shown only where it is less than full. */
export function AdminNav({ base, groups }: { base: string; groups: SidebarGroup[] }) {
  return <SidebarNav base={base} groups={groups} label="Admin panel" />;
}
