"use client";

import { SidebarNav } from "@/components/sidebar-nav";
import type { PlatformNavSection } from "../lib/access";

/** The Zinny team panel menu, in the same sidebar as the admin panel. */
export function PlatformNav({ sections }: { sections: PlatformNavSection[] }) {
  return <SidebarNav base="/platform" sections={sections} label="Zinny team panel" />;
}
