/**
 * The access rules in plain words, for the Roles & permissions page. Everything shown there
 * comes from ROLE_GRANTS and SECTION_ACCESS, the tables the server enforces, so the page
 * can't drift from what actually happens. Only the wording lives here.
 */
import type { RoleName } from "@/db/schema";
import { MENU, SECTION_ACCESS, type Access, type SectionKey } from "./menu";
import { ROLE_GRANTS, ROLE_LABELS, USER_GROUPS, type Action } from "./roles";

type Ability = { label: string; action: Action; readOnly?: boolean; hod?: string };

const ABILITIES: Partial<Record<SectionKey, Ability[]>> = {
  products: [
    { label: "View courses and batches", action: "course.view", readOnly: true },
    { label: "Create and edit courses", action: "course.update" },
    { label: "Delete courses", action: "course.delete" },
    { label: "Create and edit batches", action: "batch.update" },
    { label: "Assign faculty to batches", action: "batch.assign_faculty" },
    { label: "Decide batch switch requests", action: "batch.switch.decide" },
    { label: "Build lessons and content", action: "content.manage" },
    { label: "Run live classes", action: "live.manage" },
    { label: "Mark attendance", action: "attendance.mark" },
    { label: "Create tests", action: "assess.manage" },
    { label: "Grade tests", action: "assess.grade" },
    { label: "Set assignments", action: "assignment.manage" },
    { label: "Grade assignments", action: "assignment.grade" },
    { label: "Issue certificates", action: "cert.issue" },
  ],
  users: [
    { label: "View people", action: "user.view", readOnly: true },
    { label: "Add people and change their roles", action: "user.manage_roles", hod: "Add teachers in their department" },
    { label: "Import people in bulk", action: "user.import" },
    { label: "Graduate students", action: "user.graduate" },
    { label: "Link parents to students", action: "user.link_parent" },
  ],
  leaderboards: [
    { label: "View leaderboards", action: "leaderboard.view", readOnly: true },
    { label: "Change XP rules, badges and challenges", action: "leaderboard.manage" },
  ],
  finance: [
    { label: "View sales and reports", action: "finance.view", readOnly: true },
    { label: "Manage invoices and payments", action: "finance.manage" },
    { label: "Give refunds", action: "finance.refund" },
  ],
  website: [{ label: "Edit the public website", action: "website.manage" }],
  marketing: [{ label: "Run marketing", action: "marketing.manage" }],
  community: [
    { label: "View the community", action: "community.view", readOnly: true },
    { label: "Manage the community", action: "community.manage" },
  ],
  insights: [
    { label: "View insights", action: "insights.view", readOnly: true },
    { label: "View the activity log", action: "audit.view", readOnly: true },
  ],
  settings: [
    { label: "Change institute settings", action: "settings.manage" },
    { label: "Edit institute details", action: "university.update" },
  ],
};

const ABOUT: Partial<Record<RoleName, { purpose: string; reach: string }>> = {
  institute_admin: { purpose: "Runs the whole institute and can change anything in the admin panel.", reach: "Whole institute" },
  board_owner: { purpose: "Sees how the institute is doing. Can look at everything it covers, but change nothing.", reach: "Whole institute" },
  accounts_fees: { purpose: "Looks after fees, invoices and refunds, and nothing outside money.", reach: "Whole institute" },
  hod: { purpose: "Runs one department: its courses, batches, teachers and results.", reach: "One department" },
  permanent_faculty: { purpose: "Teaches the batches they are assigned to, and helps run the community.", reach: "Assigned batches" },
  visiting_faculty: { purpose: "Teaches the batches they are assigned to, and nothing beyond them.", reach: "Assigned batches" },
};

export type SectionSummary = {
  key: SectionKey;
  label: string;
  access: Access | null;
  abilities: { label: string; can: boolean }[];
};

export type RoleSummary = {
  key: RoleName;
  label: string;
  group: "Administration" | "Teaching";
  purpose: string;
  reach: string;
  readOnly: boolean;
  sections: SectionSummary[];
};

function summarise(key: RoleName, group: RoleSummary["group"]): RoleSummary {
  const grants = new Set<Action>(ROLE_GRANTS[key]);
  const sections = MENU.filter((m) => m.key !== "dashboard").map((m): SectionSummary => {
    const access = SECTION_ACCESS[key]?.[m.key] ?? null;
    const abilities = (ABILITIES[m.key] ?? []).map((a) => ({ label: (key === "hod" && a.hod) || a.label, can: grants.has(a.action) }));
    return { key: m.key, label: m.label, access, abilities: access ? abilities : [] };
  });
  const writes = Object.values(ABILITIES)
    .flat()
    .some((a) => !a.readOnly && grants.has(a.action));
  return { key, label: ROLE_LABELS[key], group, purpose: ABOUT[key]?.purpose ?? "", reach: ABOUT[key]?.reach ?? "", readOnly: !writes, sections };
}

/** Every role that opens the admin panel, in the order the Users section lists them. */
export function roleSummaries(): RoleSummary[] {
  return [
    ...USER_GROUPS.administration.map((r) => summarise(r, "Administration")),
    ...USER_GROUPS.teaching.map((r) => summarise(r, "Teaching")),
  ];
}
