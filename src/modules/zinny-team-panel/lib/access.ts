/**
 * Who on the Zinny team may open which part of /platform (contracts.md section 9).
 * Hiding a section is only for convenience: every service function checks again.
 */
import { assertPlatform, canPlatform, type Action, type Actor } from "@/server/core";
import { ForbiddenError } from "@/server/errors";

/**
 * What opens a part of the panel. `platform.partners` isn't here: Partners was taken out of
 * the panel, so that permission on its own no longer opens anything.
 */
export const PLATFORM_ACTIONS = [
  "platform.manage_universities",
  "platform.support_mode",
  "platform.licences",
  "platform.content_review",
  "platform.finance",
  "platform.view_analytics",
] as const satisfies readonly Action[];

export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

function activeNow(a: { startsAt: Date; endsAt: Date | null }, now: Date) {
  return a.startsAt <= now && (a.endsAt === null || a.endsAt > now);
}

/** Holds at least one Zinny team role. */
export function isZinnyTeam(actor: Actor): boolean {
  return PLATFORM_ACTIONS.some((a) => canPlatform(actor, a));
}

/** Super Admin is the only role that manages the Zinny team itself. */
export function isSuperAdmin(actor: Actor, now = new Date()): boolean {
  return actor.assignments.some((a) => a.scopeType === "platform" && a.role === "super_admin" && activeNow(a, now));
}

export function assertSuperAdmin(actor: Actor) {
  if (!isSuperAdmin(actor)) throw new ForbiddenError("Only a Super Admin can manage the Zinny team.");
}

/** Content QA works the review queue; Account Managers can read the flags to follow up with universities. */
export function canSeeContentFlags(actor: Actor): boolean {
  return canPlatform(actor, "platform.content_review") || canPlatform(actor, "platform.manage_universities");
}

export function assertSeeContentFlags(actor: Actor) {
  if (!canSeeContentFlags(actor)) throw new ForbiddenError();
}

export { assertPlatform, canPlatform };

/* ─────────────────────────── Navigation ─────────────────────────── */

export type PlatformNavItem = { label: string; href: string };
export type PlatformNavSection = { key: string; label: string; access?: string; items: PlatformNavItem[] };

type Entry = { label: string; href: string; allowed: (actor: Actor) => boolean };
type Section = { key: string; label: string; entries: Entry[]; access?: (actor: Actor) => string | undefined };

const can = (action: PlatformAction) => (actor: Actor) => canPlatform(actor, action);

const SECTIONS: Section[] = [
  { key: "overview", label: "Overview", entries: [{ label: "Home", href: "", allowed: isZinnyTeam }] },
  { key: "universities", label: "Institutes", entries: [{ label: "Institutes", href: "/institutes", allowed: can("platform.manage_universities") }] },
  // What Zinny sells, to whom, and how it gets paid: one place for plans, licences and invoices.
  {
    key: "billing",
    label: "Plans and billing",
    entries: [
      { label: "Plans and prices", href: "/plans", allowed: can("platform.licences") },
      { label: "Licences", href: "/licences", allowed: can("platform.licences") },
      { label: "Invoices", href: "/billing", allowed: can("platform.finance") },
      { label: "Billing settings", href: "/billing/settings", allowed: (a) => isSuperAdmin(a) || canPlatform(a, "platform.finance") },
    ],
  },
  { key: "people", label: "Users", entries: [{ label: "Users", href: "/people", allowed: isSuperAdmin }] },
  {
    key: "support",
    label: "Support",
    entries: [
      { label: "Support mode", href: "/support", allowed: can("platform.support_mode") },
      { label: "Activity log", href: "/support/log", allowed: can("platform.support_mode") },
    ],
  },
  // A section with one page is labelled like that page, so the menu, the page title and
  // the way back all use the same name.
  {
    key: "content",
    label: "Content review",
    entries: [{ label: "Content review", href: "/content", allowed: canSeeContentFlags }],
    access: (actor) => (canPlatform(actor, "platform.content_review") ? undefined : "View"),
  },
  { key: "analytics", label: "Analytics", entries: [{ label: "Analytics", href: "/analytics", allowed: can("platform.view_analytics") }] },
  // Every table in the database, for Super Admins only (see data-console.ts).
  { key: "data", label: "Data", entries: [{ label: "Data", href: "/data", allowed: isSuperAdmin }] },
  {
    key: "team",
    label: "Team",
    entries: [
      { label: "Team", href: "/team", allowed: isSuperAdmin },
      { label: "Roles & permissions", href: "/roles", allowed: isSuperAdmin },
    ],
  },
];

/** The sidebar for this person: only the sections their platform roles allow. */
export function navFor(actor: Actor): PlatformNavSection[] {
  return SECTIONS.map((s) => ({
    key: s.key,
    label: s.label,
    access: s.access?.(actor),
    items: s.entries.filter((e) => e.allowed(actor)).map(({ label, href }) => ({ label, href })),
  })).filter((s) => s.items.length > 0);
}

/* ─────────────────────────── The sidebar ─────────────────────────── */

/*
 * How the sidebar arranges those pages: by the job, flat, each page in one place. SECTIONS and
 * navFor above stay the list of who may open what; a link shows here when navFor allows it.
 * A link's other pages (Billing's plans, Settings' team) show under it only while you are inside it.
 */

export type PlatformSidebarLink = { label: string; href: string };
export type PlatformSidebarItem = { key: string; icon: string; label: string; href: string; own: boolean; access?: string; children: PlatformSidebarLink[] };
export type PlatformSidebarGroup = { key: string; label?: string; items: PlatformSidebarItem[] };

type SidebarDef = { key: string; icon: string; label: string; page?: string; children?: PlatformSidebarLink[] };

const SIDEBAR: SidebarDef[] = [
  { key: "overview", icon: "overview", label: "Overview", page: "" },
  { key: "universities", icon: "universities", label: "Institutes", page: "/institutes" },
  { key: "people", icon: "people", label: "Users", page: "/people" },
  {
    key: "billing",
    icon: "billing",
    label: "Billing",
    children: [
      { label: "Invoices", href: "/billing" },
      { label: "Plans and prices", href: "/plans" },
      { label: "Licences", href: "/licences" },
    ],
  },
  { key: "support", icon: "support", label: "Support mode", page: "/support", children: [{ label: "Activity log", href: "/support/log" }] },
  { key: "content", icon: "content", label: "Content review", page: "/content" },
  { key: "analytics", icon: "analytics", label: "Analytics", page: "/analytics" },
  // How the panel itself is set up, away from the everyday work above.
  {
    key: "settings",
    icon: "settings",
    label: "Settings",
    children: [
      { label: "Team", href: "/team" },
      { label: "Roles & permissions", href: "/roles" },
      { label: "Billing settings", href: "/billing/settings" },
      { label: "Data", href: "/data" },
    ],
  },
];

/** The sidebar for this person: SIDEBAR, keeping only the pages navFor lets them open. */
export function sidebarFor(actor: Actor): PlatformSidebarGroup[] {
  const sections = navFor(actor);
  const open = new Set(sections.flatMap((s) => s.items.map((i) => i.href)));
  const content = sections.find((s) => s.key === "content")?.access;
  const items: PlatformSidebarItem[] = [];
  for (const def of SIDEBAR) {
    const children = (def.children ?? []).filter((c) => open.has(c.href));
    const base = { key: def.key, icon: def.icon, ...(def.key === "content" && content && { access: content }) };
    if (def.page !== undefined && open.has(def.page)) items.push({ ...base, label: def.label, href: def.page, own: true, children });
    // One page left of a group: it is the link, under its own name.
    else if (children.length === 1) items.push({ ...base, label: children[0].label, href: children[0].href, own: true, children: [] });
    else if (children.length > 1) items.push({ ...base, label: def.label, href: children[0].href, own: false, children });
  }
  return items.length > 0 ? [{ key: "panel", items }] : [];
}

/** Every link in a sidebar, flat: for marking the current page and for the way back. */
export function sidebarLinks(groups: PlatformSidebarGroup[]): PlatformSidebarLink[] {
  return groups.flatMap((g) => g.items.flatMap((i) => [...(i.own ? [{ label: i.label, href: i.href }] : []), ...i.children]));
}
