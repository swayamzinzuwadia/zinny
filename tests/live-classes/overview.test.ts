import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { notifications } from "@/db/schema";
import { liveAlerts, liveAttendance, liveSessions, liveSettings } from "@/modules/live-classes/schema";
import { joinClass } from "@/modules/live-classes/join";
import { batchAttendance, courseLive, todaysClasses } from "@/modules/live-classes/overview";
import { closeEndedSessions, sendWeeklyAlerts } from "@/modules/live-classes/jobs";
import { attendanceReport } from "@/modules/live-classes/reports";
import { lockRegister, markAttendance, setAttendanceThreshold, startClass } from "@/modules/live-classes/staff";
import { systemActorFor } from "@/server/actor";
import { addSessionOverride, createBatch } from "@/server/services/batches";
import { eventsOfType } from "../helpers/events";
import { expectTenantIsolated } from "../helpers/isolation";
import { grant, makeDepartment, makeUser, person, slots, uniqueCode, WEEKDAYS } from "../fixtures";
import { FRI, ist, liveSetup, MON, THU, TUE, WED } from "./helpers";

afterAll(closeDb);

/**
 * Four classes Mon–Thu. A joins all four (100%), B joins Mon and Tue (50%), C joins only
 * Mon late (25%). Faculty start each class, so all four count.
 */
async function fourDays(name: string) {
  const ctx = await liveSetup(name, { students: 3 });
  const [a, b, c] = ctx.students;
  for (const [i, d] of [MON, TUE, WED, THU].entries()) {
    await startClass(ctx.faculty, { batchId: ctx.batch.id, date: d }, ist(d, "08:55"));
    await joinClass(a, ctx.batch.id, d, null, ist(d, "09:00"));
    if (i < 2) await joinClass(b, ctx.batch.id, d, null, ist(d, "09:05"));
    if (i === 0) await joinClass(c, ctx.batch.id, d, null, ist(d, "09:30"));
  }
  return ctx;
}

describe("live-classes: batch attendance", () => {
  it("every class with % present, each student's %, and students below the threshold", async () => {
    const { batch, faculty } = await fourDays("Batch Attendance U");
    const view = await batchAttendance(faculty, batch.id, ist(FRI, "08:00"));
    expect(view.past.map((s) => [s.date, s.present, s.late, s.absent, s.percent])).toEqual([
      [THU, 1, 0, 2, 33],
      [WED, 1, 0, 2, 33],
      [TUE, 2, 0, 1, 67],
      [MON, 2, 1, 0, 100],
    ]);
    expect(view.students.map((s) => [s.person.name, s.percent, s.below])).toEqual([
      ["Student C", 25, true],
      ["Student B", 50, true],
      ["Student A", 100, false],
    ]);
    expect(view).toMatchObject({ threshold: 75, recordedClasses: 4, overall: 58, canMark: true, canUnlock: false });
    expect(view.upcoming[0]).toMatchObject({ date: FRI, startTime: "09:00" });
  });

  it("uses the university's own threshold", async () => {
    const { batch, faculty, admin } = await fourDays("Batch Threshold U");
    await setAttendanceThreshold(admin, 40);
    const view = await batchAttendance(faculty, batch.id, ist(FRI, "08:00"));
    expect(view.students.map((s) => [s.person.name, s.below])).toEqual([
      ["Student C", true],
      ["Student B", false],
      ["Student A", false],
    ]);
  });

  it("a class cancelled after it was recorded drops out of every percentage", async () => {
    const { batch, faculty, hod } = await fourDays("Batch Cancel Later U");
    await addSessionOverride(hod, batch.id, { date: THU, kind: "cancelled" });
    const view = await batchAttendance(faculty, batch.id, ist(FRI, "08:00"));
    expect(view.past.map((s) => s.date)).toEqual([WED, TUE, MON]);
    expect(view.students.find((s) => s.person.name === "Student A")).toMatchObject({ held: 3, percent: 100 });
  });

  it("only staff of the batch see it (allow and deny)", async () => {
    const { batch, uni, students } = await fourDays("Batch Deny U");
    const mkt = await makeDepartment(uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other Hod", "hod", { universityId: uni.id, departmentId: mkt.id })).actor();
    await expect(batchAttendance(otherHod, batch.id, ist(FRI, "08:00"))).rejects.toThrow(/access/);
    await expect(batchAttendance(students[0], batch.id, ist(FRI, "08:00"))).rejects.toThrow(/access/);
    const board = await (await person("Board Bo", "board_owner", { universityId: uni.id })).actor();
    expect((await batchAttendance(board, batch.id, ist(FRI, "08:00"))).canMark).toBe(false);
  });
});

describe("live-classes: course tab and today's classes", () => {
  it("lists every batch of the course in reach, with upcoming classes, links and attendance %", async () => {
    const ctx = await fourDays("Course Tab U");
    const other = await person("Evening Faculty", "permanent_faculty", { universityId: ctx.uni.id, departmentId: ctx.dept.id });
    await createBatch(ctx.hod, {
      courseId: ctx.course.id,
      name: "Weekday evening",
      startDate: MON,
      endDate: "2031-01-31",
      seatLimit: 5,
      slots: slots(WEEKDAYS, "19:00", "21:00"),
      faculty: [{ userId: other.user.id, role: "permanent_faculty" }],
    });
    const asHod = await courseLive(ctx.hod, ctx.course.id, ist(FRI, "08:00"));
    expect(asHod.batches.map((b) => [b.batch.name, b.overall, b.below, b.students, b.meetingUrl !== null])).toEqual([
      ["Weekday evening", null, 0, 0, false],
      ["Weekday morning", 58, 2, 3, true],
    ]);
    expect(asHod.batches[1].upcoming[0]).toMatchObject({ date: FRI, startTime: "09:00" });
    // Faculty see only their own batch.
    const asFaculty = await courseLive(ctx.faculty, ctx.course.id, ist(FRI, "08:00"));
    expect(asFaculty.batches.map((b) => b.batch.name)).toEqual(["Weekday morning"]);
  });

  it("today's classes are narrowed by scope and show present / total", async () => {
    const ctx = await liveSetup("Today U", { students: 2 });
    await joinClass(ctx.students[0], ctx.batch.id, MON, null, ist(MON, "09:00"));
    const t = await todaysClasses(ctx.faculty, ist(MON, "09:30"));
    expect(t.classes).toHaveLength(1);
    expect(t.classes[0]).toMatchObject({ date: MON, present: 1, total: 2, canStart: true, canMark: true, state: "live" });
    const mkt = await makeDepartment(ctx.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other Hod", "hod", { universityId: ctx.uni.id, departmentId: mkt.id })).actor();
    expect((await todaysClasses(otherHod, ist(MON, "09:30"))).classes).toEqual([]);
    expect((await todaysClasses(ctx.admin, ist(MON, "09:30"))).classes).toHaveLength(1);
  });
});

describe("live-classes: jobs", () => {
  it("the hourly job marks no-shows absent once a recorded class ends, and emits attendance.marked", async () => {
    const { batch, students, faculty, uni } = await liveSetup("Close Job U", { students: 3 });
    await joinClass(students[0], batch.id, MON, null, ist(MON, "09:00"));
    // A class nobody ran through Zinny is left alone.
    const system = systemActorFor(uni.id);
    expect(await closeEndedSessions(system, ist(MON, "10:00"))).toBe(0); // still on
    expect(await closeEndedSessions(system, ist(MON, "11:05"))).toBe(2);
    expect(await closeEndedSessions(system, ist(MON, "12:05"))).toBe(0); // once only
    const rows = await systemDb().select().from(liveAttendance).where(eq(liveAttendance.batchId, batch.id));
    expect(rows.map((r) => [r.status, r.source]).sort()).toEqual([
      ["absent", "system"],
      ["absent", "system"],
      ["present", "join"],
    ]);
    const absentEvents = (await eventsOfType("attendance.marked", uni.id)).filter((e) => (e.payload as { status: string }).status === "absent");
    expect(absentEvents).toHaveLength(2);
    // A locked register is skipped (lock already closed it).
    await joinClass(students[0], batch.id, TUE, null, ist(TUE, "09:00"));
    await lockRegister(faculty, { batchId: batch.id, date: TUE }, ist(TUE, "10:00"));
    expect(await closeEndedSessions(system, ist(TUE, "11:30"))).toBe(0);
  });

  it("a session row with only a recording link isn't treated as a class run through Zinny", async () => {
    const { batch, uni, hod } = await liveSetup("Close Job Recording U", { students: 2 });
    const { updateSessionLinks } = await import("@/modules/live-classes/staff");
    await updateSessionLinks(hod, { batchId: batch.id, date: MON }, { recordingUrl: "https://drive.example.com/r" }, ist(MON, "11:30"));
    expect(await closeEndedSessions(systemActorFor(uni.id), ist(MON, "12:00"))).toBe(0);
    const [s] = await systemDb().select().from(liveSessions).where(eq(liveSessions.batchId, batch.id));
    expect(s.closedAt).toBeNull();
  });

  it("weekly alerts notify students below the threshold and send each HOD one summary, once a week", async () => {
    const ctx = await fourDays("Alerts U");
    const system = systemActorFor(ctx.uni.id);
    const run = await sendWeeklyAlerts(system, { now: ist(FRI, "08:00") });
    expect(run).toEqual({ week: MON, students: 2, hods: 1 });
    const notes = await systemDb().select().from(notifications).where(eq(notifications.universityId, ctx.uni.id));
    const low = notes.filter((n) => n.kind === "attendance.low");
    expect(low.map((n) => n.userId).sort()).toEqual([ctx.students[1].userId, ctx.students[2].userId].sort());
    expect(low.find((n) => n.userId === ctx.students[2].userId)?.title).toBe("Your attendance in Data Analytics is 25%");
    const summary = notes.filter((n) => n.kind === "attendance.low_summary");
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ userId: ctx.hod.userId, title: "2 students in Computer Science below 75% attendance" });
    expect(summary[0].body).toContain("Student C: 25% in Data Analytics, Weekday morning");
    // Running again in the same week does nothing.
    expect(await sendWeeklyAlerts(system, { now: ist(FRI, "20:00") })).toMatchObject({ skipped: "not_due" });
    // Forced: each person is still alerted at most once per week.
    expect(await sendWeeklyAlerts(system, { now: ist(FRI, "20:00"), force: true })).toMatchObject({ students: 0, hods: 0 });
    expect(await systemDb().select().from(liveAlerts).where(eq(liveAlerts.universityId, ctx.uni.id))).toHaveLength(3);
    // Next week it goes out again.
    expect(await sendWeeklyAlerts(system, { now: ist("2030-11-11", "07:00") })).toMatchObject({ week: "2030-11-11", students: 2, hods: 1 });
  });

  it("no alerts for students with too few classes, or for batches nobody runs through Zinny", async () => {
    const ctx = await liveSetup("Alerts Few U", { students: 2 });
    await startClass(ctx.faculty, { batchId: ctx.batch.id, date: MON }, ist(MON, "08:55"));
    await joinClass(ctx.students[0], ctx.batch.id, MON, null, ist(MON, "09:00"));
    const run = await sendWeeklyAlerts(systemActorFor(ctx.uni.id), { now: ist(TUE, "08:00") });
    expect(run).toMatchObject({ students: 0, hods: 0 });
  });

  it("is registered as module jobs", async () => {
    const mod = (await import("@/modules/live-classes")).default;
    expect(mod.jobs?.map((j) => [j.id, j.every])).toEqual([
      ["live-classes.close-sessions", "hour"],
      ["live-classes.weekly-alerts", "day"],
    ]);
  });
});

describe("live-classes: report", () => {
  it("by batch and student over a date range, scoped to the viewer", async () => {
    const ctx = await fourDays("Report U");
    const all = await attendanceReport(ctx.hod, { from: MON, to: FRI }, ist(FRI, "12:00"));
    expect(all.columns.map((c) => c.key)).toContain("attendance");
    expect(all.rows.map((r) => [r.student, r.classes, r.present, r.late, r.absent, r.attendance, r.belowThreshold])).toEqual([
      ["Student A", 4, 4, 0, 0, 100, "No"],
      ["Student B", 4, 2, 0, 2, 50, "Yes"],
      ["Student C", 4, 0, 1, 3, 25, "Yes"],
    ]);
    const range = await attendanceReport(ctx.hod, { from: MON, to: TUE }, ist(FRI, "12:00"));
    expect(range.rows.map((r) => [r.student, r.classes, r.attendance])).toEqual([
      ["Student A", 2, 100],
      ["Student B", 2, 100],
      ["Student C", 2, 50],
    ]);
    const byBatch = await attendanceReport(ctx.hod, { from: MON, to: FRI, batchId: ctx.batch.id }, ist(FRI, "12:00"));
    expect(byBatch.rows).toHaveLength(3);
    // Another department's HOD sees nothing of it; a student can't run it.
    const mkt = await makeDepartment(ctx.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other Hod", "hod", { universityId: ctx.uni.id, departmentId: mkt.id })).actor();
    expect((await attendanceReport(otherHod, { from: MON, to: FRI }, ist(FRI, "12:00"))).rows).toEqual([]);
    await expect(attendanceReport(ctx.students[0], { from: MON, to: FRI }, ist(FRI, "12:00"))).rejects.toThrow(/access/);
    await expect(attendanceReport(ctx.hod, { from: FRI, to: MON }, ist(FRI, "12:00"))).rejects.toThrow(/on or before/);
  });

  it("is registered as live-classes.attendance with the attendance.view action", async () => {
    const mod = (await import("@/modules/live-classes")).default;
    expect(mod.reports?.map((r) => [r.id, r.action, r.filters])).toEqual([["live-classes.attendance", "attendance.view", ["dateRange", "department", "course", "batch"]]]);
  });
});

describe("live-classes: tenant isolation", () => {
  async function batchFor(uniId: string) {
    const { createCourse } = await import("@/server/services/courses");
    const { loadActor } = await import("@/server/actor");
    const dept = await makeDepartment(uniId, uniqueCode(), "Dept");
    const hodUser = await makeUser("Iso Hod");
    await grant(hodUser.id, "hod", { universityId: uniId, departmentId: dept.id });
    const fac = await makeUser("Iso Fac");
    await grant(fac.id, "permanent_faculty", { universityId: uniId, departmentId: dept.id });
    const hod = await loadActor(hodUser.id, uniId);
    const course = await createCourse(hod, { departmentId: dept.id, title: "Iso", pricePaise: 0 });
    const batch = await createBatch(hod, {
      courseId: course.id,
      name: "Iso",
      startDate: MON,
      endDate: "2031-01-31",
      seatLimit: 5,
      slots: slots(WEEKDAYS, "09:00", "11:00"),
      faculty: [{ userId: fac.id, role: "permanent_faculty" }],
    });
    return { batch, user: fac };
  }
  let n = 0;
  const nextDate = () => `2030-12-${String(1 + (n++ % 28)).padStart(2, "0")}`;

  it("live_sessions", () =>
    expectTenantIsolated(liveSessions, async (uni) => {
      const { batch } = await batchFor(uni.id);
      return { universityId: uni.id, batchId: batch.id, date: nextDate(), startTime: "09:00" };
    }));

  it("live_attendance", () =>
    expectTenantIsolated(liveAttendance, async (uni) => {
      const { batch, user } = await batchFor(uni.id);
      return { universityId: uni.id, batchId: batch.id, date: nextDate(), startTime: "09:00", userId: user.id, status: "present" as const, source: "staff" as const };
    }));

  it("live_settings", () => expectTenantIsolated(liveSettings, (uni) => ({ universityId: uni.id, thresholdPercent: 70 })));

  it("live_alerts", () =>
    expectTenantIsolated(liveAlerts, async (uni) => {
      const user = await makeUser("Alert Person");
      return { universityId: uni.id, week: nextDate(), kind: "student", userId: user.id, scope: crypto.randomUUID() };
    }));
});
