/**
 * Admin panel menu (PRD page 4) and who sees which section (PRD page 3).
 * Hiding a section is only for convenience — every action is still checked
 * on the server by the engine.
 *
 * Two layers live here:
 *  - MENU, SECTION_ACCESS and menuFor are the permission areas: which pages a person may open.
 *    Roles, the permission grid and the settings hub are written against them.
 *  - NAV and sidebarFor (at the end) are how the sidebar arranges those same pages for people.
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
      { label: "My timetable", href: "/products/timetable" },
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
      { label: "Invoices", href: "/finance/invoices" },
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

/** Faculty on at least one batch here: their classes make a timetable of their own. */
function teachesBatches(actor: Actor, universityId: string, now: Date) {
  return actor.assignments.some(
    (a) => isActive(a, now) && a.universityId === universityId && a.scopeType === "batch" && (a.role === "permanent_faculty" || a.role === "visiting_faculty"),
  );
}

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
      // My timetable is for people who teach batches.
      .map((s) => (s.key === "products" && !teachesBatches(actor, universityId, now) ? { ...s, items: s.items.filter((i) => i.href !== "/products/timetable") } : s))
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

/* ─────────────────────────── The sidebar ─────────────────────────── */

/*
 * The sidebar lists pages by the job they do (teach, people, money, grow) instead of by the
 * PRD page 4 sections, on the owner's decision in November 2026: flat links under plain
 * headings, nothing to open or close, and each page in exactly one place. A link's own
 * pages (Marketplace's combos, Staff's lists) show under it only while you are inside it.
 *
 * It changes where links sit, never who may open them: a link shows when menuFor lets the
 * person open its page, or the page it `follows` for pages MENU never listed.
 */

/** `trail` is the name used on the way back and when the link stands alone, where the short label needs its parent to make sense. */
export type NavLink = { label: string; href: string; trail?: string };
/**
 * `href` is where the link leads; `own` says it is a page of its own rather than its first child.
 * `covers` are the other pages of the same screen, reached by its tabs: they keep the link lit
 * and are never listed under it.
 */
export type NavItem = { key: string; icon: string; label: string; href: string; own: boolean; access?: Access; children: NavLink[]; covers: NavLink[] };
export type NavGroup = { key: string; label?: string; items: NavItem[] };

/** `follows`: the MENU page (or any one of several) that decides whether this link shows, for pages MENU never listed. */
type NavEntry = NavLink & { follows?: string | string[] };
/** `tabs` are the pages of one screen: the link leads to the first one the person may open, and the screen's own tabs lead to the rest. */
type NavItemDef = { key: string; icon: string; label: string; page?: string | { href: string; follows: string | string[] }; children?: NavEntry[]; tabs?: NavEntry[] };

export const NAV: { key: string; label?: string; items: NavItemDef[] }[] = [
  { key: "home", items: [{ key: "home", icon: "overview", label: "Home", page: "" }] },
  {
    key: "teach",
    label: "Teach",
    items: [
      { key: "courses", icon: "products", label: "Courses", page: "/products/courses" },
      // Every batch across courses; whoever opens courses opens their batches.
      { key: "batches", icon: "batches", label: "Batches", page: { href: "/products/batches", follows: "/products/courses" } },
      { key: "timetable", icon: "timetable", label: "My timetable", page: "/products/timetable" },
      {
        key: "coursework",
        icon: "tests",
        label: "Tests and assignments",
        children: [
          { label: "Tests", href: "/products/tests" },
          { label: "Assignments", href: "/products/assignments" },
          { label: "Question pool", href: "/products/tests/pool", follows: "/products/tests" },
          // One queue for test answers and handed-in assignments.
          { label: "Grading", href: "/products/grading", follows: ["/products/tests", "/products/assignments"] },
        ],
      },
      { key: "certificates", icon: "certificates", label: "Certificates", page: "/products/certificates" },
    ],
  },
  {
    key: "people",
    label: "People",
    items: [
      // How students (and invited staff) get in sits with the list they end up on.
      {
        key: "students",
        icon: "students",
        label: "Students",
        page: "/users/students",
        children: [
          { label: "Join requests", href: "/users/requests" },
          { label: "Invitations", href: "/users/invites" },
          { label: "Bulk import", href: "/users/import" },
        ],
      },
      // One list of everyone who works here, teaching and administration together.
      {
        key: "staff",
        icon: "users",
        label: "Staff",
        page: { href: "/users/staff", follows: ["/users/teaching", "/users/administration"] },
        children: [{ label: "Departments", href: "/users/departments" }],
      },
      // Enquiries arrive through the website, but they are people to answer, not website content.
      { key: "enquiries", icon: "enquiries", label: "Enquiries", page: { href: "/website/sections/enquiries", follows: "/website/sections" } },
    ],
  },
  {
    key: "money",
    label: "Money",
    items: [
      { key: "payments", icon: "finance", label: "Payments", page: "/finance/sales" },
      { key: "invoices", icon: "billing", label: "Invoices", page: "/finance/invoices" },
      {
        key: "marketplace",
        icon: "marketplace",
        label: "Marketplace",
        page: "/marketplace",
        children: [
          { label: "Combos", href: "/marketplace/combos" },
          { label: "Discount codes", href: "/marketplace/codes" },
        ],
      },
    ],
  },
  {
    key: "grow",
    label: "Grow",
    items: [
      {
        key: "website",
        icon: "website",
        label: "Website",
        children: [
          { label: "Builder", trail: "Website builder", href: "/website/profile/builder", follows: "/website/profile" },
          // The institute's profile and its faculty's profiles: two tabs of one page.
          { label: "Profiles", trail: "Institute profile", href: "/website/profile" },
          { label: "Content", trail: "Website content", href: "/website/sections" },
        ],
      },
      {
        key: "leaderboard",
        icon: "leaderboards",
        label: "Leaderboard",
        page: "/leaderboards",
        children: [
          { label: "Challenges", href: "/leaderboards/challenges" },
          { label: "XP rules", href: "/leaderboards/xp-rules" },
          { label: "Badges", href: "/leaderboards/badges" },
        ],
      },
    ],
  },
  {
    key: "more",
    items: [
      // One Reports screen: the charts, the reports to run and download, and learning progress are its tabs.
      {
        key: "reports",
        icon: "insights",
        label: "Reports",
        tabs: [
          { label: "Overview", trail: "Insights", href: "/insights" },
          { label: "Detailed reports", trail: "Reports", href: "/finance/reports" },
          { label: "Learning progress", href: "/products/content" },
        ],
      },
      {
        key: "settings",
        icon: "settings",
        label: "Settings",
        page: "/settings",
        children: [
          { label: "Roles & permissions", href: "/users/roles" },
          { label: "Notifications", href: "/settings/notifications" },
        ],
      },
    ],
  },
];

function openPages(actor: Actor, universityId: string, now: Date) {
  const open = new Map<string, Access>();
  for (const s of menuFor(actor, universityId, now)) for (const i of s.items) open.set(i.href, s.access);
  /** The access a link opens with: its own page's, or the first page it follows that the person has. */
  return (href: string, follows?: string | string[]) => {
    if (follows === undefined) return open.get(href);
    for (const f of typeof follows === "string" ? [follows] : follows) if (open.has(f)) return open.get(f);
    return undefined;
  };
}

/** The sidebar for this person: NAV, keeping only the pages menuFor lets them open. */
export function sidebarFor(actor: Actor, universityId: string, now = new Date()): NavGroup[] {
  const accessOf = openPages(actor, universityId, now);
  const plain = ({ label, href, trail }: NavEntry): NavLink => (trail ? { label, href, trail } : { label, href });

  const groups: NavGroup[] = [];
  for (const g of NAV) {
    const items: NavItem[] = [];
    for (const def of g.items) {
      const base = { key: def.key, icon: def.icon };
      if (def.tabs) {
        // One screen with tabs: the link is its first open page, and is named for that page when it is the only one.
        const tabs = def.tabs.filter((t) => accessOf(t.href, t.follows));
        if (tabs.length === 0) continue;
        const [first, ...rest] = tabs;
        const label = tabs.length === 1 ? (first.trail ?? first.label) : def.label;
        items.push({ ...base, label, href: first.href, own: true, access: accessOf(first.href, first.follows), children: [], covers: rest.map(plain) });
        continue;
      }
      const page = def.page === undefined ? null : typeof def.page === "string" ? { href: def.page, follows: undefined } : def.page;
      const pageAccess = page ? accessOf(page.href, page.follows) : undefined;
      const children = (def.children ?? []).filter((c) => accessOf(c.href, c.follows));
      const links = children.map(plain);
      if (page && pageAccess) {
        items.push({ ...base, label: def.label, href: page.href, own: true, access: pageAccess, children: links, covers: [] });
      } else if (children.length === 1) {
        // One page left of a group: it is the link, under its own full name.
        const only = children[0];
        items.push({ ...base, label: only.trail ?? only.label, href: only.href, own: true, access: accessOf(only.href, only.follows), children: [], covers: [] });
      } else if (children.length > 1) {
        items.push({ ...base, label: def.label, href: children[0].href, own: false, access: accessOf(children[0].href, children[0].follows), children: links, covers: [] });
      }
    }
    if (items.length > 0) groups.push({ key: g.key, ...(g.label && { label: g.label }), items });
  }
  return groups;
}

/** Every link in a sidebar, flat: for marking the current page and for the way back. */
export function sidebarLinks(groups: NavGroup[]): NavLink[] {
  const named = (c: NavLink) => ({ label: c.trail ?? c.label, href: c.href });
  return groups.flatMap((g) =>
    g.items.flatMap((i) => [
      // A screen with tabs is named for the tab on the way back to it ("Insights", not the first tab's "Reports").
      ...(i.own ? [{ label: i.covers.length > 0 ? (tabName(i.key, i.href) ?? i.label) : i.label, href: i.href }] : []),
      ...i.children.map(named),
      ...i.covers.map(named),
    ]),
  );
}

function tabName(itemKey: string, href: string): string | undefined {
  const tab = NAV.flatMap((g) => g.items).find((d) => d.key === itemKey)?.tabs?.find((t) => t.href === href);
  return tab ? (tab.trail ?? tab.label) : undefined;
}

export type ScreenTab = { key: string; label: string; href: string };

/**
 * The tabs of a screen that several pages share (Reports): the ones this person may open,
 * with hrefs relative to the admin panel. Fewer than two means the page stands alone, under its own name.
 */
export function screenTabs(actor: Actor, universityId: string, itemKey: string, now = new Date()): ScreenTab[] {
  const accessOf = openPages(actor, universityId, now);
  const def = NAV.flatMap((g) => g.items).find((d) => d.key === itemKey);
  return (def?.tabs ?? []).filter((t) => accessOf(t.href, t.follows)).map((t) => ({ key: t.href, label: t.label, href: t.href }));
}
