/** Fixes from the pre-delivery review: hidden marketplace batches, student counts, readable log details, people's names for roles. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, customRoles, roleAssignments } from "@/db/schema";
import type { Actor } from "@/server/authz/engine";
import { ForbiddenError } from "@/server/errors";
import { analytics } from "@/modules/zinny-team-panel/services/analytics";
import { invoiceTermsByUniversity } from "@/modules/zinny-team-panel/services/billing";
import { coursePreview, reviewQueue } from "@/modules/zinny-team-panel/services/content";
import { saveLicence } from "@/modules/zinny-team-panel/services/licences";
import { listPeople, personDetail } from "@/modules/zinny-team-panel/services/people";
import { describeDetails } from "@/modules/zinny-team-panel/services/support";
import { holdSeat } from "@/server/services/enrolment";
import { buyRecordings, makeUser, setupCourse } from "../fixtures";
import { licence, team } from "./helpers";

afterAll(closeDb);

let sa: Actor, qa: Actor, am: Actor, fin: Actor, sup: Actor;
beforeAll(async () => {
  [sa, qa, am, fin, sup] = await Promise.all([
    team("Fix Super", "super_admin"),
    team("Fix QA", "content_qa"),
    team("Fix Manager", "account_manager"),
    team("Fix Finance", "finance_admin"),
    team("Fix Support", "support_agent"),
  ]);
});

describe("content review", () => {
  it("leaves the hidden marketplace batch out of the preview and the batch count", async () => {
    const c = await setupCourse({ name: "Hidden Batch U", pricePaise: 4_000_00 });
    await buyRecordings(await c.student("Rec Buyer"), c.batch.id);

    const preview = await coursePreview(qa, c.course.id);
    expect(preview.batches.map((b) => b.id)).toEqual([c.batch.id]);
    expect(preview.batches.every((b) => !b.recorded)).toBe(true);
    const row = (await reviewQueue(qa, "to-review", { universityId: c.uni.id })).rows.find((r) => r.courseId === c.course.id)!;
    expect(row.batches).toBe(1);
  });
});

describe("analytics", () => {
  it("counts active students only among people who hold a student role", async () => {
    const c = await setupCourse({ name: "Active Count U" });
    const one = await c.student("Count One");
    const two = await c.student("Count Two");
    await holdSeat(one, { batchId: c.batch.id });
    await holdSeat(two, { batchId: c.batch.id });
    expect(await analytics(am, { universityId: c.uni.id })).toMatchObject({ students: 2, activeStudents: 2 });

    // Still enrolled, but no longer a student: counted nowhere, so active never exceeds students.
    await systemDb()
      .update(roleAssignments)
      .set({ revokedAt: new Date() })
      .where(and(eq(roleAssignments.userId, two.userId), eq(roleAssignments.universityId, c.uni.id), eq(roleAssignments.role, "student")));
    const after = await analytics(am, { universityId: c.uni.id });
    expect(after).toMatchObject({ students: 1, activeStudents: 1 });
    const row = after.perUniversity.find((u) => u.id === c.uni.id)!;
    expect(row.activeStudents).toBeLessThanOrEqual(row.students);
  });
});

describe("new invoice terms", () => {
  it("gives each licensed institute's term and description, for finance only", async () => {
    const c = await setupCourse({ name: "Terms U" });
    await saveLicence(am, c.uni.id, licence({ plan: "standard", studentCap: 250, staffCap: 20, startDate: "2026-06-01", endDate: "2027-05-31" }));
    const terms = await invoiceTermsByUniversity(fin);
    expect(terms[c.uni.id]).toEqual({ periodStart: "2026-06-01", periodEnd: "2027-05-31", description: "Zinny Standard licence, up to 250 students and 20 staff" });
    await expect(invoiceTermsByUniversity(sup)).rejects.toThrow();
  });
});

describe("activity log details", () => {
  it("labels details, formats money and dates, and leaves out ids", () => {
    const text = describeDetails({
      universityId: "1e5f56d1-585f-4207-888e-a8cb6aca937b",
      number: "ZNY/26-27/0004",
      dueDate: "2026-11-19",
      totalPaise: 4_24_800_00,
      partnerId: "da903ee4-eb41-45b0-ab9e-50b4df98a00c",
    });
    expect(text).toBe("Invoice: ZNY/26-27/0004 · Due: 19 Nov 2026 · Total: ₹4,24,800");
    expect(describeDetails({ plan: "pilot", modules: ["live-classes", "assessments"], staffCap: 25 })).toBe("Plan: Pilot · Modules: 2 of 9 · Staff cap: 25");
    expect(describeDetails({ role: "partnerships", userId: "6e20f2d7-6b46-4f4e-b37e-7a66001f7d78" })).toBe("Role: Partnerships");
  });

  it("doesn't repeat a support session's reason, and shows a licence warning by its title", () => {
    expect(describeDetails({ reason: "Ticket 4498: timings" }, { skipReason: "Ticket 4498: timings" })).toBe("");
    expect(describeDetails({ reason: "Something else" }, { skipReason: "Ticket 4498: timings" })).toBe("Reason: Something else");
    expect(describeDetails({ kind: "student_cap", level: "warning", title: "Demo is at 92% of its student cap" }, { action: "plat.alert.raise" })).toBe(
      "Demo is at 92% of its student cap",
    );
  });
});

describe("people", () => {
  it("names custom roles in the list and on the person's page", async () => {
    const c = await setupCourse({ name: "Custom Role U" });
    const u = await makeUser("Custom Carla");
    const [role] = await systemDb().insert(customRoles).values({ universityId: c.uni.id, kind: "custom_institute", name: "Placement Officer", actions: [] }).returning();
    await systemDb().insert(roleAssignments).values({ userId: u.id, role: "custom_institute", customRoleId: role.id, scopeType: "university", universityId: c.uni.id });

    const row = (await listPeople(sa, { universityId: c.uni.id, q: "Custom Carla" })).rows[0];
    expect(row.customRoleNames).toEqual(["Placement Officer"]);
    expect((await personDetail(sa, u.id)).roles.map((r) => r.customRoleName)).toEqual(["Placement Officer"]);
  });

  it("leaves background jobs out of a person's activity", async () => {
    const c = await setupCourse({ name: "Jobs U" });
    const at = new Date();
    await systemDb()
      .insert(auditLog)
      .values([
        { universityId: c.uni.id, actorUserId: c.admin.userId, action: "gamification.award", entity: "gam_xp", data: {}, at },
        { universityId: c.uni.id, actorUserId: c.admin.userId, action: "gamification.backfill_all", entity: "gam_xp_rule", data: {}, at },
      ]);
    const actions = (await personDetail(sa, c.admin.userId)).activity.map((a) => a.action);
    expect(actions).not.toContain("gamification.award");
    expect(actions).not.toContain("gamification.backfill_all");
  });

  it("stays closed to everyone but Super Admins", async () => {
    await expect(personDetail(qa, qa.userId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
