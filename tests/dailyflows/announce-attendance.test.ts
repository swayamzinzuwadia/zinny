/** Announcements to a batch, and "Mark everyone present" from the dashboard. */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, notifications } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { createBatch } from "@/server/services/batches";
import { addStudentsToBatch, sendAnnouncement } from "@/server/services/daily";
import { joinClass } from "@/modules/live-classes/join";
import { markAttendance, markRestPresent, register } from "@/modules/live-classes/staff";
import { ist, liveSetup, MON } from "../live-classes/helpers";
import { setupCourse, slots, WEEKDAYS } from "../fixtures";

afterAll(closeDb);

describe("sending an announcement", () => {
  it("reaches every student of the batch once, even one in two of the batches, and is audited", async () => {
    const ctx = await setupCourse({ name: "Announce U" });
    const second = await createBatch(ctx.hod, {
      courseId: ctx.course.id,
      name: "Evening",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(WEEKDAYS, "18:00", "19:00"),
      faculty: [{ userId: ctx.facultyUserId, role: "permanent_faculty" }],
    });
    const a = await ctx.student("Ann Student");
    const b = await ctx.student("Ben Student");
    await addStudentsToBatch(ctx.admin, ctx.batch.id, [a.userId, b.userId]);
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    const r = await sendAnnouncement(faculty, { batchIds: [ctx.batch.id, second.id], title: "No class on Friday", body: "We make it up on Saturday." });
    expect(r).toEqual({ students: 2, batches: 2 });
    const got = await systemDb().select().from(notifications).where(and(eq(notifications.userId, a.userId), eq(notifications.kind, "batch.announcement")));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: "No class on Friday" });
    expect(got[0].body).toMatch(/We make it up on Saturday\.\n\nFrom Faculty Farah/);
    const audits = await systemDb().select().from(auditLog).where(and(eq(auditLog.universityId, ctx.uni.id), eq(auditLog.action, "batch.announce")));
    expect(audits).toHaveLength(2);
  });

  it("allows the batch's faculty and HOD, refuses students and faculty of other batches", async () => {
    const ctx = await setupCourse({ name: "Announce Perms U" });
    const s = await ctx.student("Perm Student");
    await addStudentsToBatch(ctx.admin, ctx.batch.id, [s.userId]);
    expect((await sendAnnouncement(ctx.hod, { batchIds: [ctx.batch.id], title: "Hello batch", body: "" })).students).toBe(1);
    await expect(sendAnnouncement(s, { batchIds: [ctx.batch.id], title: "Hello batch", body: "" })).rejects.toBeInstanceOf(ForbiddenError);
    const { person } = await import("../fixtures");
    const outsider = await (await person("Other Faculty", "permanent_faculty", { universityId: ctx.uni.id, departmentId: ctx.dept.id })).actor();
    await expect(sendAnnouncement(outsider, { batchIds: [ctx.batch.id], title: "Hello batch", body: "" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("checks the headline and refuses a batch with nobody to tell", async () => {
    const ctx = await setupCourse({ name: "Announce Checks U" });
    await expect(sendAnnouncement(ctx.hod, { batchIds: [ctx.batch.id], title: "Hi", body: "" })).rejects.toThrow(/short headline/);
    await expect(sendAnnouncement(ctx.hod, { batchIds: [], title: "Hello there", body: "" })).rejects.toThrow(/Pick the batch/);
    const e = await sendAnnouncement(ctx.hod, { batchIds: [ctx.batch.id], title: "Hello there", body: "" }).catch((x) => x);
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.message).toMatch(/has no students yet/);
  });
});

describe("mark everyone present", () => {
  const ref = (batchId: string) => ({ batchId, date: MON });

  it("marks every student without a status present, and keeps the ones who joined", async () => {
    const { batch, students, faculty } = await liveSetup("Rest Present U", { students: 3 });
    await joinClass(students[0], batch.id, MON, null, ist(MON, "09:20"));
    const r = await markRestPresent(faculty, ref(batch.id), ist(MON, "10:30"));
    expect(r.changed).toBe(2);
    const reg = await register(faculty, ref(batch.id), ist(MON, "10:30"));
    expect(reg.entries.map((e) => [e.person.name, e.status, e.source])).toEqual([
      ["Student A", "late", "join"],
      ["Student B", "present", "staff"],
      ["Student C", "present", "staff"],
    ]);
    // Nothing left to mark the second time.
    expect((await markRestPresent(faculty, ref(batch.id), ist(MON, "10:31"))).changed).toBe(0);
  });

  it("leaves a student marked absent as absent", async () => {
    const { batch, students, faculty } = await liveSetup("Rest Absent U", { students: 2 });
    await markAttendance(faculty, ref(batch.id), [{ userId: students[0].userId, status: "absent" }], ist(MON, "10:00"));
    await markRestPresent(faculty, ref(batch.id), ist(MON, "10:30"));
    const reg = await register(faculty, ref(batch.id), ist(MON, "10:30"));
    expect(reg.entries.map((e) => e.status)).toEqual(["absent", "present"]);
  });

  it("refuses before the register opens, and refuses students and other faculty", async () => {
    const { batch, students, faculty, uni, dept } = await liveSetup("Rest Perms U", { students: 1 });
    await expect(markRestPresent(faculty, ref(batch.id), ist(MON, "07:00"))).rejects.toBeInstanceOf(ConflictError);
    await expect(markRestPresent(students[0], ref(batch.id), ist(MON, "10:00"))).rejects.toBeInstanceOf(ForbiddenError);
    const { person } = await import("../fixtures");
    const other = await (await person("Not Mine", "permanent_faculty", { universityId: uni.id, departmentId: dept.id })).actor();
    await expect(markRestPresent(other, ref(batch.id), ist(MON, "10:00"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
