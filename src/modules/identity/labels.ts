import type { RoleName } from "@/db/schema";

/** Role names as people read them in emails and on the invitations page. */
export const ROLE_TITLE = {
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
  student: "Student",
  alumni: "Alumni",
  parent: "Parent / Guardian",
  independent_instructor: "Independent Instructor",
  sponsor: "Sponsor / Advertiser",
  corporate_partner: "Corporate Partner",
  individual_learner: "Individual Learner",
} as const satisfies Record<RoleName, string>;

export const roleTitle = (r: RoleName) => ROLE_TITLE[r];

/** Roles that open the admin panel; everyone else lands in the learner app. */
export const ADMIN_PANEL: ReadonlySet<RoleName> = new Set<RoleName>([
  "institute_admin",
  "board_owner",
  "accounts_fees",
  "hod",
  "permanent_faculty",
  "visiting_faculty",
]);

/** Teaching roles a HOD may manage inside their own department (same rule as core's role service). */
export const FACULTY: ReadonlySet<RoleName> = new Set<RoleName>(["permanent_faculty", "visiting_faculty"]);

/** Where someone lands after joining: the admin panel or the learner app. */
export function landingFor(slug: string, role: RoleName): string {
  return `/${slug}/${ADMIN_PANEL.has(role) ? "admin" : "learn"}`;
}
