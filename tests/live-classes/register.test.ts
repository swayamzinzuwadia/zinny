import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { liveAttendance, liveSessions } from "@/modules/live-classes/schema";
import { joinClass } from "@/modules/live-classes/join";
import {
  attendanceThreshold,
  lockRegister,
  markAttendance,
  register,
  setAttendanceThreshold,
  startClass,
  unlockRegister,
  updateSessionLinks,
} from "@/modules/live-classes/staff";
import { loadActor } from "@/server/actor";
import { addSessionOverride, createBatch } from "@/server/services/batches";
import { eventsOfType } from "../helpers/events";
import { makeDepartment, person, slots, WEEKDAYS } from "../fixtures";
import { enrol, ist, liveSetup, MEET, MON, switchBatch, TUE, WED, visitingFaculty } from "./helpers";

afterAll(closeDb);

const ref = (batchId: string, date = MON) => ({ batchId, date });

describe("live-classes: the attendance register", () => {
  it("shows the roster with automatic statuses: joined, late, and no status yet while the class is on", async () => {
    const { batch, students, faculty } = await liveSetup("Register Auto U", { students: 3 });
    await joinClass(students[0], batch.id, MON, null, ist(MON, "08:58"));
    await joinClass(students[1], batch.id, MON, null, ist(MON, "09:25"));
    const r = await register(faculty, ref(batch.id), ist(MON, "09:30"));
    expect(r.entries.map((e) => [e.person.name, e.status, e.source])).toEqual([
      ["Student A", "present", "join"],
      ["Student B", "late", "join"],
      ["Student C", null, null],
    ]);
    expect(r.session).toMatchObject({ present: 1, late: 1, absent: 0, pending: 1, total: 3, percent: 67, state: "live" });
    expect(r.canMark).toBe(true);
    expect(r.canUnlock).toBe(false);
    expect(r.meetingUrl).toBe(MEET);
  });

  it("after a recorded class ends, students who never joined count as absent", async () => {
    const { batch, students, faculty } = await liveSetup("Register Ended U", { students: 2 });
    await joinClass(students[0], batch.id, MON, null, ist(MON, "09:00"));
    const r = await register(faculty, ref(batch.id), ist(MON, "11:30"));
    expect(r.entries.map((e) => [e.person.name, e.status, e.source])).toEqual([
      ["Student A", "present", "join"],
      ["Student B", "absent", "auto"],
    ]);
    expect(r.session).toMatchObject({ percent: 50, counts: true });
  });

  it("a class nobody ran through Zinny doesn't count, so the batch doesn't show 0%", async () => {
    const { batch, faculty } = await liveSetup("Register Unused U", { students: 2 });
    const r = await register(faculty, ref(batch.id), ist(MON, "11:30"));
    expect(r.session).toMatchObject({ recorded: false, counts: false, percent: null });
    expect(r.entries.every((e) => e.status === null)).toBe(true);
  });

  it("faculty change statuses with a note; each change emits attendance.marked once", async () => {
    const { batch, students, faculty, uni } = await liveSetup("Register Mark U", { students: 2 });
    await joinClass(students[0], batch.id, MON, null, ist(MON, "09:20")); // late
    const res = await markAttendance(
      faculty,
      ref(batch.id),
      [
        { userId: students[0].userId, status: "present", note: "Network trouble, was on time" },
        { userId: students[1].userId, status: "absent", note: "Informed the office" },
      ],
      ist(MON, "10:00"),
    );
    expect(res.changed).toBe(2);
    const r = await register(faculty, ref(batch.id), ist(MON, "10:00"));
    expect(r.entries.map((e) => [e.status, e.source, e.note, e.markedBy])).toEqual([
      ["present", "staff", "Network trouble, was on time", "Faculty Farah"],
      ["absent", "staff", "Informed the office", "Faculty Farah"],
    ]);
    // The join (late), then two staff changes.
    const events = (await eventsOfType("attendance.marked", uni.id)).map((e) => e.payload as { userId: string; status: string });
    expect(events).toHaveLength(3);
    // Saving the same statuses again changes nothing and emits nothing.
    const again = await markAttendance(faculty, ref(batch.id), [{ userId: students[0].userId, status: "present", note: "Network trouble, was on time" }], ist(MON, "10:05"));
    expect(again.changed).toBe(0);
    expect(await eventsOfType("attendance.marked", uni.id)).toHaveLength(3);
  });

  it("a student who isn't in the batch can't be marked in its register", async () => {
    const { batch, faculty, student } = await liveSetup("Register Outsider U", { students: 1 });
    const outsider = await student("Outsider Omar");
    await expect(markAttendance(faculty, ref(batch.id), [{ userId: outsider.userId, status: "present" }], ist(MON, "09:30"))).rejects.toThrow(
      /Only students of this batch/,
    );
    const rows = await systemDb().select().from(liveAttendance).where(eq(liveAttendance.userId, outsider.userId));
    expect(rows).toEqual([]);
  });

  it("a cancelled class can't be marked; a moved class is marked on its new date", async () => {
    const { batch, hod, faculty, students } = await liveSetup("Register Override U", { students: 1 });
    await addSessionOverride(hod, batch.id, { date: TUE, kind: "cancelled" });
    await addSessionOverride(hod, batch.id, { date: WED, kind: "rescheduled", newDate: "2030-11-09", startTime: "14:00", endTime: "16:00" });
    const mark = [{ userId: students[0].userId, status: "present" as const }];
    await expect(markAttendance(faculty, ref(batch.id, TUE), mark, ist(TUE, "10:00"))).rejects.toThrow(/cancelled/);
    await expect(register(faculty, ref(batch.id, TUE), ist(TUE, "10:00"))).rejects.toThrow(/cancelled/);
    await expect(markAttendance(faculty, ref(batch.id, WED), mark, ist(WED, "10:00"))).rejects.toThrow(/moved to Sat, 9 Nov at 2 pm/);
    await markAttendance(faculty, ref(batch.id, "2030-11-09"), mark, ist("2030-11-09", "14:30"));
    const [row] = await systemDb().select().from(liveAttendance).where(eq(liveAttendance.userId, students[0].userId));
    expect(row).toMatchObject({ date: "2030-11-09", startTime: "14:00:00", status: "present" });
  });

  it("a class that hasn't opened yet can't be marked", async () => {
    const { batch, faculty, students } = await liveSetup("Register Early U", { students: 1 });
    await expect(markAttendance(faculty, ref(batch.id), [{ userId: students[0].userId, status: "present" }], ist(MON, "08:00"))).rejects.toThrow(
      /hasn't started yet/,
    );
  });

  it("locking marks the rest absent; a locked register can't be changed by faculty", async () => {
    const { batch, students, faculty, uni } = await liveSetup("Register Lock U", { students: 3 });
    await joinClass(students[0], batch.id, MON, null, ist(MON, "09:00"));
    await expect(lockRegister(faculty, ref(batch.id), ist(MON, "08:50"))).rejects.toThrow(/once the class has started/);
    expect(await lockRegister(faculty, ref(batch.id), ist(MON, "10:00"))).toEqual({ status: "locked", absent: 2 });
    expect(await lockRegister(faculty, ref(batch.id), ist(MON, "10:01"))).toEqual({ status: "already_locked", absent: 0 });
    const r = await register(faculty, ref(batch.id), ist(MON, "10:05"));
    expect(r.lockedAt).toBeInstanceOf(Date);
    expect(r.lockedBy).toBe("Faculty Farah");
    expect(r.entries.map((e) => [e.status, e.source])).toEqual([
      ["present", "join"],
      ["absent", "system"],
      ["absent", "system"],
    ]);
    expect((await eventsOfType("attendance.marked", uni.id)).filter((e) => (e.payload as { status: string }).status === "absent")).toHaveLength(2);
    await expect(markAttendance(faculty, ref(batch.id), [{ userId: students[1].userId, status: "present" }], ist(MON, "10:10"))).rejects.toThrow(/locked/);
    // Faculty can't unlock.
    await expect(unlockRegister(faculty, ref(batch.id), ist(MON, "10:10"))).rejects.toThrow(/Only a HOD or admin/);
  });

  it("HOD and admin can unlock, and then corrections go through", async () => {
    const { batch, students, faculty, hod, admin } = await liveSetup("Register Unlock U", { students: 1 });
    await lockRegister(faculty, ref(batch.id), ist(MON, "10:00"));
    expect(await unlockRegister(hod, ref(batch.id), ist(MON, "12:00"))).toEqual({ status: "unlocked" });
    await markAttendance(faculty, ref(batch.id), [{ userId: students[0].userId, status: "late", note: "Joined from phone" }], ist(MON, "12:05"));
    await lockRegister(faculty, ref(batch.id), ist(MON, "12:10"));
    expect(await unlockRegister(admin, ref(batch.id), ist(MON, "12:15"))).toEqual({ status: "unlocked" });
    const r = await register(hod, ref(batch.id), ist(MON, "12:20"));
    expect(r.lockedAt).toBeNull();
    expect(r.entries[0]).toMatchObject({ status: "late", note: "Joined from phone" });
    expect(r.canUnlock).toBe(true);
  });

  it("a HOD of another department can't see, mark or unlock the register", async () => {
    const { batch, students, uni, faculty } = await liveSetup("Register Other HOD U", { students: 1 });
    const mkt = await makeDepartment(uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other Hod", "hod", { universityId: uni.id, departmentId: mkt.id })).actor();
    await lockRegister(faculty, ref(batch.id), ist(MON, "10:00"));
    await expect(register(otherHod, ref(batch.id), ist(MON, "10:00"))).rejects.toThrow(/access/);
    await expect(markAttendance(otherHod, ref(batch.id), [{ userId: students[0].userId, status: "present" }], ist(MON, "10:00"))).rejects.toThrow(/access/);
    await expect(unlockRegister(otherHod, ref(batch.id), ist(MON, "10:00"))).rejects.toThrow(/access/);
  });

  it("the Board can view the register but not mark it", async () => {
    const { batch, students, uni } = await liveSetup("Register Board U", { students: 1 });
    const board = await (await person("Board Bina", "board_owner", { universityId: uni.id })).actor();
    expect((await register(board, ref(batch.id), ist(MON, "10:00"))).canMark).toBe(false);
    await expect(markAttendance(board, ref(batch.id), [{ userId: students[0].userId, status: "present" }], ist(MON, "10:00"))).rejects.toThrow(/access/);
  });

  it("faculty can't mark another batch's register", async () => {
    const ctx = await liveSetup("Register Other Batch U", { students: 1 });
    const other = await person("Other Faculty", "permanent_faculty", { universityId: ctx.uni.id, departmentId: ctx.dept.id });
    const evening = await createBatch(ctx.hod, {
      courseId: ctx.course.id,
      name: "Evening",
      startDate: MON,
      endDate: "2031-01-31",
      seatLimit: 5,
      slots: slots(WEEKDAYS, "19:00", "21:00"),
      faculty: [{ userId: other.user.id, role: "permanent_faculty" }],
    });
    const otherFaculty = await loadActor(other.user.id, ctx.uni.id);
    await expect(markAttendance(otherFaculty, ref(ctx.batch.id), [{ userId: ctx.students[0].userId, status: "present" }], ist(MON, "10:00"))).rejects.toThrow(
      /access/,
    );
    await expect(register(otherFaculty, ref(ctx.batch.id), ist(MON, "10:00"))).rejects.toThrow(/access/);
    // Allowed on their own batch.
    const s = await ctx.student("Evening Eva");
    await enrol(s, evening.id);
    expect((await markAttendance(otherFaculty, ref(evening.id), [{ userId: s.userId, status: "present" }], ist(MON, "19:30"))).changed).toBe(1);
  });

  it("visiting faculty can mark while their access lasts, and not after it ends", async () => {
    const { batch, students, uni, dept } = await liveSetup("Register Visiting U", { students: 1 });
    const live = await visitingFaculty(uni.id, dept.id, batch.id, new Date(Date.now() + 86_400_000));
    expect((await markAttendance(live, ref(batch.id), [{ userId: students[0].userId, status: "present" }], ist(MON, "09:30"))).changed).toBe(1);
    const ended = await visitingFaculty(uni.id, dept.id, batch.id, new Date(Date.now() - 1000));
    await expect(markAttendance(ended, ref(batch.id), [{ userId: students[0].userId, status: "absent" }], ist(MON, "09:30"))).rejects.toThrow(/access/);
    await expect(register(ended, ref(batch.id), ist(MON, "09:30"))).rejects.toThrow(/access/);
    await expect(startClass(ended, ref(batch.id), ist(MON, "08:55"))).rejects.toThrow(/access/);
  });

  it("a student who joined the batch after a class isn't marked absent for it", async () => {
    // A batch that has been running for two weeks; the new student enrols now, in real time.
    const ctx = await liveSetup("Register Late Joiner U", { students: 0 });
    const { todayIn } = await import("@/server/lib/dates");
    const today = todayIn("Asia/Kolkata");
    const { addDays, weekStart } = await import("@/modules/live-classes/time");
    const monday = addDays(weekStart(today), -14);
    const running = await createBatch(ctx.hod, {
      courseId: ctx.course.id,
      name: "Running",
      startDate: monday,
      endDate: addDays(today, 60),
      seatLimit: 10,
      slots: slots(WEEKDAYS, "09:00", "11:00"),
      faculty: [{ userId: ctx.facultyUserId, role: "permanent_faculty" }],
      meetingUrl: MEET,
    });
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    const early = await ctx.student("Early Esha");
    await enrol(early, running.id);
    // Backdate Esha's enrolment to before the batch started.
    const { enrolments } = await import("@/db/schema");
    await systemDb().update(enrolments).set({ enrolledAt: new Date(`${monday}T00:00:00Z`) }).where(eq(enrolments.userId, early.userId));
    const newcomer = await ctx.student("New Naveen");
    await enrol(newcomer, running.id);
    // The first class of the batch was run through Zinny (faculty marked Esha present), long before Naveen enrolled.
    await markAttendance(faculty, ref(running.id, monday), [{ userId: early.userId, status: "present" }], ist(monday, "10:00"));
    const r = await register(faculty, ref(running.id, monday), ist(monday, "12:00"));
    expect(r.entries.map((e) => [e.person.name, e.status, e.lateEnrolment])).toEqual([
      ["Early Esha", "present", false],
      ["New Naveen", null, true],
    ]);
    expect(r.session).toMatchObject({ present: 1, absent: 0, total: 1, percent: 100 });
    // Locking doesn't mark him absent either.
    expect(await lockRegister(faculty, ref(running.id, monday), ist(monday, "12:00"))).toEqual({ status: "locked", absent: 0 });
  });

  it("a student who switched out keeps their past rows, shown as no longer in the batch", async () => {
    const ctx = await liveSetup("Register Switched Out U", { students: 1 });
    const second = await createBatch(ctx.hod, {
      courseId: ctx.course.id,
      name: "Weekday evening",
      startDate: MON,
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(WEEKDAYS, "19:00", "21:00"),
      faculty: [{ userId: ctx.facultyUserId, role: "permanent_faculty" }],
    });
    await joinClass(ctx.students[0], ctx.batch.id, MON, null, ist(MON, "09:00"));
    await switchBatch(ctx.students[0], ctx.hod, ctx.enrolments[0], second.id);
    const morning = await register(ctx.faculty, ref(ctx.batch.id), ist(MON, "11:30"));
    expect(morning.entries.map((e) => [e.person.name, e.status, e.current])).toEqual([["Student A", "present", false]]);
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    const evening = await register(faculty, ref(second.id), ist(MON, "21:30"));
    expect(evening.entries.map((e) => [e.person.name, e.current, e.lateEnrolment])).toEqual([["Student A", true, false]]);
  });

  it("validates statuses and notes", async () => {
    const { batch, students, faculty } = await liveSetup("Register Validate U", { students: 1 });
    await expect(markAttendance(faculty, ref(batch.id), [{ userId: students[0].userId, status: "excused" as never }], ist(MON, "10:00"))).rejects.toThrow(
      /present, late or absent/,
    );
    await expect(markAttendance(faculty, ref(batch.id), [{ userId: students[0].userId, status: "present", note: "x".repeat(301) }], ist(MON, "10:00"))).rejects.toThrow(
      /under 300/,
    );
  });
});

describe("live-classes: starting a class and its links", () => {
  it("records the first start and returns the link to open", async () => {
    const { batch, faculty, hod } = await liveSetup("Start U", { students: 1 });
    await expect(startClass(faculty, ref(batch.id), ist(MON, "07:59"))).rejects.toThrow(/from an hour before/);
    const first = await startClass(faculty, ref(batch.id), ist(MON, "08:55"));
    expect(first).toMatchObject({ url: MEET, firstStart: true });
    const second = await startClass(hod, ref(batch.id), ist(MON, "09:05"));
    expect(second.firstStart).toBe(false);
    const [row] = await systemDb().select().from(liveSessions).where(eq(liveSessions.batchId, batch.id));
    expect(row.startedAt?.toISOString()).toBe(ist(MON, "08:55").toISOString());
    expect(row.startedBy).toBe(faculty.userId);
    await expect(startClass(faculty, ref(batch.id), ist(MON, "11:00"))).rejects.toThrow(/already ended/);
  });

  it("refuses to start without a link, and for students", async () => {
    const { batch, faculty, students } = await liveSetup("Start No Link U", { students: 1, meetingUrl: null });
    await expect(startClass(faculty, ref(batch.id), ist(MON, "09:00"))).rejects.toThrow(/no meeting link/);
    await expect(startClass(students[0], ref(batch.id), ist(MON, "09:00"))).rejects.toThrow(/access/);
  });

  it("per-class links must be web addresses; the recording goes up after the class starts", async () => {
    const { batch, faculty } = await liveSetup("Links U", { students: 1 });
    await expect(updateSessionLinks(faculty, ref(batch.id), { meetingUrl: "javascript:alert(1)" }, ist(MON, "08:00"))).rejects.toThrow(/https/);
    await expect(updateSessionLinks(faculty, ref(batch.id), { recordingUrl: "https://drive.example.com/r" }, ist(MON, "08:00"))).rejects.toThrow(
      /after the class has started/,
    );
    await updateSessionLinks(faculty, ref(batch.id), { meetingUrl: "https://zoom.us/j/9", recordingUrl: "https://drive.example.com/r" }, ist(MON, "11:30"));
    const r = await register(faculty, ref(batch.id), ist(MON, "11:30"));
    expect(r).toMatchObject({ meetingUrl: "https://zoom.us/j/9", usesBatchLink: false, recordingUrl: "https://drive.example.com/r" });
    // Clearing the class link falls back to the batch's.
    await updateSessionLinks(faculty, ref(batch.id), { meetingUrl: "" }, ist(MON, "11:31"));
    expect((await register(faculty, ref(batch.id), ist(MON, "11:32"))).meetingUrl).toBe(MEET);
  });
});

describe("live-classes: attendance threshold", () => {
  it("defaults to 75% and only an Institute Admin can change it", async () => {
    const { admin, hod } = await liveSetup("Threshold U", { students: 0 });
    expect(await attendanceThreshold(hod)).toBe(75);
    await expect(setAttendanceThreshold(hod, 80)).rejects.toThrow(/Only an Institute Admin/);
    await expect(setAttendanceThreshold(admin, 0)).rejects.toThrow(/1 to 100/);
    await expect(setAttendanceThreshold(admin, 80.5)).rejects.toThrow(/1 to 100/);
    await setAttendanceThreshold(admin, 80);
    expect(await attendanceThreshold(hod)).toBe(80);
  });

  it("is per university", async () => {
    const a = await liveSetup("Threshold A U", { students: 0 });
    const b = await liveSetup("Threshold B U", { students: 0 });
    await setAttendanceThreshold(a.admin, 60);
    expect(await attendanceThreshold(a.hod)).toBe(60);
    expect(await attendanceThreshold(b.hod)).toBe(75);
  });
});
