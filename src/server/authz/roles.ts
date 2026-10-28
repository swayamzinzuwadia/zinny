/**
 * Who can do what — the PRD's page 2 and page 3, as code.
 *
 * A role grants actions. WHERE the action is allowed comes from the scope of the
 * assignment (university, department or batch), never from the role itself.
 * New roles are added by adding an entry here; existing roles don't change.
 */
import type { RoleName } from "@/db/schema";

export const ACTIONS = [
  // University space
  "university.view",
  "university.update",
  "department.view",
  "department.manage",
  "program.manage",
  // People
  "user.view",
  "user.create",
  "user.import",
  "user.manage_roles",
  "user.graduate",
  "user.link_parent",
  // Products
  "course.view",
  "course.create",
  "course.update",
  "course.delete",
  "batch.view",
  "batch.create",
  "batch.update",
  "batch.delete",
  "batch.assign_faculty",
  "batch.switch.decide",
  "batch.teach", // content, tests, grades, attendance for a batch
  "enrolment.view",
  // Other sections
  "leaderboard.view",
  "leaderboard.manage",
  "finance.view",
  "finance.manage",
  "website.manage",
  "marketing.manage",
  "community.view",
  "community.manage",
  "insights.view",
  "settings.manage",
  "audit.view",
  // Learner app — only ever on yourself
  "catalog.browse",
  "self.enrol",
  "self.switch_batch",
  "self.view_learning",
  "parent.view_child",
  // Zinny team
  "platform.manage_universities",
  "platform.support_mode",
] as const;

export type Action = (typeof ACTIONS)[number];

/** Actions that only ever apply to the actor's own records. */
export const SELF_ACTIONS: ReadonlySet<Action> = new Set(["self.enrol", "self.switch_batch", "self.view_learning"]);

const ADMIN_ALL: Action[] = ACTIONS.filter(
  (a) => !a.startsWith("self.") && !a.startsWith("platform.") && a !== "parent.view_child",
);

const FACULTY_CORE: Action[] = ["course.view", "batch.view", "batch.teach", "enrolment.view", "user.view"];

export const ROLE_GRANTS: Record<RoleName, readonly Action[]> = {
  // ── Zinny team. They never act inside a university directly; support mode does that.
  super_admin: ["platform.manage_universities", "platform.support_mode"],
  support_agent: ["platform.support_mode"],
  account_manager: ["platform.manage_universities"],
  content_qa: [],
  finance_admin: [],
  partnerships: [],

  // ── Administration
  institute_admin: ADMIN_ALL,
  board_owner: [
    "university.view",
    "department.view",
    "user.view",
    "course.view",
    "batch.view",
    "enrolment.view",
    "finance.view",
    "insights.view",
  ],
  accounts_fees: ["university.view", "finance.view", "finance.manage"],

  // ── Teaching
  hod: [
    "university.view",
    "department.view",
    "user.view",
    "user.manage_roles", // teaching roles inside their own department only (enforced in the service)
    "course.view",
    "course.create",
    "course.update",
    "course.delete",
    "batch.view",
    "batch.create",
    "batch.update",
    "batch.delete",
    "batch.assign_faculty",
    "batch.switch.decide",
    "batch.teach",
    "enrolment.view",
    "leaderboard.view",
    "leaderboard.manage",
    "marketing.manage",
    "community.view",
    "community.manage",
    "insights.view",
  ],
  permanent_faculty: [...FACULTY_CORE, "leaderboard.view", "community.view", "community.manage"],
  visiting_faculty: FACULTY_CORE,

  // ── Students
  student: ["catalog.browse", "self.enrol", "self.switch_batch", "self.view_learning"],
  alumni: ["catalog.browse", "self.enrol", "self.view_learning"],
  parent: ["parent.view_child"],

  // ── Marketplace (phase 3)
  independent_instructor: [],
  sponsor: [],
  corporate_partner: [],
  individual_learner: ["catalog.browse", "self.enrol", "self.view_learning"],
};

export const PLATFORM_ROLES: readonly RoleName[] = [
  "super_admin",
  "account_manager",
  "content_qa",
  "finance_admin",
  "partnerships",
  "support_agent",
];

export const ROLE_LABELS: Record<RoleName, string> = {
  super_admin: "Super Admin",
  account_manager: "Account Manager",
  content_qa: "Content QA",
  finance_admin: "Finance Admin",
  partnerships: "Partnerships",
  support_agent: "Support Agent",
  institute_admin: "Institute Admin",
  board_owner: "Board / Owner",
  accounts_fees: "Accounts & Fees",
  hod: "Head of Department",
  permanent_faculty: "Permanent Faculty",
  visiting_faculty: "Visiting Faculty",
  student: "Current Student",
  alumni: "Alumni",
  parent: "Parent / Guardian",
  independent_instructor: "Independent Instructor",
  sponsor: "Sponsor / Advertiser",
  corporate_partner: "Corporate Partner",
  individual_learner: "Individual Learner",
};

/** Groups for the Users section (PRD page 7). */
export const USER_GROUPS = {
  administration: ["institute_admin", "board_owner", "accounts_fees"],
  teaching: ["hod", "permanent_faculty", "visiting_faculty"],
  students: ["student", "alumni", "parent"],
} as const satisfies Record<string, readonly RoleName[]>;

/** Which scopes each university role may be given. */
export const ALLOWED_SCOPES: Partial<Record<RoleName, readonly ("university" | "department" | "batch")[]>> = {
  institute_admin: ["university"],
  board_owner: ["university"],
  accounts_fees: ["university"],
  hod: ["department"],
  permanent_faculty: ["department", "batch"],
  visiting_faculty: ["department", "batch"],
  student: ["university"],
  alumni: ["university"],
  parent: ["university"],
};

/**
 * Some roles only grant actions from certain scopes. A faculty member's
 * department-level role is membership (they appear under Teaching and can be put
 * on a batch); what they can actually do comes only from their batch assignments.
 */
export const GRANTS_ONLY_AT: Partial<Record<RoleName, readonly ("university" | "department" | "batch")[]>> = {
  permanent_faculty: ["batch"],
  visiting_faculty: ["batch"],
};

/** Roles that open the admin panel. Students, alumni and parents use the learner app. */
export const ADMIN_PANEL_ROLES: ReadonlySet<RoleName> = new Set([
  "institute_admin",
  "board_owner",
  "accounts_fees",
  "hod",
  "permanent_faculty",
  "visiting_faculty",
]);
