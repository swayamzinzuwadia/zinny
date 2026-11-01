/**
 * What can be switched on or off for a role, in the words people use. An ability bundles the
 * actions behind one idea ("Create and edit courses"), and says the narrowest reach it works
 * at: services check finance against the whole institute, so a department-wide role with
 * Finance ticked would do nothing, and the editor doesn't offer it.
 *
 * Saved permissions always pass through effectiveGrants(), every time they are read. Whatever
 * a row in custom_roles says, it can't reach a locked action or one outside the role's reach.
 */
import type { RoleName, ScopeType } from "@/db/schema";
import type { Access, SectionKey } from "./menu";
import { ROLE_GRANTS, type Action } from "./roles";

export type Reach = "institute" | "department" | "batch";

export type Ability = {
  key: string;
  section: string;
  label: string;
  actions: readonly Action[];
  /** The narrowest reach it works at. */
  reach: Reach;
  /** Looking only: doesn't count as being able to change anything. */
  readOnly?: boolean;
  /** Other abilities this one can't work without. */
  needs?: readonly string[];
  /** Part of the role, never switched on or off. */
  locked?: boolean;
  /** What it means for a Head of Department, when that differs. */
  hod?: string;
};

export const INSTITUTE_ABILITIES: readonly Ability[] = [
  { key: "courses.view", section: "products", label: "View courses and batches", actions: ["course.view", "batch.view", "enrolment.view"], reach: "batch", readOnly: true },
  { key: "courses.edit", section: "products", label: "Create and edit courses", actions: ["course.create", "course.update"], reach: "department", needs: ["courses.view"] },
  { key: "courses.delete", section: "products", label: "Delete courses", actions: ["course.delete"], reach: "department", needs: ["courses.view"] },
  { key: "courses.complete", section: "products", label: "Mark courses complete", actions: ["enrolment.complete"], reach: "department", needs: ["courses.view"] },
  { key: "batches.edit", section: "products", label: "Create and edit batches", actions: ["batch.create", "batch.update"], reach: "department", needs: ["courses.view"] },
  { key: "batches.delete", section: "products", label: "Delete batches", actions: ["batch.delete"], reach: "department", needs: ["courses.view"] },
  { key: "batches.faculty", section: "products", label: "Assign faculty to batches", actions: ["batch.assign_faculty"], reach: "department", needs: ["courses.view"] },
  { key: "batches.switch", section: "products", label: "Decide batch switch requests", actions: ["batch.switch.decide"], reach: "department", needs: ["courses.view"] },
  { key: "programs.manage", section: "products", label: "Manage programs", actions: ["program.manage"], reach: "institute", needs: ["courses.view"] },
  { key: "teach", section: "products", label: "Teach batches", actions: ["batch.teach"], reach: "batch", needs: ["courses.view"] },
  { key: "content.progress", section: "products", label: "See learning progress", actions: ["content.view_progress"], reach: "batch", readOnly: true },
  { key: "content.manage", section: "products", label: "Build lessons and content", actions: ["content.manage"], reach: "batch", needs: ["content.progress"] },
  { key: "live.manage", section: "products", label: "Run live classes", actions: ["live.manage"], reach: "batch" },
  { key: "attendance.view", section: "products", label: "See attendance", actions: ["attendance.view"], reach: "batch", readOnly: true },
  { key: "attendance.mark", section: "products", label: "Mark attendance", actions: ["attendance.mark"], reach: "batch", needs: ["attendance.view"] },
  { key: "tests.results", section: "products", label: "See test results", actions: ["assess.view_results"], reach: "batch", readOnly: true },
  { key: "tests.manage", section: "products", label: "Create tests", actions: ["assess.manage"], reach: "batch", needs: ["tests.results"] },
  { key: "tests.grade", section: "products", label: "Grade tests", actions: ["assess.grade"], reach: "batch", needs: ["tests.results"] },
  { key: "assignments.view", section: "products", label: "See assignments", actions: ["assignment.view"], reach: "batch", readOnly: true },
  { key: "assignments.manage", section: "products", label: "Set assignments", actions: ["assignment.manage"], reach: "batch", needs: ["assignments.view"] },
  { key: "assignments.grade", section: "products", label: "Grade assignments", actions: ["assignment.grade"], reach: "batch", needs: ["assignments.view"] },
  { key: "polls.manage", section: "products", label: "Run polls", actions: ["poll.manage"], reach: "batch" },
  { key: "certificates.view", section: "products", label: "See certificates", actions: ["cert.view"], reach: "batch", readOnly: true },
  { key: "certificates.issue", section: "products", label: "Issue certificates", actions: ["cert.issue"], reach: "department", needs: ["certificates.view"] },
  { key: "certificates.manage", section: "products", label: "Set up certificate templates", actions: ["cert.manage"], reach: "department", needs: ["certificates.view"] },

  { key: "people.view", section: "users", label: "View people", actions: ["user.view"], reach: "batch", readOnly: true },
  { key: "people.roles", section: "users", label: "Add people and change their roles", actions: ["user.manage_roles"], reach: "department", locked: true, hod: "Add teachers in their department" },
  { key: "people.import", section: "users", label: "Import people in bulk", actions: ["user.import"], reach: "institute", needs: ["people.view"] },
  { key: "people.graduate", section: "users", label: "Graduate students", actions: ["user.graduate"], reach: "institute", needs: ["people.view"] },
  { key: "people.parents", section: "users", label: "Link parents to students", actions: ["user.link_parent"], reach: "institute", needs: ["people.view"] },
  { key: "departments.manage", section: "users", label: "Manage departments", actions: ["department.manage"], reach: "institute" },

  { key: "leaderboard.view", section: "leaderboards", label: "View leaderboards", actions: ["leaderboard.view"], reach: "batch", readOnly: true },
  { key: "leaderboard.manage", section: "leaderboards", label: "Change XP rules, badges and challenges", actions: ["leaderboard.manage"], reach: "department", needs: ["leaderboard.view"] },

  { key: "finance.view", section: "finance", label: "View sales and reports", actions: ["finance.view"], reach: "institute", readOnly: true },
  { key: "finance.manage", section: "finance", label: "Manage invoices and payments", actions: ["finance.manage"], reach: "institute", needs: ["finance.view"] },
  { key: "finance.refund", section: "finance", label: "Give refunds", actions: ["finance.refund"], reach: "institute", needs: ["finance.view"] },

  { key: "website.manage", section: "website", label: "Edit the public website", actions: ["website.manage"], reach: "institute" },

  { key: "marketing.manage", section: "marketing", label: "Run marketing", actions: ["marketing.manage"], reach: "department" },

  { key: "community.view", section: "community", label: "View the community", actions: ["community.view"], reach: "batch", readOnly: true },
  { key: "community.manage", section: "community", label: "Manage the community", actions: ["community.manage"], reach: "batch", needs: ["community.view"] },

  { key: "insights.view", section: "insights", label: "View insights", actions: ["insights.view"], reach: "department", readOnly: true },
  { key: "activity.view", section: "insights", label: "View the activity log", actions: ["audit.view"], reach: "institute", readOnly: true },

  { key: "settings.manage", section: "settings", label: "Change institute settings", actions: ["settings.manage"], reach: "institute" },
  { key: "institute.edit", section: "settings", label: "Edit institute details", actions: ["university.update"], reach: "institute" },
];

export const PLATFORM_SECTIONS = [
  { key: "institutes", label: "Institutes" },
  { key: "support", label: "Support" },
  { key: "content", label: "Content" },
  { key: "partners", label: "Partners" },
  { key: "billing", label: "Billing" },
  { key: "analytics", label: "Analytics" },
] as const;

export const PLATFORM_ABILITIES: readonly Ability[] = [
  { key: "platform.institutes", section: "institutes", label: "Manage institutes", actions: ["platform.manage_universities"], reach: "institute" },
  { key: "platform.licences", section: "institutes", label: "Manage licences", actions: ["platform.licences"], reach: "institute" },
  { key: "platform.support", section: "support", label: "Enter institutes through support mode", actions: ["platform.support_mode"], reach: "institute" },
  { key: "platform.content", section: "content", label: "Review course content", actions: ["platform.content_review"], reach: "institute" },
  { key: "platform.partners", section: "partners", label: "Manage sponsors and partners", actions: ["platform.partners"], reach: "institute" },
  { key: "platform.finance", section: "billing", label: "Manage Zinny invoices", actions: ["platform.finance"], reach: "institute" },
  { key: "platform.analytics", section: "analytics", label: "View analytics", actions: ["platform.view_analytics"], reach: "institute", readOnly: true },
];

/** How far each role that can be edited reaches. Institute Admin and Super Admin aren't here. */
const ROLE_REACH: Partial<Record<RoleName, Reach>> = {
  board_owner: "institute",
  accounts_fees: "institute",
  custom_institute: "institute",
  hod: "department",
  custom_department: "department",
  permanent_faculty: "batch",
  visiting_faculty: "batch",
};

const PLATFORM_EDITABLE: ReadonlySet<RoleName> = new Set<RoleName>(["account_manager", "content_qa", "finance_admin", "partnerships", "support_agent", "custom_platform"]);

export const CUSTOM_ROLES: ReadonlySet<RoleName> = new Set<RoleName>(["custom_institute", "custom_department", "custom_platform"]);

export const isPlatformKind = (role: RoleName) => PLATFORM_EDITABLE.has(role);
export const isEditableRole = (role: RoleName) => role in ROLE_REACH || PLATFORM_EDITABLE.has(role);
export const reachOf = (role: RoleName): Reach => ROLE_REACH[role] ?? "institute";

const REACH_ORDER: Record<Reach, number> = { institute: 0, department: 1, batch: 2 };

/** Does an ability work for a role of this reach? */
export const worksAt = (ability: Ability, reach: Reach) => REACH_ORDER[ability.reach] >= REACH_ORDER[reach];

const catalogue = (role: RoleName) => (isPlatformKind(role) ? PLATFORM_ABILITIES : INSTITUTE_ABILITIES);

/** What can be switched on or off for this role. */
export function abilitiesFor(role: RoleName): readonly Ability[] {
  return catalogue(role).filter((a) => !a.locked && worksAt(a, reachOf(role)));
}

/** The chosen abilities as actions, with whatever they depend on added. Unknown keys are dropped. */
export function actionsForAbilities(role: RoleName, keys: readonly string[]): Action[] {
  const offered = new Map(abilitiesFor(role).map((a) => [a.key, a]));
  const chosen = new Set<string>();
  const add = (key: string) => {
    const a = offered.get(key);
    if (!a || chosen.has(key)) return;
    chosen.add(key);
    a.needs?.forEach(add);
  };
  keys.forEach(add);
  return [...new Set([...chosen].flatMap((k) => offered.get(k)!.actions))];
}

/**
 * What a role really grants, given what was saved for it. Everything outside the editor
 * (the basics every role has, and locked actions) comes from the role itself; saved actions
 * count only if the editor could offer them. Undefined means nothing was changed: use
 * ROLE_GRANTS. A custom role with nothing saved gets only its basics, never more.
 */
export function effectiveGrants(role: RoleName, stored: readonly string[] | null | undefined): readonly Action[] | undefined {
  if (!isEditableRole(role)) return undefined;
  if (!stored) return CUSTOM_ROLES.has(role) ? ROLE_GRANTS[role] : undefined;
  const switchable = new Set(catalogue(role).filter((a) => !a.locked).flatMap((a) => a.actions));
  const allowed = new Set<string>(abilitiesFor(role).flatMap((a) => a.actions));
  const kept = ROLE_GRANTS[role].filter((a) => !switchable.has(a));
  return [...new Set([...kept, ...(stored.filter((a) => allowed.has(a)) as Action[])])];
}

/** The admin panel sections a changed or custom role opens, worked out from what it grants. */
export function sectionAccess(grants: readonly Action[], scope: ScopeType): Partial<Record<SectionKey, Access>> {
  const has = new Set(grants);
  const out: Partial<Record<SectionKey, Access>> = {};
  const scoped = (section: string): Access => (scope === "department" ? "dept" : section === "users" ? "students" : "batches");
  for (const a of INSTITUTE_ABILITIES) {
    if (!a.actions.every((x) => has.has(x))) continue;
    const section = a.section as SectionKey;
    if (scope !== "university") out[section] = scoped(a.section);
    else if (!a.readOnly) out[section] = "full";
    else out[section] ??= "view";
  }
  if (Object.keys(out).length > 0) out.dashboard = scope === "university" ? "view" : scoped("dashboard");
  return out;
}
