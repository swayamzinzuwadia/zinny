import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { liveAttendance } from "@/modules/live-classes/schema";
import { joinClass, joinNext, learnerLive, myAttendance } from "@/modules/live-classes/join";
import { startClass, updateSessionLinks } from "@/modules/live-classes/staff";
import { addSessionOverride, updateBatch } from "@/server/services/batches";
import { createBatch } from "@/server/services/batches";
import { eventsOfType } from "../helpers/events";
import { person, slots, WEEKDAYS } from "../fixtures";
import { FRI, ist, liveSetup, MEET, MON, switchBatch, THU, TUE, WED } from "./helpers";

afterAll(closeDb);

describe("live-classes: joining a class", () => {
  it("inside the window records the join, marks present and sends the student to the batch link", async () => {
    const { batch, students, uni } = await liveSetup("Join Present U", { students: 1 });
    const out = await joinClass(students[0], batch.id, MON, null, ist(MON, "08:50"));
    expect(out).toMatchObject({ kind: "go", url: MEET, status: "present", firstJoin: true });
    const [row] = await myAttendance(students[0], batch.id);
    expect(row).toMatchObject({ date: MON, startTime: "09:00:00", status: "present", source: "join", joinCount: 1 });
    expect(row.firstJoinedAt?.toISOString()).toBe(ist(MON, "08:50").toISOString());
    const events = await eventsOfType("attendance.marked", uni.id);
    expect(events.map((e) => e.payload)).toEqual([{ batchId: batch.id, date: MON, startTime: "09:00", userId: students[0].userId, status: "present" }]);
  });

  it("more than 10 minutes after the start marks late", async () => {
    const { batch, students } = await liveSetup("Join Late U", { students: 2 });
    expect(await joinClass(students[0], batch.id, MON, null, ist(MON, "09:10"))).toMatchObject({ kind: "go", status: "present" });
    expect(await joinClass(students[1], batch.id, MON, null, ist(MON, "09:11"))).toMatchObject({ kind: "go", status: "late" });
  });

  it("before the window opens or after the class ends, nothing is recorded and the page says when the class is", async () => {
    const { batch, students } = await liveSetup("Join Window U", { students: 1 });
    const early = await joinClass(students[0], batch.id, MON, null, ist(MON, "08:44"));
    expect(early.kind).toBe("too_early");
    if (early.kind === "too_early") expect(early.session).toMatchObject({ date: MON, startTime: "09:00", endTime: "11:00" });
    expect((await joinClass(students[0], batch.id, MON, null, ist(MON, "11:00"))).kind).toBe("ended");
    expect((await joinClass(students[0], batch.id, "2030-11-09", null, ist(MON, "09:00"))).kind).toBe("no_class"); // a Saturday
    expect(await myAttendance(students[0], batch.id)).toEqual([]);
  });

  it("with no link anywhere, says so and records nothing", async () => {
    const { batch, students } = await liveSetup("Join No Link U", { students: 1, meetingUrl: null });
    expect((await joinClass(students[0], batch.id, MON, null, ist(MON, "09:00"))).kind).toBe("no_link");
    expect(await myAttendance(students[0], batch.id)).toEqual([]);
  });

  it("a class's own link wins over the batch's", async () => {
    const { batch, hod, students } = await liveSetup("Join Override U", { students: 1 });
    await updateSessionLinks(hod, { batchId: batch.id, date: TUE }, { meetingUrl: "https://zoom.us/j/123" }, ist(MON, "12:00"));
    expect(await joinClass(students[0], batch.id, TUE, null, ist(TUE, "09:00"))).toMatchObject({ kind: "go", url: "https://zoom.us/j/123" });
    expect(await joinClass(students[0], batch.id, WED, null, ist(WED, "09:00"))).toMatchObject({ kind: "go", url: MEET });
  });

  it("joining twice keeps one record and the first status, and counts the joins", async () => {
    const { batch, students, uni } = await liveSetup("Join Twice U", { students: 1 });
    await joinClass(students[0], batch.id, MON, null, ist(MON, "09:05"));
    const again = await joinClass(students[0], batch.id, MON, null, ist(MON, "09:45"));
    expect(again).toMatchObject({ kind: "go", status: "present", firstJoin: false });
    const rows = await systemDb().select().from(liveAttendance).where(eq(liveAttendance.userId, students[0].userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "present", joinCount: 2 });
    expect(rows[0].lastJoinedAt?.toISOString()).toBe(ist(MON, "09:45").toISOString());
    expect(await eventsOfType("attendance.marked", uni.id)).toHaveLength(1);
  });

  it("two joins at the same moment still make one record", async () => {
    const { batch, students } = await liveSetup("Join Race U", { students: 1 });
    const now = ist(MON, "09:00");
    const results = await Promise.all([1, 2, 3].map(() => joinClass(students[0], batch.id, MON, null, now)));
    expect(results.every((r) => r.kind === "go")).toBe(true);
    const rows = await systemDb().select().from(liveAttendance).where(eq(liveAttendance.userId, students[0].userId));
    expect(rows).toHaveLength(1);
    expect(rows[0].joinCount).toBe(3);
  });

  it("a student can't join a batch they aren't in, nor one in another university", async () => {
    const a = await liveSetup("Join Outsider U", { students: 1 });
    const outsider = await a.student("Outsider Olu");
    expect(await joinClass(outsider, a.batch.id, MON, null, ist(MON, "09:00"))).toEqual({ kind: "not_in_batch" });
    const b = await liveSetup("Join Other Uni U", { students: 1 });
    await expect(joinClass(b.students[0], a.batch.id, MON, null, ist(MON, "09:00"))).rejects.toThrow(/not found/);
    const rows = await systemDb().select().from(liveAttendance).where(eq(liveAttendance.batchId, a.batch.id));
    expect(rows).toEqual([]);
  });

  it("only students may use the join link (allow and deny)", async () => {
    const { batch, students, hod, faculty } = await liveSetup("Join Roles U", { students: 1 });
    await expect(joinClass(hod, batch.id, MON, null, ist(MON, "09:00"))).rejects.toThrow(/access/);
    await expect(joinClass(faculty, batch.id, MON, null, ist(MON, "09:00"))).rejects.toThrow(/access/);
    expect((await joinClass(students[0], batch.id, MON, null, ist(MON, "09:00"))).kind).toBe("go");
  });

  it("a cancelled class can't be joined, and says it was cancelled", async () => {
    const { batch, hod, students } = await liveSetup("Join Cancelled U", { students: 1 });
    await addSessionOverride(hod, batch.id, { date: TUE, kind: "cancelled", note: "Diwali holiday" });
    expect(await joinClass(students[0], batch.id, TUE, null, ist(TUE, "09:00"))).toMatchObject({ kind: "cancelled", note: "Diwali holiday" });
    expect(await myAttendance(students[0], batch.id)).toEqual([]);
  });

  it("a moved class is joined on its new date, and the old date points there", async () => {
    const { batch, hod, students } = await liveSetup("Join Moved U", { students: 1 });
    await addSessionOverride(hod, batch.id, { date: WED, kind: "rescheduled", newDate: "2030-11-09", startTime: "14:00", endTime: "16:00" });
    const old = await joinClass(students[0], batch.id, WED, null, ist(WED, "09:00"));
    expect(old).toMatchObject({ kind: "moved", to: { date: "2030-11-09", startTime: "14:00", endTime: "16:00" } });
    const moved = await joinClass(students[0], batch.id, "2030-11-09", null, ist("2030-11-09", "14:05"));
    expect(moved).toMatchObject({ kind: "go", status: "present" });
    const [row] = await myAttendance(students[0], batch.id);
    expect(row).toMatchObject({ date: "2030-11-09", startTime: "14:00:00" });
  });

  it("an extra class can be joined", async () => {
    const { batch, hod, students } = await liveSetup("Join Extra U", { students: 1 });
    await addSessionOverride(hod, batch.id, { date: "2030-11-10", kind: "extra", startTime: "18:00", endTime: "19:00", note: "Doubt clearing" });
    expect(await joinClass(students[0], batch.id, "2030-11-10", null, ist("2030-11-10", "18:00"))).toMatchObject({ kind: "go", status: "present" });
  });

  it("a locked register still lets the student into the class but doesn't change it", async () => {
    const { batch, students, faculty, uni } = await liveSetup("Join Locked U", { students: 2 });
    const { lockRegister } = await import("@/modules/live-classes/staff");
    await joinClass(students[0], batch.id, MON, null, ist(MON, "09:00"));
    await lockRegister(faculty, { batchId: batch.id, date: MON }, ist(MON, "09:30"));
    const late = await joinClass(students[1], batch.id, MON, null, ist(MON, "09:40"));
    expect(late).toMatchObject({ kind: "go", status: null });
    const [row] = await myAttendance(students[1], batch.id);
    expect(row).toMatchObject({ status: "absent", source: "system" });
    const logged = await systemDb().select().from(auditLog).where(and(eq(auditLog.universityId, uni.id), eq(auditLog.action, "live.join")));
    expect(logged.length).toBe(2);
  });

  it("after a batch switch, the old batch's link refuses and the new one works", async () => {
    const ctx = await liveSetup("Join Switch U", { students: 1 });
    const evening = await createBatch(ctx.hod, {
      courseId: ctx.course.id,
      name: "Weekday evening",
      startDate: MON,
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(WEEKDAYS, "19:00", "21:00"),
      faculty: [{ userId: ctx.facultyUserId, role: "permanent_faculty" }],
      meetingUrl: "https://meet.google.com/evening",
    });
    await switchBatch(ctx.students[0], ctx.hod, ctx.enrolments[0], evening.id);
    expect(await joinClass(ctx.students[0], ctx.batch.id, MON, null, ist(MON, "09:00"))).toEqual({ kind: "not_in_batch" });
    expect(await joinClass(ctx.students[0], evening.id, MON, null, ist(MON, "19:00"))).toMatchObject({ kind: "go", url: "https://meet.google.com/evening" });
  });

  it("refuses links that aren't web addresses, even if stored on the batch", async () => {
    const { batch, students, hod } = await liveSetup("Join Unsafe U", { students: 1 });
    await updateBatch(hod, batch.id, { meetingUrl: "javascript:alert(1)" });
    expect((await joinClass(students[0], batch.id, MON, null, ist(MON, "09:00"))).kind).toBe("no_link");
  });

  it("rejects malformed dates and ids as not found", async () => {
    const { batch, students } = await liveSetup("Join Malformed U", { students: 1 });
    await expect(joinClass(students[0], batch.id, "2030-13-01", null, ist(MON, "09:00"))).rejects.toThrow(/not found/);
    await expect(joinClass(students[0], "not-a-uuid", MON, null, ist(MON, "09:00"))).rejects.toThrow(/not found/);
  });
});

describe("live-classes: learner course tab and home card", () => {
  it("the tab lists upcoming classes with Join inside the window, and past classes with my status and recording", async () => {
    const { batch, students, enrolments, faculty, hod } = await liveSetup("Learner Tab U", { students: 2 });
    // Monday: A joins on time, B never joins; faculty starts the class. Tuesday: A joins late.
    await startClass(faculty, { batchId: batch.id, date: MON }, ist(MON, "08:55"));
    await joinClass(students[0], batch.id, MON, null, ist(MON, "09:02"));
    await joinClass(students[0], batch.id, TUE, null, ist(TUE, "09:20"));
    await updateSessionLinks(hod, { batchId: batch.id, date: MON }, { recordingUrl: "https://drive.example.com/rec-mon" }, ist(MON, "12:00"));

    const a = await learnerLive(students[0], enrolments[0], ist(WED, "08:50"));
    expect(a.upcoming[0]).toMatchObject({ date: WED, startTime: "09:00", joinable: true, hasLink: true });
    expect(a.upcoming[1]).toMatchObject({ date: THU, joinable: false });
    expect(a.past.map((p) => [p.date, p.status, p.recordingUrl])).toEqual([
      [TUE, "late", null],
      [MON, "present", "https://drive.example.com/rec-mon"],
    ]);
    expect(a).toMatchObject({ attended: 2, held: 2, percent: 100 });

    const b = await learnerLive(students[1], enrolments[1], ist(WED, "08:50"));
    // Monday was run through Zinny and has ended: B is absent. Tuesday had no start and no B row.
    expect(b.past.find((p) => p.date === MON)).toMatchObject({ status: "absent" });
    expect(b.percent).toBe(0);
  });

  it("the tab is the student's own: another student's enrolment is not found", async () => {
    const { students, enrolments } = await liveSetup("Learner Tab Own U", { students: 2 });
    await expect(learnerLive(students[0], enrolments[1], ist(MON, "09:00"))).rejects.toThrow(/not found/);
  });

  it("the home card shows a class starting within two hours, with Join only inside the window", async () => {
    const { students } = await liveSetup("Home Card U", { students: 1 });
    expect(await joinNext(students[0], ist(MON, "06:59"))).toBeNull();
    const soon = await joinNext(students[0], ist(MON, "07:30"));
    expect(soon).toMatchObject({ joinable: false, hasLink: true, session: { date: MON, startTime: "09:00" } });
    expect(await joinNext(students[0], ist(MON, "08:46"))).toMatchObject({ joinable: true });
    expect(await joinNext(students[0], ist(MON, "10:30"))).toMatchObject({ joinable: true, session: { state: "live" } });
    expect(await joinNext(students[0], ist(FRI, "11:30"))).toBeNull();
  });

  it("the home card is for students only", async () => {
    const { uni } = await liveSetup("Home Card Deny U", { students: 0 });
    const parent = await (await person("Parent Pia", "parent", { universityId: uni.id })).actor();
    await expect(joinNext(parent, ist(MON, "08:50"))).rejects.toThrow(/access/);
  });
});
