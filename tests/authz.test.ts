import { describe, expect, it } from "vitest";
import { can, type Actor, type Assignment } from "@/server/authz/engine";
import { menuFor } from "@/server/authz/menu";
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
