import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { courses, enrolments } from "@/db/schema";
import { reports } from "@/server/registry";
import { markLessonComplete, recordLessonOpened } from "@/modules/content-progress/learn";
import { contentCourseProgress, contentLessonProgress } from "@/modules/content-progress/schema";
import { batchProgress, markStudentComplete, progressOverview } from "@/modules/content-progress/staff";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, makeUser, person, uniqueCode } from "../fixtures";
import { otherFaculty, setupLearning, tempStorage } from "./helpers";

let restore: () => void;
beforeAll(() => {
  restore = tempStorage();
});
afterAll(async () => {
  restore();
  await closeDb();
});

async function classroom(name: string) {
  const ctx = await setupLearning({ name, lessons: [{ title: "Lesson A", kind: "text" }, { title: "Lesson B", kind: "text" }, { title: "Optional", kind: "text", optional: true }] });
  const asha = await ctx.enrolled("Asha Student");
  const bala = await ctx.enrolled("Bala Student");
  const chitra = await ctx.enrolled("Chitra Student");
  await markLessonComplete(asha.actor, ctx.lessons[0].id);
  await markLessonComplete(asha.actor, ctx.lessons[1].id); // 100% → completed
  await markLessonComplete(bala.actor, ctx.lessons[0].id); // 50%
  await recordLessonOpened(bala.actor, ctx.lessons[1].id);
  return { ctx, asha, bala, chitra };
}

describe("batch progress view (content.view_progress)", () => {
  it("shows every student with %, last activity and status to staff of the batch", async () => {
    const { ctx, asha, bala, chitra } = await classroom("Batch View U");
    const board = await (await person("Board Bina", "board_owner", { universityId: ctx.uni.id })).actor();
    for (const who of [ctx.admin, ctx.hod, ctx.faculty, board]) {
      const view = await batchProgress(who, ctx.batch.id);
      expect(view.students.map((s) => [s.name, s.status, s.percent, s.done, s.total])).toEqual([
        ["Asha Student", "completed", 100, 2, 2],
        ["Bala Student", "active", 50, 1, 2],
        ["Chitra Student", "active", 0, 0, 2],
      ]);
      expect(view.summary).toEqual({ students: 3, completed: 1, notStarted: 1, average: 50 });
    }
    const view = await batchProgress(ctx.hod, ctx.batch.id);
    expect(view.students.find((s) => s.userId === bala.userId)!.lastActivityAt).toBeInstanceOf(Date);
    expect(view.students.find((s) => s.userId === chitra.userId)!.lastActivityAt).toBeNull();
    expect(view.students.find((s) => s.userId === asha.userId)!.completedOffline).toBe(false);
    expect(view.canMarkComplete).toBe(true);
    expect((await batchProgress(ctx.faculty, ctx.batch.id)).canMarkComplete).toBe(false);
  });

  it("is refused to faculty of other batches, students and other departments' HODs", async () => {
    const { ctx, bala } = await classroom("Batch Deny U");
    const other = await otherFaculty(ctx);
    const mkt = await makeDepartment(ctx.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other HOD", "hod", { universityId: ctx.uni.id, departmentId: mkt.id })).actor();
    for (const who of [other.actor, bala.actor, otherHod]) await expect(batchProgress(who, ctx.batch.id)).rejects.toThrow(/access/);
  });
});

describe("mark complete for courses finished offline (enrolment.complete)", () => {
  it("HODs and admins mark a student complete; core emits enrolment.completed once", async () => {
    const { eventsOfType } = await import("../helpers/events");
    const { ctx, bala, chitra } = await classroom("Offline U");
    expect(await markStudentComplete(ctx.hod, ctx.batch.id, bala.enrolmentId)).toMatchObject({ status: "completed" });
    expect(await markStudentComplete(ctx.admin, ctx.batch.id, bala.enrolmentId)).toMatchObject({ status: "already_completed" });
    expect(await markStudentComplete(ctx.admin, ctx.batch.id, chitra.enrolmentId)).toMatchObject({ status: "completed" });
    const events = (await eventsOfType("enrolment.completed", ctx.uni.id)).map((e) => (e.payload as { enrolmentId: string }).enrolmentId);
    expect(events.filter((id) => id === bala.enrolmentId)).toHaveLength(1);
    const view = await batchProgress(ctx.hod, ctx.batch.id);
    expect(view.students.find((s) => s.userId === bala.userId)).toMatchObject({ status: "completed", percent: 50, completedOffline: true });
  });

  it("faculty, the Board and students can't mark complete", async () => {
    const { ctx, bala } = await classroom("Offline Deny U");
    const board = await (await person("Board Bina", "board_owner", { universityId: ctx.uni.id })).actor();
    for (const who of [ctx.faculty, board, bala.actor]) await expect(markStudentComplete(who, ctx.batch.id, bala.enrolmentId)).rejects.toThrow(/access/);
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.id, bala.enrolmentId));
    expect(e.status).toBe("active");
  });

  it("refuses an enrolment that isn't in the batch named", async () => {
    const { ctx, bala } = await classroom("Offline Cross U");
    const other = await otherFaculty(ctx);
    await expect(markStudentComplete(ctx.hod, other.batch.id, bala.enrolmentId)).rejects.toThrow(/Enrolment not found/);
  });
});

describe("report: course and batch progress", () => {
  it("is registered with its filters and permission", () => {
    const r = reports().find((x) => x.id === "content-progress.course-batch-progress");
    expect(r).toMatchObject({ label: "Course and batch progress", action: "content.view_progress", filters: ["dateRange", "department", "course", "batch"] });
  });

  it("gives progress and completion counts by course and batch, scoped to the viewer", async () => {
    const { ctx } = await classroom("Report U");
    const report = reports().find((x) => x.id === "content-progress.course-batch-progress")!;
    const result = await report.run(ctx.hod, { courseId: ctx.course.id });
    expect(result.columns.map((c) => c.key)).toContain("completionRate");
    expect(result.rows).toEqual([
      {
        course: ctx.course.title,
        batch: "Running batch",
        department: "Computer Science",
        startDate: ctx.start,
        requiredLessons: 2,
        students: 3,
        notStarted: 1,
        inProgress: 1,
        completed: 1,
        averagePercent: 50,
        completionRate: 33,
      },
    ]);
    // The faculty member sees their own batches only; another faculty member sees none of these.
    const other = await otherFaculty(ctx);
    expect((await report.run(ctx.faculty, {})).rows.map((r) => r.batch)).toEqual(expect.arrayContaining(["Running batch"]));
    expect((await report.run(other.actor, {})).rows.map((r) => r.batch)).toEqual(["Other batch"]);
    // A HOD of another department sees nothing of this one.
    const mkt = await makeDepartment(ctx.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other HOD", "hod", { universityId: ctx.uni.id, departmentId: mkt.id })).actor();
    expect((await report.run(otherHod, {})).rows).toEqual([]);
    // Students have no reach at all.
    const s = await ctx.student("Report Student");
    expect(await progressOverview(s, {})).toEqual([]);
  });

  it("filters by batch, department and date range, and refuses bad filters", async () => {
    const { ctx } = await classroom("Report Filters U");
    const report = reports().find((x) => x.id === "content-progress.course-batch-progress")!;
    expect((await report.run(ctx.admin, { batchId: ctx.batch.id })).rows).toHaveLength(1);
    expect((await report.run(ctx.admin, { departmentId: ctx.dept.id })).rows.length).toBeGreaterThanOrEqual(2);
    expect((await report.run(ctx.admin, { from: "2000-01-01", to: "2000-12-31" })).rows).toEqual([]);
    await expect(report.run(ctx.admin, { from: "yesterday" })).rejects.toThrow(/Dates must look like/);
    await expect(report.run(ctx.admin, { from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow(/end date/);
    await expect(report.run(ctx.admin, { courseId: "x" })).rejects.toThrow(/from the list/);
  });
});

describe("progress tables are isolated per university", () => {
  async function lessonFor(uniId: string) {
    const dept = await makeDepartment(uniId, uniqueCode(), "Computer Science");
    const [c] = await systemDb().insert(courses).values({ universityId: uniId, departmentId: dept.id, title: "Isolated" }).returning();
    const { contentSections, contentLessons } = await import("@/modules/content-progress/schema");
    const [s] = await systemDb().insert(contentSections).values({ universityId: uniId, courseId: c.id, title: "Week 1" }).returning();
    const [l] = await systemDb().insert(contentLessons).values({ universityId: uniId, courseId: c.id, sectionId: s.id, title: "Lesson" }).returning();
    return { course: c, dept, lesson: l };
  }

  it("content_lesson_progress", () =>
    expectTenantIsolated(contentLessonProgress, async (uni) => {
      const { course, lesson } = await lessonFor(uni.id);
      const u = await makeUser("Isolated Learner");
      return { universityId: uni.id, userId: u.id, courseId: course.id, lessonId: lesson.id };
    }));

  it("content_course_progress", () =>
    expectTenantIsolated(contentCourseProgress, async (uni) => {
      const { course, dept } = await lessonFor(uni.id);
      const u = await makeUser("Isolated Learner");
      const { batches } = await import("@/db/schema");
      const [b] = await systemDb()
        .insert(batches)
        .values({ universityId: uni.id, courseId: course.id, departmentId: dept.id, name: "B", startDate: "2026-01-01", endDate: "2026-12-31", seatLimit: 5 })
        .returning();
      const [e] = await systemDb().insert(enrolments).values({ universityId: uni.id, userId: u.id, courseId: course.id, batchId: b.id, status: "completed" }).returning();
      return { universityId: uni.id, enrolmentId: e.id, userId: u.id, courseId: course.id };
    }));
});
