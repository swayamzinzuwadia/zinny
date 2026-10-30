/**
 * Who on the Zinny team may open which part of /platform (contracts.md section 9).
 * Hiding a section is only for convenience: every service function checks again.
 */
import { assertPlatform, canPlatform, type Action, type Actor } from "@/server/core";
import { ForbiddenError } from "@/server/errors";

export const PLATFORM_ACTIONS = [
  "platform.manage_universities",
  "platform.support_mode",
  "platform.licences",
  "platform.content_review",
  "platform.partners",
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
  {
    key: "universities",
    label: "Universities",
    entries: [
      { label: "Universities", href: "/universities", allowed: can("platform.manage_universities") },
      { label: "Licences", href: "/licences", allowed: can("platform.licences") },
    ],
  },
  { key: "people", label: "People", entries: [{ label: "People", href: "/people", allowed: isSuperAdmin }] },
  {
    key: "support",
    label: "Support",
    entries: [
      { label: "Support mode", href: "/support", allowed: can("platform.support_mode") },
      { label: "Activity log", href: "/support/log", allowed: can("platform.support_mode") },
    ],
  },
  {
    key: "content",
    label: "Content",
    entries: [{ label: "Review queue", href: "/content", allowed: canSeeContentFlags }],
    access: (actor) => (canPlatform(actor, "platform.content_review") ? undefined : "View"),
  },
  { key: "partners", label: "Partners", entries: [{ label: "Sponsors and partners", href: "/partners", allowed: can("platform.partners") }] },
  { key: "billing", label: "Billing", entries: [{ label: "Zinny invoices", href: "/billing", allowed: can("platform.finance") }] },
  { key: "analytics", label: "Analytics", entries: [{ label: "Analytics", href: "/analytics", allowed: can("platform.view_analytics") }] },
  { key: "team", label: "Team", entries: [{ label: "Team and roles", href: "/team", allowed: isSuperAdmin }] },
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
