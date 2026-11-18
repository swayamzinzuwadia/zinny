import { screenTabs } from "@/server/authz/menu";
import type { Actor } from "@/server/authz/engine";
import { Tabs } from "./ui";

/**
 * Reports is one screen made of three pages that different modules own: the charts, the
 * reports to run and download, and learning progress. Each page shows the same title and
 * this row of tabs, so it reads as one place. Someone who may open only one of the pages
 * gets no tabs, and that page keeps its own name.
 */
export function reportsScreen(actor: Actor, universityId: string, uni: string, active: "/insights" | "/finance/reports" | "/products/content") {
  const tabs = screenTabs(actor, universityId, "reports");
  const shared = tabs.length > 1;
  return {
    /** The screen's name, or null when this page stands alone under its own. */
    title: shared ? "Reports" : null,
    tabs: shared ? <Tabs active={active} tabs={tabs.map((t) => ({ ...t, href: `/${uni}/admin${t.href}` }))} /> : null,
  };
}
