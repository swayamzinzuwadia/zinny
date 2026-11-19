"use client";

import { SidebarNav } from "@/components/sidebar-nav";
import type { PlatformNavSection } from "../lib/access";
import { withSignups } from "./platform-sections";

/** The Zinny team panel menu, in the same sidebar as the admin panel. */
export function PlatformNav({ sections }: { sections: PlatformNavSection[] }) {
  return <SidebarNav base="/platform" sections={withSignups(sections)} label="Zinny team panel" />;
}
