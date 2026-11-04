/**
 * Admin panel menu (PRD page 4) and who sees which section (PRD page 3).
 * Hiding a section is only for convenience — every action is still checked
 * on the server by the engine.
 */
import type { RoleName } from "@/db/schema";
import { sectionAccess } from "./abilities";
import type { Actor } from "./engine";
import { can, isActive, reach } from "./engine";
import { GRANTS_ONLY_AT } from "./roles";

export type SectionKey =
  | "dashboard"
  | "products"
  | "marketplace"
  | "users"
  | "leaderboards"
  | "finance"
  | "website"
  | "marketing"
  | "community"
  | "insights"
  | "settings";

/** full = create/edit/delete, view = read only, dept / batches / students = limited to their scope. */
export type Access = "full" | "view" | "dept" | "batches" | "students";

export const ACCESS_LABEL: Record<Access, string> = {
  full: "Full",
  view: "View",
  dept: "Own dept",
  batches: "Own batches",
  students: "Own students",
};

export type MenuSection = {
  key: SectionKey;
  label: string;
  hint: string;
  items: { label: string; href: string }[];
};

export const MENU: MenuSection[] = [
  { key: "dashboard", label: "Dashboard", hint: "Unchanged", items: [{ label: "Overview", href: "" }] },
  {
    key: "products",
    label: "Products",
    hint: "Everything you sell and teach",
    items: [
      { label: "Courses", href: "/products/courses" },
      { label: "Tests", href: "/products/tests" },
      { label: "Assignments", href: "/products/assignments" },
      { label: "Learning progress", href: "/products/content" },
      { label: "Certificates", href: "/products/certificates" },
    ],
  },
  {
    key: "marketplace",
    label: "Marketplace",
    hint: "Sell recordings to anyone on Zinny",
    items: [
      { label: "Listings", href: "/marketplace" },
      { label: "Combos", href: "/marketplace/combos" },
      { label: "Discount codes", href: "/marketplace/codes" },
    ],
  },
  {
    key: "users",
    label: "Users",
    hint: "Everyone in the institute",
    items: [
      { label: "Administration", href: "/users/administration" },
      { label: "Teaching", href: "/users/teaching" },
      { label: "Students", href: "/users/students" },
      { label: "Join requests", href: "/users/requests" },
      { label: "Departments", href: "/users/departments" },
      { label: "Invitations", href: "/users/invites" },
      { label: "Bulk import", href: "/users/import" },
      { label: "Roles & permissions", href: "/users/roles" },
    ],
  },
  {
    key: "leaderboards",
    label: "Leaderboard",
    hint: "The XP system",
    items: [
      { label: "XP rules", href: "/leaderboards/xp-rules" },
      { label: "Badges", href: "/leaderboards/badges" },
      { label: "Challenges", href: "/leaderboards/challenges" },
      { label: "Leaderboard", href: "/leaderboards" },
    ],
  },
  {
    key: "finance",
    label: "Finance",
    hint: "All money in one place",
    items: [
      { label: "Sales", href: "/finance/sales" },
      { label: "Reports", href: "/finance/reports" },
    ],
  },
  {
    key: "website",
    label: "Website",
    hint: "Your public site",
    items: [
      { label: "Manage profile", href: "/website/profile" },
      { label: "Website sections", href: "/website/sections" },
    ],
  },
  // Marketing and Community aren't built yet: they keep their keys (roles still carry the access) but have no menu entry.
  { key: "insights", label: "Insights", hint: "Unchanged", items: [{ label: "Insights", href: "/insights" }] },
  {
    key: "settings",
    label: "Settings",
    hint: "Where each institute setting lives",
    items: [
      { label: "All settings", href: "/settings" },
      { label: "Notifications", href: "/settings/notifications" },
    ],
  },
];

/** Reports live under Finance, but HODs have no Finance section (PRD page 3): they reach Reports from Insights. */
const REPORTS_ITEM = { label: "Reports", href: "/finance/reports" };

/** PRD page 3, row by row. Missing = no access. */
export const SECTION_ACCESS: Partial<Record<RoleName, Partial<Record<SectionKey, Access>>>> = {
  institute_admin: {
    dashboard: "full",
    products: "full",
    users: "full",
    leaderboards: "full",
    finance: "full",
    website: "full",
    marketing: "full",
    community: "full",
    insights: "full",
    settings: "full",
  },
  board_owner: { dashboard: "view", products: "view", users: "view", finance: "view", insights: "view" },
  accounts_fees: { dashboard: "view", finance: "full" },
  hod: {
    dashboard: "dept",
    products: "dept",
    users: "dept",
    leaderboards: "dept",
    marketing: "dept",
    community: "dept",
    insights: "dept",
  },
  permanent_faculty: { dashboard: "batches", products: "batches", users: "students", leaderboards: "view", community: "full" },
  visiting_faculty: { dashboard: "batches", products: "batches", users: "students" },
};

const RANK: Record<Access, number> = { full: 5, dept: 4, batches: 3, students: 3, view: 2 };

/** Sections this actor sees, with the strongest access any of their roles gives. */
export function menuFor(actor: Actor, universityId: string, now = new Date()) {
  const best = new Map<SectionKey, Access>();
  for (const a of actor.assignments) {
    if (!isActive(a, now) || a.universityId !== universityId) continue;
    // A changed or custom role opens what it grants. Faculty work in batches, whatever their row says.
    const sections = a.grants ? sectionAccess(a.grants, GRANTS_ONLY_AT[a.role] ? "batch" : a.scopeType) : (SECTION_ACCESS[a.role] ?? {});
    for (const [section, access] of Object.entries(sections) as [SectionKey, Access][]) {
      const cur = best.get(section);
      if (!cur || RANK[access] > RANK[cur]) best.set(section, access);
    }
  }
  // Selling on the marketplace is editing courses, so whoever edits courses (all of them, or their department's) gets the section.
  const products = best.get("products");
  if (products === "full" || products === "dept") best.set("marketplace", products);
  const reaches = (action: Parameters<typeof reach>[1]) => {
    const r = reach(actor, action, universityId, now);
    return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
  };
  return (
    MENU.filter((s) => best.has(s.key))
      .map((s) => ({ ...s, access: best.get(s.key)! }))
      .map((s) => (s.key === "insights" && !best.has("finance") ? { ...s, items: [...s.items, REPORTS_ITEM] } : s))
      // Faculty see certificates on each course's Certificates tab; the Certificates page is for people who issue them or set up templates.
      .map((s) =>
        s.key === "products" && s.access === "batches" && !reaches("cert.issue") && !reaches("cert.manage")
          ? { ...s, items: s.items.filter((i) => i.href !== "/products/certificates") }
          : s,
      )
      // Scoped viewers only get the people lists they can actually use. Faculty find their students on their batch pages.
      .map((s) => {
        if (s.key !== "users") return s;
        if (s.access === "full") return can(actor, "role.manage", { universityId }, now) ? s : { ...s, items: s.items.filter((i) => i.href !== "/users/roles") };
        const keep =
          s.access === "students"
            ? []
            : s.access === "dept"
              ? ["/users/teaching", "/users/students", "/users/requests", "/users/departments", "/users/invites"]
              : ["/users/administration", "/users/teaching", "/users/students", "/users/departments"];
        return { ...s, items: s.items.filter((i) => keep.includes(i.href)) };
      })
      .filter((s) => s.items.length > 0)
  );
}
