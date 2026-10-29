import { describe, expect, it } from "vitest";
import { can, canPlatform, type Actor, type Assignment } from "@/server/authz/engine";
import type { Action } from "@/server/authz/roles";
import { menuFor } from "@/server/authz/menu";
import { activeHref } from "@/components/admin-nav";
import type { RoleName } from "@/db/schema";

const U = "uni-1";
const OTHER = "uni-2";

function actor(...assignments: Partial<Assignment>[]): Actor {
  return {
    userId: "me",
    name: "Me",
    email: "me@x",
    universityId: U,
    supportSessionId: null,
    assignments: assignments.map((a) => ({
      role: "student" as RoleName,
      scopeType: "university",
      universityId: U,
      departmentId: null,
      batchId: null,
      startsAt: new Date(0),
      endsAt: null,
      ...a,
    })),
  };
}

const admin = actor({ role: "institute_admin" });
const board = actor({ role: "board_owner" });
const accounts = actor({ role: "accounts_fees" });
const hodCS = actor({ role: "hod", scopeType: "department", departmentId: "cs" });
const facultyB1 = actor({ role: "permanent_faculty", scopeType: "batch", batchId: "b1" });
const student = actor({ role: "student" });

describe("PRD page 3: who sees what in the admin menu", () => {
  const sections = (a: Actor) => Object.fromEntries(menuFor(a, U).map((s) => [s.key, s.access]));

  it("Institute Admin sees everything, in full", () => {
    const m = sections(admin);
    expect(Object.keys(m)).toHaveLength(10);
    expect(new Set(Object.values(m))).toEqual(new Set(["full"]));
  });
  it("Board / Owner: view only on products, users, finance, insights", () => {
    expect(sections(board)).toEqual({ dashboard: "view", products: "view", users: "view", finance: "view", insights: "view" });
  });
  it("Accounts & Fees: finance only", () => {
    expect(sections(accounts)).toMatchObject({ finance: "full" });
    expect(sections(accounts).products).toBeUndefined();
  });
  it("HOD: own department, no finance, website or settings", () => {
    const m = sections(hodCS);
    expect(m).toMatchObject({ products: "dept", users: "dept", leaderboards: "dept", community: "dept", insights: "dept" });
    expect(m.finance).toBeUndefined();
    expect(m.website).toBeUndefined();
    expect(m.settings).toBeUndefined();
  });
  it("Permanent faculty: own batches, own students, leaderboard view, community", () => {
    expect(sections(facultyB1)).toMatchObject({ products: "batches", users: "students", leaderboards: "view", community: "full" });
  });
  it("Visiting faculty: only products and users", () => {
    const m = sections(actor({ role: "visiting_faculty", scopeType: "batch", batchId: "b1" }));
    expect(Object.keys(m).sort()).toEqual(["dashboard", "products", "users"]);
  });
  it("Students don't get the admin panel at all", () => {
    expect(menuFor(student, U)).toHaveLength(0);
  });
  it("HOD doesn't see bulk import or role settings", () => {
    const users = menuFor(hodCS, U).find((s) => s.key === "users")!;
    expect(users.items.map((i) => i.label)).not.toContain("Bulk import");
  });

  // Wave 1 integration: menu items for the merged modules.
  const items = (a: Actor, key: string) => (menuFor(a, U).find((s) => s.key === key)?.items ?? []).map((i) => i.href);
  it("Products lists assignments, learning progress and certificates", () => {
    for (const a of [admin, board, hodCS, facultyB1]) {
      expect(items(a, "products")).toEqual(expect.arrayContaining(["/products/assignments", "/products/content", "/products/certificates"]));
    }
  });
  it("Invitations: Institute Admin and HOD, not Board or faculty", () => {
    expect(items(admin, "users")).toContain("/users/invites");
    expect(items(hodCS, "users")).toContain("/users/invites");
    expect(items(board, "users")).not.toContain("/users/invites");
    expect(items(facultyB1, "users")).not.toContain("/users/invites");
  });
  it("HODs reach Reports from Insights; roles with Finance keep it there only", () => {
    expect(items(hodCS, "insights")).toContain("/finance/reports");
    expect(sections(hodCS).finance).toBeUndefined();
    expect(items(admin, "insights")).not.toContain("/finance/reports");
    expect(items(admin, "finance")).toContain("/finance/reports");
    expect(items(board, "insights")).not.toContain("/finance/reports");
  });
  it("Settings lists Notifications for the Institute Admin", () => {
    expect(items(admin, "settings")).toContain("/settings/notifications");
  });
});

describe("admin sidebar: one active item", () => {
  const hrefs = menuFor(admin, U).flatMap((s) => s.items.map((i) => i.href));
  const base = "/demo/admin";
  it("marks the closest item only (Badges, not Leaderboard too)", () => {
    expect(activeHref(`${base}/leaderboards/badges`, base, hrefs)).toBe("/leaderboards/badges");
    expect(activeHref(`${base}/leaderboards/challenges/abc`, base, hrefs)).toBe("/leaderboards/challenges");
    expect(activeHref(`${base}/leaderboards`, base, hrefs)).toBe("/leaderboards");
    expect(activeHref(`${base}/settings/notifications`, base, hrefs)).toBe("/settings/notifications");
    expect(activeHref(`${base}/products/courses/x`, base, hrefs)).toBe("/products/courses");
    expect(activeHref(base, base, hrefs)).toBe("");
    expect(activeHref(`${base}/nowhere`, base, hrefs)).toBeNull();
  });
});

describe("scope checks on the server", () => {
  it("HOD creates courses only in their own department", () => {
    expect(can(hodCS, "course.create", { universityId: U, departmentIds: ["cs"] })).toBe(true);
    expect(can(hodCS, "course.create", { universityId: U, departmentIds: ["mkt"] })).toBe(false);
  });
  it("one person can head one department and teach in another", () => {
    const both = actor(
      { role: "hod", scopeType: "department", departmentId: "cs" },
      { role: "permanent_faculty", scopeType: "batch", batchId: "mkt-b1" },
    );
    expect(can(both, "batch.create", { universityId: U, departmentIds: ["cs"] })).toBe(true);
    expect(can(both, "batch.teach", { universityId: U, departmentIds: ["mkt"], batchIds: ["mkt-b1"] })).toBe(true);
    expect(can(both, "batch.create", { universityId: U, departmentIds: ["mkt"] })).toBe(false);
  });
  it("faculty teach only their batches and never create courses", () => {
    expect(can(facultyB1, "batch.teach", { universityId: U, batchIds: ["b1"] })).toBe(true);
    expect(can(facultyB1, "batch.teach", { universityId: U, batchIds: ["b2"] })).toBe(false);
    expect(can(facultyB1, "course.create", { universityId: U, departmentIds: ["cs"], batchIds: ["b1"] })).toBe(false);
  });
  it("a faculty member's department role is membership only — powers come from batches", () => {
    const member = actor({ role: "visiting_faculty", scopeType: "department", departmentId: "cs" });
    expect(can(member, "enrolment.view", { universityId: U, departmentIds: ["cs"], batchIds: ["b9"] })).toBe(false);
    expect(can(member, "batch.teach", { universityId: U, departmentIds: ["cs"], batchIds: ["b9"] })).toBe(false);
  });
  it("Board is read-only", () => {
    expect(can(board, "course.view", { universityId: U })).toBe(true);
    expect(can(board, "course.update", { universityId: U })).toBe(false);
    expect(can(board, "finance.manage", { universityId: U })).toBe(false);
  });
  it("visiting faculty lose access at the end date", () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const expired = actor({ role: "visiting_faculty", scopeType: "batch", batchId: "b1", endsAt: yesterday });
    expect(can(expired, "batch.teach", { universityId: U, batchIds: ["b1"] })).toBe(false);
  });
  it("nobody reaches another university", () => {
    expect(can(admin, "course.view", { universityId: OTHER })).toBe(false);
  });
  it("Zinny team roles can't act inside a university without support mode", () => {
    const zinny = actor({ role: "super_admin", scopeType: "platform", universityId: null });
    expect(can(zinny, "course.view", { universityId: U })).toBe(false);
  });
  it("self actions only apply to yourself", () => {
    expect(can(student, "self.enrol", { universityId: U, ownerUserId: "me" })).toBe(true);
    expect(can(student, "self.enrol", { universityId: U, ownerUserId: "someone-else" })).toBe(false);
    expect(can(admin, "self.enrol", { universityId: U, ownerUserId: "me" })).toBe(false);
  });
});

/* ───────────── contracts.md section 9: module permissions, an allow and a deny per module ───────────── */

const hodMKT = actor({ role: "hod", scopeType: "department", departmentId: "mkt" });
const visitingB1 = actor({ role: "visiting_faculty", scopeType: "batch", batchId: "b1" });
const alumni = actor({ role: "alumni" });
const parent = actor({ role: "parent" });
const learner = actor({ role: "individual_learner" });
const b1 = { universityId: U, departmentIds: ["cs"], batchIds: ["b1"] };
const b2 = { universityId: U, departmentIds: ["cs"], batchIds: ["b2"] };
const csDept = { universityId: U, departmentIds: ["cs"] };
const own = { universityId: U, ownerUserId: "me" };
const someoneElse = { universityId: U, ownerUserId: "someone-else" };
const platform = (role: RoleName) => ({ ...actor({ role, scopeType: "platform", universityId: null }), universityId: null });

describe("contracts section 9: module permissions", () => {
  it("assessments: staff manage and grade in scope; Board only views results; learners take tests", () => {
    for (const a of ["assess.manage", "assess.grade", "assess.view_results"] as const) {
      expect(can(admin, a, b2)).toBe(true);
      expect(can(hodCS, a, b1)).toBe(true);
      expect(can(facultyB1, a, b1)).toBe(true);
      expect(can(facultyB1, a, b2)).toBe(false);
      expect(can(hodMKT, a, b1)).toBe(false);
    }
    expect(can(board, "assess.view_results", b1)).toBe(true);
    expect(can(board, "assess.manage", b1)).toBe(false);
    for (const who of [student, alumni, learner]) expect(can(who, "self.take_test", own)).toBe(true);
    expect(can(student, "self.take_test", someoneElse)).toBe(false);
    expect(can(parent, "self.take_test", own)).toBe(false);
  });

  it("live-classes: staff mark attendance in scope; Board views it; students join", () => {
    expect(can(facultyB1, "attendance.mark", b1)).toBe(true);
    expect(can(facultyB1, "attendance.mark", b2)).toBe(false);
    expect(can(hodCS, "live.manage", b2)).toBe(true);
    expect(can(board, "attendance.view", b1)).toBe(true);
    expect(can(board, "attendance.mark", b1)).toBe(false);
    expect(can(student, "self.join_class", own)).toBe(true);
    expect(can(alumni, "self.join_class", own)).toBe(false);
    const ended = actor({ role: "visiting_faculty", scopeType: "batch", batchId: "b1", endsAt: new Date(Date.now() - 1000) });
    expect(can(ended, "attendance.mark", b1)).toBe(false);
  });

  it("assignments-polls: staff manage, grade and run polls in scope; Board views; students submit and vote", () => {
    for (const a of ["assignment.manage", "assignment.grade", "assignment.view", "poll.manage"] as const) {
      expect(can(visitingB1, a, b1)).toBe(true);
      expect(can(visitingB1, a, b2)).toBe(false);
    }
    expect(can(board, "assignment.view", b1)).toBe(true);
    expect(can(board, "assignment.grade", b1)).toBe(false);
    expect(can(student, "self.submit_assignment", own)).toBe(true);
    expect(can(student, "self.vote", own)).toBe(true);
    expect(can(alumni, "self.submit_assignment", own)).toBe(false);
    expect(can(admin, "self.vote", own)).toBe(false);
  });

  it("content-progress: staff manage content; Board views progress; only Admin and HOD complete enrolments", () => {
    expect(can(facultyB1, "content.manage", b1)).toBe(true);
    expect(can(facultyB1, "content.manage", b2)).toBe(false);
    expect(can(board, "content.view_progress", b1)).toBe(true);
    expect(can(board, "content.manage", b1)).toBe(false);
    expect(can(hodCS, "enrolment.complete", b1)).toBe(true);
    expect(can(admin, "enrolment.complete", b1)).toBe(true);
    expect(can(facultyB1, "enrolment.complete", b1)).toBe(false);
    for (const who of [student, alumni, learner]) expect(can(who, "self.learn", own)).toBe(true);
    expect(can(parent, "self.learn", own)).toBe(false);
  });

  it("certificates: Admin and HOD issue; Board and faculty view; learners see their own", () => {
    expect(can(hodCS, "cert.issue", csDept)).toBe(true);
    expect(can(hodCS, "cert.manage", csDept)).toBe(true);
    expect(can(hodMKT, "cert.issue", csDept)).toBe(false);
    expect(can(facultyB1, "cert.issue", b1)).toBe(false);
    expect(can(facultyB1, "cert.view", b1)).toBe(true);
    expect(can(board, "cert.view", b1)).toBe(true);
    expect(can(board, "cert.issue", b1)).toBe(false);
    for (const who of [student, alumni, learner]) expect(can(who, "self.view_certificates", own)).toBe(true);
    expect(can(alumni, "self.view_certificates", someoneElse)).toBe(false);
  });

  it("payments: Admin and Accounts refund; HOD and faculty can't; learners see their invoices", () => {
    expect(can(accounts, "finance.refund", { universityId: U })).toBe(true);
    expect(can(admin, "finance.refund", { universityId: U })).toBe(true);
    expect(can(hodCS, "finance.refund", csDept)).toBe(false);
    expect(can(board, "finance.refund", { universityId: U })).toBe(false);
    expect(can(facultyB1, "finance.view", b1)).toBe(false);
    for (const who of [student, alumni, learner]) expect(can(who, "self.view_invoices", own)).toBe(true);
    expect(can(student, "self.view_invoices", someoneElse)).toBe(false);
  });

  it("reports-board: finance.view and insights.view as before", () => {
    expect(can(board, "insights.view", { universityId: U })).toBe(true);
    expect(can(accounts, "finance.view", { universityId: U })).toBe(true);
    expect(can(accounts, "insights.view", { universityId: U })).toBe(false);
    expect(can(facultyB1, "insights.view", b1)).toBe(false);
  });

  it("gamification: HOD manages own department, faculty view, students see their XP", () => {
    expect(can(hodCS, "leaderboard.manage", csDept)).toBe(true);
    expect(can(hodCS, "leaderboard.manage", { universityId: U })).toBe(false);
    expect(can(facultyB1, "leaderboard.view", b1)).toBe(true);
    expect(can(facultyB1, "leaderboard.manage", b1)).toBe(false);
    expect(can(student, "self.view_xp", own)).toBe(true);
    expect(can(alumni, "self.view_xp", own)).toBe(false);
  });

  it("website-builder: only Admin manages the website", () => {
    expect(can(admin, "website.manage", { universityId: U })).toBe(true);
    expect(can(hodCS, "website.manage", csDept)).toBe(false);
  });

  it("identity and notifications-delivery: every university role has self.profile, only for themselves", () => {
    const everyone = [admin, board, accounts, hodCS, facultyB1, visitingB1, student, alumni, parent];
    for (const who of everyone) expect(can(who, "self.profile", own)).toBe(true);
    for (const who of everyone) expect(can(who, "self.profile", someoneElse)).toBe(false);
    expect(can(admin, "settings.manage", { universityId: U })).toBe(true);
    expect(can(hodCS, "settings.manage", csDept)).toBe(false);
  });

  it("faculty grants apply only from batch assignments, never from department membership", () => {
    const member = actor({ role: "permanent_faculty", scopeType: "department", departmentId: "cs" });
    for (const a of ["assess.manage", "attendance.mark", "assignment.grade", "content.manage", "cert.view"] as const) {
      expect(can(member, a, b1)).toBe(false);
    }
  });

  it("zinny-team-panel: each platform role gets exactly its sections", () => {
    const table: [RoleName, string[]][] = [
      ["super_admin", ["manage_universities", "support_mode", "licences", "content_review", "partners", "finance", "view_analytics"]],
      ["account_manager", ["manage_universities", "licences", "view_analytics"]],
      ["support_agent", ["support_mode", "view_analytics"]],
      ["content_qa", ["content_review"]],
      ["finance_admin", ["finance", "licences"]],
      ["partnerships", ["partners"]],
    ];
    const all = ["manage_universities", "support_mode", "licences", "content_review", "partners", "finance", "view_analytics"];
    for (const [role, allowed] of table) {
      for (const a of all) {
        expect([role, a, canPlatform(platform(role), `platform.${a}` as Action)]).toEqual([role, a, allowed.includes(a)]);
      }
    }
    expect(canPlatform(admin, "platform.view_analytics")).toBe(false);
  });
});
