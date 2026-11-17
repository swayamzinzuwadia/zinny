"use client";

import { SidebarNav } from "@/components/sidebar-nav";
import type { PlatformSidebarGroup } from "../lib/access";

/** The Zinny team panel menu, in the same sidebar as the admin panel. */
export function PlatformNav({ groups }: { groups: PlatformSidebarGroup[] }) {
  return <SidebarNav base="/platform" groups={groups} label="Zinny team panel" />;
}
