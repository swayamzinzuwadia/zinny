/**
 * The access rules in plain words, for the Roles & permissions pages. What each role can do
 * is worked out from the same tables and saved edits the server enforces, so a page can't
 * drift from what actually happens. Only the wording lives here.
 */
import type { RoleName } from "@/db/schema";
import {
  CUSTOM_ROLES,
  INSTITUTE_ABILITIES,
  PLATFORM_ABILITIES,
  PLATFORM_SECTIONS,
  abilitiesFor,
  effectiveGrants,
  isEditableRole,
  reachOf,
  sectionAccess,
  worksAt,
  type Ability,
  type Reach,
} from "./abilities";
import { MENU, SECTION_ACCESS, type Access } from "./menu";
import { ROLE_GRANTS, ROLE_LABELS, type Action } from "./roles";

const ABOUT: Partial<Record<RoleName, { purpose: string; reach?: string }>> = {
  institute_admin: { purpose: "Runs the whole institute and can change anything in the admin panel." },
  board_owner: { purpose: "Sees how the institute is doing. Can look at everything it covers, but change nothing." },
  accounts_fees: { purpose: "Looks after fees, invoices and refunds, and nothing outside money." },
  hod: { purpose: "Runs one department: its courses, batches, teachers and results." },
  permanent_faculty: { purpose: "Teaches the batches they are assigned to, and helps run the community." },
  visiting_faculty: { purpose: "Teaches the batches they are assigned to, and nothing beyond them." },
  super_admin: { purpose: "Runs Zinny, including the team itself and who can do what." },
  account_manager: { purpose: "Looks after institutes, their licences and analytics." },
  support_agent: { purpose: "Helps institutes from inside through support mode." },
  content_qa: { purpose: "Reviews new courses and flags problems." },
  finance_admin: { purpose: "Handles Zinny's own invoices and licences." },
  partnerships: { purpose: "Manages sponsors and corporate partners." },
};

const REACH_LABEL: Record<Reach, string> = { institute: "Whole institute", department: "One department", batch: "Assigned batches" };
const SCOPE = { institute: "university", department: "department", batch: "batch" } as const;

export type RoleRow = { id: string; kind: RoleName; name: string | null; description: string; actions: readonly string[] };

export type SectionSummary = {
  key: string;
  label: string;
  access: Access | null;
  abilities: { label: string; can: boolean }[];
};

export type RoleSummary = {
  /** The built-in role's name, or a custom role's id. */
  key: string;
  kind: RoleName;
  label: string;
  group: string;
  /** The people list this role appears in. */
  people: "administration" | "teaching" | "team";
  purpose: string;
  reach: string;
  reachKey: Reach;
  readOnly: boolean;
  custom: boolean;
  editable: boolean;
  /** A built-in role this institute has changed from Zinny's default. */
  edited: boolean;
  holders: number;
  /** The abilities switched on, for the editor. */
  on: string[];
  sections: SectionSummary[];
};

export type AbilityOption = Pick<Ability, "key" | "section" | "label" | "reach" | "needs">;

const hasAll = (grants: ReadonlySet<Action>, a: Ability) => a.actions.every((x) => grants.has(x));

function summarise(
  kind: RoleName,
  base: Pick<RoleSummary, "key" | "label" | "group" | "people" | "purpose"> & { reach?: string; edited?: boolean; holders?: number },
  stored: readonly string[] | null,
): RoleSummary {
  const platform = base.people === "team";
  const custom = CUSTOM_ROLES.has(kind);
  const reachKey = reachOf(kind);
  const grants = effectiveGrants(kind, stored) ?? ROLE_GRANTS[kind];
  const has = new Set<Action>(grants);
  const list = platform ? PLATFORM_ABILITIES : INSTITUTE_ABILITIES;
  const derived = custom || base.edited ? sectionAccess(grants, SCOPE[reachKey]) : null;
  // Marketplace has no abilities of its own: it opens with "Create and edit courses" (menuFor), so it isn't listed here.
  const titles: { key: string; label: string }[] = platform ? [...PLATFORM_SECTIONS] : MENU.filter((m) => m.key !== "dashboard" && m.key !== "marketplace");

  const sections = titles.map((t): SectionSummary => {
    const abilities = list.filter((a) => a.section === t.key && (platform || kind === "institute_admin" || worksAt(a, reachKey) || (a.locked && hasAll(has, a))));
    const anyOn = abilities.some((a) => hasAll(has, a));
    const access = platform ? (anyOn ? "full" : null) : ((derived ? derived[t.key as keyof typeof derived] : SECTION_ACCESS[kind]?.[t.key as keyof (typeof SECTION_ACCESS)[RoleName]]) ?? null);
    return {
      key: t.key,
      label: t.label,
      access,
      abilities: access ? abilities.map((a) => ({ label: (kind === "hod" && a.hod) || a.label, can: hasAll(has, a) })) : [],
    };
  });

  const writes = list.some((a) => !a.readOnly && hasAll(has, a));
  return {
    key: base.key,
    kind,
    label: base.label,
    group: base.group,
    people: base.people,
    purpose: base.purpose,
    reach: base.reach ?? REACH_LABEL[reachKey],
    reachKey,
    readOnly: !writes,
    custom,
    editable: isEditableRole(kind),
    edited: !!base.edited,
    holders: base.holders ?? 0,
    on: abilitiesFor(kind)
      .filter((a) => hasAll(has, a))
      .map((a) => a.key),
    sections,
  };
}

function build(
  rows: readonly RoleRow[],
  holders: ReadonlyMap<string, number>,
  builtIn: { group: string; people: RoleSummary["people"]; roles: readonly RoleName[]; reach?: string }[],
  customRole: (r: RoleRow) => Pick<RoleSummary, "people"> & { reach?: string },
): RoleSummary[] {
  const edits = new Map(rows.filter((r) => r.name === null).map((r) => [r.kind, r]));
  const fixed = builtIn.flatMap((g) =>
    g.roles.map((role) => {
      const edit = edits.get(role);
      const key = role as string;
      return summarise(
        role,
        { key, label: ROLE_LABELS[role], group: g.group, people: g.people, purpose: ABOUT[role]?.purpose ?? "", reach: g.reach, edited: !!edit, holders: holders.get(key) },
        edit?.actions ?? null,
      );
    }),
  );
  const made = rows
    .filter((r) => r.name !== null)
    .map((r) => summarise(r.kind, { key: r.id, label: r.name!, group: "Custom roles", purpose: r.description || "A custom role.", holders: holders.get(r.id), ...customRole(r) }, r.actions));
  return [...fixed, ...made];
}

/** The institute's roles, as saved. Every role that opens the admin panel, built-in roles first. */
export function roleSummaries(rows: readonly RoleRow[] = [], holders: ReadonlyMap<string, number> = new Map()): RoleSummary[] {
  return build(
    rows,
    holders,
    [
      { group: "Administration", people: "administration", roles: ["institute_admin", "board_owner", "accounts_fees"] },
      { group: "Teaching", people: "teaching", roles: ["hod", "permanent_faculty", "visiting_faculty"] },
    ],
    (r) => ({ people: r.kind === "custom_department" ? "teaching" : "administration" }),
  );
}

/** The Zinny team's roles. */
export function platformRoleSummaries(rows: readonly RoleRow[] = [], holders: ReadonlyMap<string, number> = new Map()): RoleSummary[] {
  return build(
    rows,
    holders,
    [{ group: "Zinny team", people: "team", reach: "All of Zinny", roles: ["super_admin", "account_manager", "support_agent", "content_qa", "finance_admin", "partnerships"] }],
    () => ({ people: "team", reach: "All of Zinny" }),
  );
}

/** Everything the editor can offer. It narrows these down by the role's reach. */
export function abilityOptions(platform: boolean): AbilityOption[] {
  return (platform ? PLATFORM_ABILITIES : INSTITUTE_ABILITIES)
    .filter((a) => !a.locked)
    .map(({ key, section, label, reach, needs }) => ({ key, section, label, reach, needs }));
}
