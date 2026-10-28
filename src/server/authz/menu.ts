/**
 * Admin panel menu (PRD page 4) and who sees which section (PRD page 3).
 * Hiding a section is only for convenience — every action is still checked
 * on the server by the engine.
 */
import type { RoleName } from "@/db/schema";
import type { Actor } from "./engine";
import { isActive } from "./engine";

export type SectionKey =
  | "dashboard"
  | "products"
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
      { label: "Categories & utilities", href: "/products/categories" },
      { label: "More products", href: "/products/more" },
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
      { label: "Departments", href: "/users/departments" },
      { label: "Bulk import", href: "/users/import" },
      { label: "Roles & permissions", href: "/users/roles" },
    ],
  },
  {
    key: "leaderboards",
    label: "User Leaderboards",
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
  { key: "marketing", label: "Marketing", hint: "Unchanged", items: [{ label: "Marketing", href: "/marketing" }] },
  { key: "community", label: "Community", hint: "Unchanged", items: [{ label: "Community", href: "/community" }] },
  { key: "insights", label: "Insights", hint: "Unchanged", items: [{ label: "Insights", href: "/insights" }] },
  { key: "settings", label: "Settings", hint: "Unchanged", items: [{ label: "Settings", href: "/settings" }] },
];

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
    for (const [section, access] of Object.entries(SECTION_ACCESS[a.role] ?? {}) as [SectionKey, Access][]) {
      const cur = best.get(section);
      if (!cur || RANK[access] > RANK[cur]) best.set(section, access);
    }
  }
  return MENU.filter((s) => best.has(s.key))
    .map((s) => ({ ...s, access: best.get(s.key)! }))
    // Scoped viewers only get the people lists they can actually use.
    .map((s) => {
      if (s.key !== "users" || s.access === "full") return s;
      const keep =
        s.access === "students"
          ? ["/users/students"]
          : s.access === "dept"
            ? ["/users/teaching", "/users/students", "/users/departments"]
            : ["/users/administration", "/users/teaching", "/users/students", "/users/departments"];
      return { ...s, items: s.items.filter((i) => keep.includes(i.href)) };
    });
}
