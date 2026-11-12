import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, batchPlanDays, batchSections, batches, notifications, roleAssignments } from "@/db/schema";
import type { Actor } from "@/server/authz/engine";
import {
  assignSectionFaculty,
  copyPlan,
  createSection,
  deleteSection,
  getBatchPlan,
  inchargeChoices,
  moveSection,
  myBatchTimetable,
  planDaysFromText,
  plansToCopy,
  readBatchTimetable,
  reorderSections,
  setIncharge,
  setSectionDays,
  updateSection,
} from "@/server/services/batch-plan";
import { addSessionOverride, assignFaculty, createBatch, getBatchDetail, listBatches, removeFaculty, updateBatch } from "@/server/services/batches";
import { createCourse } from "@/server/services/courses";
import { holdSeat } from "@/server/services/enrolment";
import { facultyTimetable, studentTimetable } from "@/server/services/timetable";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, person, setupCourse, slots, uniqueCode, WEEKDAYS } from "../fixtures";

afterAll(closeDb);

type Ctx = Awaited<ReturnType<typeof setupCourse>>;
let ctx: Ctx;
let hod: Actor;
let admin: Actor;
let faculty: Actor;
let facultyId: string;
/** On the department's teaching staff, but not on the batch. */
let teacher2Id: string;
let visitingId: string;
let otherHod: Actor;
let outsiderId: string;
let student: Actor;
let batchId: string;
/** Has batch.update but not batch.assign_faculty. */
let editorOnly: Actor;

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => ({ dayNumber: a + i }));
const db = systemDb();
const notes = (userId: string, kind: string) => db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.kind, kind)));
const audits = (entityId: string, action: string) => db.select().from(auditLog).where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)));

async function freshBatch(name: string, over: Partial<Parameters<typeof createBatch>[1]> = {}) {
  return createBatch(hod, {
    courseId: ctx.course.id,
    name,
    startDate: "2030-11-04",
    endDate: "2030-11-15",
    seatLimit: 20,
    slots: slots(WEEKDAYS, "09:00", "11:00"),
    faculty: [{ userId: facultyId, role: "permanent_faculty" }],
    ...over,
  });
}

beforeAll(async () => {
  ctx = await setupCourse({ name: "Batch Plan U" });
  hod = ctx.hod;
  admin = ctx.admin;
  facultyId = ctx.facultyUserId;
  batchId = ctx.batch.id;
  const { loadActor } = await import("@/server/actor");
  faculty = await loadActor(facultyId, ctx.uni.id);
  teacher2Id = (await person("Teacher Tina", "permanent_faculty", { universityId: ctx.uni.id, departmentId: ctx.dept.id })).user.id;
  visitingId = (await person("Visiting Vik", "visiting_faculty", { universityId: ctx.uni.id, departmentId: ctx.dept.id }, new Date("2030-11-08T23:59:59+05:30"))).user.id;
  const other = await makeDepartment(ctx.uni.id, "MKT", "Marketing");
  const oh = await person("Other Hod", "hod", { universityId: ctx.uni.id, departmentId: other.id });
  otherHod = await oh.actor();
  outsiderId = (await person("Outside Omar", "permanent_faculty", { universityId: ctx.uni.id, departmentId: other.id })).user.id;
  student = await ctx.student("Plan Student");
  await holdSeat(student, { batchId });
  editorOnly = { ...hod, assignments: hod.assignments.map((a) => ({ ...a, grants: ["course.view", "batch.view", "batch.update"] })) } as Actor;
});

describe("tenant isolation", () => {
  const parents = async (universityId: string) => {
    const dept = await makeDepartment(universityId, uniqueCode(), "Dept");
    const [course] = await db.insert((await import("@/db/schema")).courses).values({ universityId, departmentId: dept.id, title: "C", pricePaise: 0 }).returning();
    const [batch] = await db
      .insert(batches)
      .values({ universityId, courseId: course.id, departmentId: dept.id, name: "B", startDate: "2030-01-01", endDate: "2030-02-01", seatLimit: 5 })
      .returning();
    return batch;
  };
  it("batch_sections is isolated", () =>
    expectTenantIsolated(batchSections, async (uni) => ({ universityId: uni.id, batchId: (await parents(uni.id)).id, title: "GST" })));
  it("batch_plan_days is isolated", () =>
    expectTenantIsolated(batchPlanDays, async (uni) => {
      const batch = await parents(uni.id);
      const [section] = await db.insert(batchSections).values({ universityId: uni.id, batchId: batch.id, title: "GST" }).returning();
      return { universityId: uni.id, batchId: batch.id, sectionId: section.id, dayNumber: 1 };
    }));
});

describe("incharge", () => {
  it("a HOD sets it (allow); faculty and students cannot (deny)", async () => {
    await expect(setIncharge(faculty, batchId, facultyId)).rejects.toThrow(/access/i);
    await expect(setIncharge(student, batchId, facultyId)).rejects.toThrow(/access/i);
    await expect(setIncharge(otherHod, batchId, facultyId)).rejects.toThrow(/access/i);
    const r = await setIncharge(hod, batchId, facultyId);
    expect(r).toMatchObject({ changed: true, name: "Faculty Farah" });
    expect((await getBatchDetail(hod, batchId)).incharge).toMatchObject({ userId: facultyId, name: "Faculty Farah" });
    expect((await getBatchPlan(hod, batchId)).incharge?.userId).toBe(facultyId);
    expect((await listBatches(hod, ctx.course.id)).find((b) => b.batchId === batchId)?.incharge).toBe("Faculty Farah");
    // The new incharge is told, and the change is audited.
    expect(await notes(facultyId, "batch.incharge")).toHaveLength(1);
    expect((await audits(batchId, "batch.incharge")).at(-1)?.data).toMatchObject({ from: null, to: facultyId });
    expect(await setIncharge(hod, batchId, facultyId)).toEqual({ changed: false });
  });

  it("must be on the department's teaching staff or an institute admin", async () => {
    await expect(setIncharge(hod, batchId, student.userId)).rejects.toThrow(/teaching staff, or an institute admin/);
    await expect(setIncharge(hod, batchId, outsiderId)).rejects.toThrow(/teaching staff, or an institute admin/);
    await expect(setIncharge(hod, batchId, hod.userId)).resolves.toMatchObject({ changed: true });
    await expect(setIncharge(hod, batchId, teacher2Id)).resolves.toMatchObject({ changed: true });
    await expect(setIncharge(admin, batchId, admin.userId)).resolves.toMatchObject({ changed: true, name: "Admin Asha" });
    const choices = await inchargeChoices(hod, batchId);
    expect(choices.map((c) => c.id).sort()).toEqual([hod.userId, facultyId, teacher2Id, visitingId, admin.userId].sort());
    expect(choices.find((c) => c.id === hod.userId)?.role).toBe("hod");
    await expect(inchargeChoices(faculty, batchId)).rejects.toThrow(/access/i);
  });

  it("someone whose teaching role has ended can't be picked", async () => {
    const gone = await person("Gone Gita", "visiting_faculty", { universityId: ctx.uni.id, departmentId: ctx.dept.id }, new Date(Date.now() - 86_400_000));
    await expect(setIncharge(hod, batchId, gone.user.id)).rejects.toThrow(/teaching staff/);
  });

  it("can be cleared", async () => {
    await expect(setIncharge(hod, batchId, null)).resolves.toMatchObject({ changed: true, name: null });
    expect((await getBatchDetail(hod, batchId)).incharge).toBeNull();
  });

  it("gets enrolment requests like the batch's faculty do", async () => {
    const b = await freshBatch("Approval batch", { approvalRequired: true });
    await setIncharge(hod, b.id, teacher2Id);
    const asker = await ctx.student("Asking Anu");
    await holdSeat(asker, { batchId: b.id });
    expect(await notes(teacher2Id, "enrolment.requested")).toHaveLength(1);
  });
});

describe("sections", () => {
  let b: string;
  let dt: string;
  let gst: string;
  beforeAll(async () => {
    b = (await freshBatch("Sections batch")).id;
  });

  it("create: allowed with batch.update, denied without", async () => {
    await expect(createSection(faculty, b, { title: "Direct tax" })).rejects.toThrow(/access/i);
    await expect(createSection(student, b, { title: "Direct tax" })).rejects.toThrow(/access/i);
    await expect(createSection(otherHod, b, { title: "Direct tax" })).rejects.toThrow(/access/i);
    const r = await createSection(hod, b, { title: "  Direct   tax ", description: "Income tax", facultyUserId: facultyId, days: range(1, 5) });
    dt = r.section.id;
    expect(r.section).toMatchObject({ title: "Direct tax", description: "Income tax", facultyUserId: facultyId, position: 0 });
    gst = (await createSection(admin, b, { title: "GST" })).section.id;
    const plan = await getBatchPlan(hod, b);
    expect(plan.sections.map((s) => [s.title, s.position, s.daysText, s.facultyName])).toEqual([
      ["Direct tax", 0, "1-5", "Faculty Farah"],
      ["GST", 1, "", null],
    ]);
    expect((await audits(b, "batch.section_create")).map((a) => (a.data as { title: string }).title)).toEqual(["Direct tax", "GST"]);
  });

  it("validates the name", async () => {
    await expect(createSection(hod, b, { title: " " })).rejects.toThrow("Give the section a name, like Direct tax.");
    await expect(createSection(hod, b, { title: "x".repeat(81) })).rejects.toThrow(/under 80 characters/);
    await expect(createSection(hod, b, { title: "direct TAX" })).rejects.toThrow("This batch already has a section called direct TAX. Pick a different name.");
    await expect(updateSection(hod, gst, { title: "Direct tax" })).rejects.toThrow(/already has a section/);
    await expect(updateSection(hod, gst, { description: "x".repeat(501) })).rejects.toThrow(/under 500 characters/);
    await expect(updateSection(hod, "00000000-0000-4000-8000-000000000000", { title: "Nope" })).rejects.toThrow(/Section not found/);
  });

  it("edit: allowed with batch.update, denied without; only the fields given change", async () => {
    await expect(updateSection(faculty, dt, { title: "Hacked" })).rejects.toThrow(/access/i);
    await updateSection(hod, dt, { description: "Income tax and TDS" });
    const s = (await getBatchPlan(hod, b)).sections[0];
    expect(s).toMatchObject({ title: "Direct tax", description: "Income tax and TDS", facultyUserId: facultyId, daysText: "1-5" });
    expect((await audits(b, "batch.section_update")).at(-1)?.data).toEqual({ sectionId: dt, description: "Income tax and TDS" });
  });

  it("days: allowed with batch.update, denied without; replaced as a whole, with topics and times", async () => {
    await expect(setSectionDays(faculty, gst, range(6, 10))).rejects.toThrow(/access/i);
    await setSectionDays(hod, gst, [{ dayNumber: 5, topic: " Supply ", startTime: "10:00", endTime: "11:00" }, ...range(6, 9)]);
    await setSectionDays(hod, dt, [...range(1, 4), { dayNumber: 5, startTime: "9:00", endTime: "10:00" }]);
    const plan = await getBatchPlan(hod, b);
    expect(plan.sections[1].daysText).toBe("5-9");
    expect(plan.sections[1].days[0]).toEqual({ dayNumber: 5, topic: "Supply", startTime: "10:00:00", endTime: "11:00:00" });
    // Day 5 is shared, each section in its own hour.
    const day5 = plan.timetable.days[4];
    expect(day5.shared).toBe(true);
    expect(day5.entries.map((e) => [e.startTime.slice(0, 5), e.sections[0].title])).toEqual([
      ["09:00", "Direct tax"],
      ["10:00", "GST"],
    ]);
    expect(plan.timetable.problems.map((p) => p.message)).toEqual(["Day 10 has nothing planned.", "GST has no faculty."]);
    expect((await audits(b, "batch.section_update")).at(-1)?.data).toMatchObject({ sectionId: dt, days: "1-5" });
  });

  it("validates days", async () => {
    await expect(setSectionDays(hod, gst, [{ dayNumber: 0 }])).rejects.toThrow("Day numbers start at 1.");
    await expect(setSectionDays(hod, gst, [{ dayNumber: 1.5 }])).rejects.toThrow("Day numbers start at 1.");
    await expect(setSectionDays(hod, gst, [{ dayNumber: 3 }, { dayNumber: 3 }])).rejects.toThrow("Day 3 is listed twice for this section.");
    await expect(setSectionDays(hod, gst, [{ dayNumber: 9000 }])).rejects.toThrow(/too far out/);
    await expect(setSectionDays(hod, gst, [{ dayNumber: 2, startTime: "10:00" }])).rejects.toThrow("Give Day 2 both a start and an end time, or leave both empty.");
    await expect(setSectionDays(hod, gst, [{ dayNumber: 2, startTime: "11:00", endTime: "10:00" }])).rejects.toThrow("On Day 2 the end time must be after the start time.");
    await expect(setSectionDays(hod, gst, [{ dayNumber: 2, startTime: "soon", endTime: "later" }])).rejects.toThrow("Times must look like 09:00.");
    await expect(setSectionDays(hod, gst, [{ dayNumber: 2, topic: "x".repeat(201) }])).rejects.toThrow(/topic for Day 2 under 200/);
    // Nothing was saved by the failed attempts.
    expect((await getBatchPlan(hod, b)).sections[1].daysText).toBe("5-9");
    expect(() => planDaysFromText("1-3, x")).toThrow(`"x" isn't a day or a range of days. Write days like 1-5, 8, 10-12.`);
    expect(planDaysFromText("1-2, 4", { 2: { topic: "Kept" }, 9: { topic: "Dropped" } })).toEqual([{ dayNumber: 1 }, { dayNumber: 2, topic: "Kept" }, { dayNumber: 4 }]);
  });

  it("the same day twice for one section is refused by the database too", async () => {
    await expect(db.insert(batchPlanDays).values({ universityId: ctx.uni.id, batchId: b, sectionId: dt, dayNumber: 1 })).rejects.toThrow();
    await expect(db.insert(batchPlanDays).values({ universityId: ctx.uni.id, batchId: b, sectionId: dt, dayNumber: 0 })).rejects.toThrow();
    await expect(db.insert(batchPlanDays).values({ universityId: ctx.uni.id, batchId: b, sectionId: dt, dayNumber: 40, startTime: "10:00" })).rejects.toThrow();
  });

  it("reorder: allowed with batch.update, denied without", async () => {
    await expect(moveSection(faculty, gst, "up")).rejects.toThrow(/access/i);
    await expect(reorderSections(faculty, b, [gst, dt])).rejects.toThrow(/access/i);
    await moveSection(hod, gst, "up");
    expect((await getBatchPlan(hod, b)).sections.map((s) => s.title)).toEqual(["GST", "Direct tax"]);
    await moveSection(hod, gst, "up"); // already first: nothing happens
    expect((await getBatchPlan(hod, b)).sections.map((s) => s.title)).toEqual(["GST", "Direct tax"]);
    await reorderSections(hod, b, [dt, gst]);
    expect((await getBatchPlan(hod, b)).sections.map((s) => [s.title, s.position])).toEqual([
      ["Direct tax", 0],
      ["GST", 1],
    ]);
    await expect(reorderSections(hod, b, [dt])).rejects.toThrow(/every section of this batch once/);
    await expect(reorderSections(hod, b, [dt, dt])).rejects.toThrow(/every section of this batch once/);
    expect((await audits(b, "batch.section_reorder")).length).toBe(2);
  });

  it("delete: allowed with batch.update, denied without; its days go with it", async () => {
    const extra = (await createSection(hod, b, { title: "Revision", days: range(10, 10) })).section.id;
    await expect(deleteSection(faculty, extra)).rejects.toThrow(/access/i);
    await expect(deleteSection(hod, extra)).resolves.toMatchObject({ title: "Revision" });
    expect(await db.select().from(batchPlanDays).where(eq(batchPlanDays.sectionId, extra))).toEqual([]);
    expect((await audits(b, "batch.section_delete")).at(-1)?.data).toMatchObject({ title: "Revision" });
  });

  it("a recorded batch has nothing to plan", async () => {
    const { ensureRecordedBatch, withTenant } = await import("@/server/core");
    const recorded = await withTenant(hod, (tx) => ensureRecordedBatch(tx, hod, ctx.course));
    await expect(createSection(hod, recorded.id, { title: "Direct tax" })).rejects.toThrow(/no classes to plan/);
  });
});

describe("a section's faculty", () => {
  let b: string;
  let sec: string;
  beforeAll(async () => {
    b = (await freshBatch("Faculty batch")).id;
    sec = (await createSection(hod, b, { title: "Direct tax", days: range(1, 5) })).section.id;
  });

  it("assign: allowed with batch.update, denied without", async () => {
    await expect(assignSectionFaculty(faculty, sec, facultyId)).rejects.toThrow(/access/i);
    await assignSectionFaculty(hod, sec, facultyId);
    expect((await getBatchPlan(hod, b)).sections[0].facultyName).toBe("Faculty Farah");
    await assignSectionFaculty(hod, sec, null);
    expect((await getBatchPlan(hod, b)).sections[0].facultyUserId).toBeNull();
  });

  it("someone outside the department's teaching staff is refused", async () => {
    await expect(assignSectionFaculty(hod, sec, outsiderId)).rejects.toThrow("Add this person to the department's teaching staff first.");
    await expect(assignSectionFaculty(hod, sec, student.userId)).rejects.toThrow(/teaching staff first/);
  });

  it("a department teacher who isn't on the batch is added to it: needs batch.assign_faculty (deny, then allow)", async () => {
    await expect(assignSectionFaculty(editorOnly, sec, teacher2Id)).rejects.toThrow(/access/i);
    // The same person can pick faculty already on the batch.
    await expect(assignSectionFaculty(editorOnly, sec, facultyId)).resolves.toBeTruthy();
    await assignSectionFaculty(hod, sec, teacher2Id);
    const detail = await getBatchDetail(hod, b);
    expect(detail.faculty.map((f) => f.name).sort()).toEqual(["Faculty Farah", "Teacher Tina"]);
    expect(detail.faculty.find((f) => f.userId === teacher2Id)?.role).toBe("permanent_faculty");
    expect((await getBatchPlan(hod, b)).sections[0].facultyName).toBe("Teacher Tina");
    expect((await audits(b, "batch.assign_faculty")).some((a) => (a.data as { userId: string }).userId === teacher2Id)).toBe(true);
  });

  it("visiting faculty join with their access end date, and days after it are flagged", async () => {
    const gst = (await createSection(hod, b, { title: "GST", facultyUserId: visitingId, days: range(4, 8) })).section.id;
    const [a] = await db.select().from(roleAssignments).where(and(eq(roleAssignments.batchId, b), eq(roleAssignments.userId, visitingId)));
    expect(a.role).toBe("visiting_faculty");
    expect(a.endsAt?.toISOString()).toBe(new Date("2030-11-08T23:59:59+05:30").toISOString());
    const plan = await getBatchPlan(hod, b);
    expect(plan.sections.find((s) => s.id === gst)?.facultyAccessEndsOn).toBe("2030-11-08");
    const p = plan.timetable.problems.find((x) => x.code === "faculty_access_ends")!;
    // Days 4 and 5 (Thu 7, Fri 8 Nov) are fine; Days 6–8 fall in the next week.
    expect(p.dayNumbers).toEqual([6, 7, 8]);
    expect(p.message).toMatch(/^Visiting Vik's access ends on 8 Nov 2030, before 3 of their days in GST/);
  });

  it("removing someone from the batch clears them from its sections, and says which", async () => {
    await expect(removeFaculty(faculty, b, teacher2Id)).rejects.toThrow(/access/i);
    const r = await removeFaculty(hod, b, teacher2Id);
    expect(r).toEqual({ sectionsWithoutFaculty: ["Direct tax"] });
    const plan = await getBatchPlan(hod, b);
    expect(plan.sections[0].facultyUserId).toBeNull();
    expect(plan.timetable.problems.map((p) => p.message)).toContain("Direct tax has no faculty.");
    expect((await audits(b, "batch.remove_faculty")).at(-1)?.data).toMatchObject({ userId: teacher2Id, sectionsLeftWithoutFaculty: ["Direct tax"] });
    // Someone who teaches no section leaves quietly.
    await assignFaculty(hod, b, { userId: teacher2Id, role: "permanent_faculty" });
    await expect(removeFaculty(hod, b, teacher2Id)).resolves.toEqual({ sectionsWithoutFaculty: [] });
  });
});

describe("the dated timetable", () => {
  let b: string;
  let learner: Actor;
  let enrolmentId: string;
  beforeAll(async () => {
    b = (await freshBatch("Timetable batch")).id;
    await createSection(hod, b, { title: "Direct tax", facultyUserId: facultyId, days: range(1, 6).map((d) => ({ ...d, topic: `DT ${d.dayNumber}` })) });
    await createSection(hod, b, { title: "GST", facultyUserId: teacher2Id, days: range(7, 10) });
    learner = await ctx.student("Timetable Tara");
    const held = await holdSeat(learner, { batchId: b });
    enrolmentId = (held as { enrolmentId: string }).enrolmentId;
    await setIncharge(hod, b, hod.userId);
  });

  it("read: allowed with batch.view (HOD, the batch's faculty), denied without", async () => {
    expect((await getBatchPlan(hod, b)).timetable.classDays).toBe(10);
    // Loaded now, so the actor carries its role on this new batch.
    const { loadActor } = await import("@/server/actor");
    const onBatch = await loadActor(facultyId, ctx.uni.id);
    expect((await getBatchPlan(onBatch, b)).timetable.days).toHaveLength(10);
    expect((await readBatchTimetable(onBatch, b)).timetable.problems).toEqual([]);
    await expect(getBatchPlan(otherHod, b)).rejects.toThrow(/access/i);
    await expect(getBatchPlan(learner, b)).rejects.toThrow(/access/i);
    await expect(readBatchTimetable(learner, b)).rejects.toThrow(/access/i);
  });

  it("a student reads their own batch's full timetable (allow), nobody else's (deny)", async () => {
    const t = await myBatchTimetable(learner, enrolmentId);
    expect(t).toMatchObject({ courseTitle: "Data Analytics", batchName: "Timetable batch", incharge: "Hod Hema", today: expect.any(String), nextClassDate: "2030-11-04" });
    expect(t.days).toHaveLength(10);
    expect(t.days[6]).toMatchObject({ dayNumber: 7, date: "2030-11-12" });
    expect(t.days[6].entries[0].sections[0]).toMatchObject({ title: "GST", facultyName: "Teacher Tina" });
    expect(t).not.toHaveProperty("problems");
    await expect(myBatchTimetable(student, enrolmentId)).rejects.toThrow(/not found/);
    await expect(myBatchTimetable(hod, enrolmentId)).rejects.toThrow();
  });

  it("the weekly timetables carry section, section faculty, topic and day number", async () => {
    const week = await studentTimetable(learner, { from: "2030-11-11", to: "2030-11-17" });
    expect(week.sessions.map((s) => [s.date, s.dayNumber, s.section, s.sectionFaculty, s.topic])).toEqual([
      ["2030-11-11", 6, "Direct tax", ["Faculty Farah"], "DT 6"],
      ["2030-11-12", 7, "GST", ["Teacher Tina"], null],
      ["2030-11-13", 8, "GST", ["Teacher Tina"], null],
      ["2030-11-14", 9, "GST", ["Teacher Tina"], null],
      ["2030-11-15", 10, "GST", ["Teacher Tina"], null],
    ]);
    // The batch's own faculty list is untouched for callers that use it.
    expect(week.sessions[0].faculty.sort()).toEqual(["Faculty Farah", "Teacher Tina"]);
    const { loadActor } = await import("@/server/actor");
    const tina = await loadActor(teacher2Id, ctx.uni.id);
    const mine = (await facultyTimetable(tina, { from: "2030-11-11", to: "2030-11-17" })).sessions.filter((s) => s.batchId === b);
    expect(mine.map((s) => s.taughtByMe)).toEqual([false, true, true, true, true]);
  });

  it("a batch without a plan keeps its sessions exactly as before", async () => {
    const week = await studentTimetable(student, { from: "2030-11-04", to: "2030-11-10" });
    expect(week.sessions).toHaveLength(5);
    expect(week.sessions[0]).not.toHaveProperty("section");
    expect(week.sessions[0]).not.toHaveProperty("dayNumber");
  });

  it("cancelling a class shifts every later day; an extra class brings the last day back", async () => {
    await addSessionOverride(hod, b, { date: "2030-11-06", kind: "cancelled", note: "Holiday" });
    let t = (await getBatchPlan(hod, b)).timetable;
    expect(t.classDays).toBe(9);
    expect(t.days[2]).toMatchObject({ dayNumber: 3, date: "2030-11-07" });
    expect(t.days[6]).toMatchObject({ dayNumber: 7, date: "2030-11-13" });
    expect(t.offDays).toEqual([expect.objectContaining({ date: "2030-11-06", kind: "cancelled", note: "Holiday" })]);
    expect(t.problems.map((p) => p.message)).toEqual(["Day 10 is planned but these dates only have 9 class days."]);
    const week = await studentTimetable(learner, { from: "2030-11-11", to: "2030-11-17" });
    expect(week.sessions.map((s) => `${s.dayNumber} ${s.section}`)).toEqual(["5 Direct tax", "6 Direct tax", "7 GST", "8 GST", "9 GST"]);

    await addSessionOverride(hod, b, { date: "2030-11-16", kind: "extra", startTime: "09:00", endTime: "11:00" });
    t = (await getBatchPlan(hod, b)).timetable;
    expect(t.days[9]).toMatchObject({ dayNumber: 10, date: "2030-11-16" });
    expect(t.problems).toEqual([]);
  });

  it("changing the batch's dates moves the whole plan", async () => {
    await updateBatch(hod, b, { startDate: "2030-11-18", endDate: "2030-11-29" });
    const t = (await getBatchPlan(hod, b)).timetable;
    // The old extra class (16 Nov) is still a class day: it is now Day 1.
    expect(t.days.slice(0, 3).map((d) => d.date)).toEqual(["2030-11-16", "2030-11-18", "2030-11-19"]);
    expect(t.classDays).toBe(11);
    expect(t.days[6].entries[0].sections[0].title).toBe("GST");
  });
});

describe("students hear about plan changes once per save", () => {
  let b: string;
  let learner: Actor;
  const count = async () => (await notes(learner.userId, "timetable.changed")).length;
  beforeAll(async () => {
    b = (await freshBatch("Notify batch")).id;
    learner = await ctx.student("Notified Nia");
    await holdSeat(learner, { batchId: b });
  });

  it("one notification for a save that touches many days", async () => {
    const r = await createSection(hod, b, { title: "Direct tax", facultyUserId: facultyId, days: range(1, 10) });
    expect(r.studentsNotified).toBe(1);
    expect(await count()).toBe(1);
    const [n] = await notes(learner.userId, "timetable.changed");
    expect(n.title).toBe("Data Analytics: Notify batch plan updated");
    expect(n.data).toEqual({ batchId: b });
  });

  it("nothing when the upcoming days look the same", async () => {
    const before = await count();
    const sec = (await getBatchPlan(hod, b)).sections[0];
    expect((await updateSection(hod, sec.id, { description: "For staff only" })).studentsNotified).toBe(0);
    expect((await updateSection(hod, sec.id, { title: "Direct tax", days: range(1, 10) })).studentsNotified).toBe(0);
    // A section with no days changes nobody's timetable.
    const empty = await createSection(hod, b, { title: "Revision" });
    expect(empty.studentsNotified).toBe(0);
    expect((await deleteSection(hod, empty.section.id)).studentsNotified).toBe(0);
    expect(await count()).toBe(before);
  });

  it("a new topic, a new faculty member, a rename and a removed section each tell students once", async () => {
    const sec = (await getBatchPlan(hod, b)).sections[0];
    let before = await count();
    await updateSection(hod, sec.id, { days: range(1, 10).map((d) => ({ ...d, topic: "New topic" })) });
    expect(await count()).toBe(before + 1);
    before = await count();
    await updateSection(hod, sec.id, { title: "Income tax", facultyUserId: teacher2Id });
    expect(await count()).toBe(before + 1);
    before = await count();
    await removeFaculty(hod, b, teacher2Id);
    expect(await count()).toBe(before + 1);
    before = await count();
    await deleteSection(hod, sec.id);
    expect(await count()).toBe(before + 1);
  });

  it("nothing for a batch whose classes are all in the past", async () => {
    const old = await freshBatch("Finished batch", { startDate: "2020-11-02", endDate: "2020-11-13" });
    const past = await ctx.student("Past Pia");
    await db.insert((await import("@/db/schema")).enrolments).values({ universityId: ctx.uni.id, userId: past.userId, courseId: ctx.course.id, batchId: old.id, status: "active" });
    const r = await createSection(hod, old.id, { title: "Direct tax", facultyUserId: facultyId, days: range(1, 10) });
    expect(r.studentsNotified).toBe(0);
    expect(await notes(past.userId, "timetable.changed")).toEqual([]);
  });
});

describe("copy the plan from another batch of this course", () => {
  let source: string;
  let target: string;
  beforeAll(async () => {
    source = (await freshBatch("Copy source")).id;
    await createSection(hod, source, { title: "Direct tax", description: "DT", facultyUserId: facultyId, days: [{ dayNumber: 1, topic: "Intro" }, ...range(2, 5)] });
    await createSection(hod, source, { title: "GST", facultyUserId: teacher2Id, days: [{ dayNumber: 5, startTime: "10:00", endTime: "11:00" }, ...range(6, 9)] });
    await createSection(hod, source, { title: "Revision", days: range(10, 10) });
    target = (await freshBatch("Copy target", { startDate: "2030-12-02", endDate: "2030-12-13" })).id;
    await createSection(hod, target, { title: "Old plan", days: range(1, 3) });
  });

  it("allowed with batch.update, denied without", async () => {
    await expect(copyPlan(faculty, target, source)).rejects.toThrow(/access/i);
    await expect(plansToCopy(faculty, target)).rejects.toThrow(/access/i);
    expect((await plansToCopy(hod, target)).find((p) => p.batchId === source)).toMatchObject({ name: "Copy source", sections: 3, days: 10 });
    expect((await plansToCopy(hod, target)).some((p) => p.batchId === target)).toBe(false);

    const r = await copyPlan(hod, target, source);
    expect(r).toMatchObject({ fromBatchName: "Copy source", sections: 3, days: 11, withoutFaculty: [] });
    const plan = await getBatchPlan(hod, target);
    // Sections, faculty and day numbers come over; the old plan is gone; the dates are this batch's own.
    expect(plan.sections.map((s) => [s.title, s.description, s.facultyName, s.daysText])).toEqual([
      ["Direct tax", "DT", "Faculty Farah", "1-5"],
      ["GST", "", "Teacher Tina", "5-9"],
      ["Revision", "", null, "10"],
    ]);
    expect(plan.sections[0].days[0].topic).toBe("Intro");
    expect(plan.sections[1].days[0]).toMatchObject({ startTime: "10:00:00", endTime: "11:00:00" });
    expect(plan.timetable.days[0].date).toBe("2030-12-02");
    // Tina wasn't on the target batch: copying put her on it.
    expect((await getBatchDetail(hod, target)).faculty.map((f) => f.name)).toContain("Teacher Tina");
    expect((await audits(target, "batch.plan_copy")).at(-1)?.data).toMatchObject({ fromBatchId: source, sections: 3 });
    // The source is untouched.
    expect((await getBatchPlan(hod, source)).sections).toHaveLength(3);
  });

  it("faculty the copier may not add are left out, and named", async () => {
    const third = (await freshBatch("Copy third")).id;
    const r = await copyPlan(editorOnly, third, source);
    expect(r.withoutFaculty).toEqual(["GST"]);
    const plan = await getBatchPlan(hod, third);
    expect(plan.sections.map((s) => s.facultyName)).toEqual(["Faculty Farah", null, null]);
  });

  it("refuses a batch of another course, the same batch, and a batch with no plan", async () => {
    const otherCourse = await createCourse(hod, { departmentId: ctx.dept.id, title: "Other course", pricePaise: 0 });
    const elsewhere = await createBatch(hod, {
      courseId: otherCourse.id,
      name: "Elsewhere",
      startDate: "2030-11-04",
      endDate: "2030-11-15",
      seatLimit: 5,
      slots: slots(WEEKDAYS, "09:00", "11:00"),
      faculty: [{ userId: facultyId, role: "permanent_faculty" }],
    });
    await createSection(hod, elsewhere.id, { title: "Anything" });
    await expect(copyPlan(hod, target, elsewhere.id)).rejects.toThrow("Pick another batch of this course.");
    await expect(copyPlan(hod, target, target)).rejects.toThrow("Pick a different batch to copy from.");
    const empty = (await freshBatch("Copy empty")).id;
    await expect(copyPlan(hod, target, empty)).rejects.toThrow("That batch has no sections to copy.");
    expect((await getBatchPlan(hod, target)).sections).toHaveLength(3);
  });
});
