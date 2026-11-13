/** Putting students straight into a batch: one, many, or from a CSV. */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, batches, enrolments, notifications, roleAssignments, studentDepartments } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { createBatch } from "@/server/services/batches";
import { createCourse } from "@/server/services/courses";
import { addStudentsToBatch, placementSummary, quickChoices } from "@/server/services/daily";
import { decideEnrolment } from "@/server/services/enrolment";
import { importPeople } from "@/server/services/users";
import { eventsOfType } from "../helpers/events";
import { makeDepartment, makeUser, person, setupCourse, slots, WEEKDAYS } from "../fixtures";

afterAll(closeDb);

describe("adding existing students to a batch", () => {
  it("lets an admin put several students in at once: active seats, told, audited, enrolment.confirmed emitted", async () => {
    const ctx = await setupCourse({ name: "Place Many U" });
    const a = await ctx.student("Asha Student");
    const b = await ctx.student("Bala Student");
    const r = await addStudentsToBatch(ctx.admin, ctx.batch.id, [a.userId, b.userId]);
    expect(r.added.map((x) => x.name).sort()).toEqual(["Asha Student", "Bala Student"]);
    expect(placementSummary(r)).toMatch(/^2 students added to Data Analytics, Weekday morning/);
    const rows = await systemDb().select().from(enrolments).where(eq(enrolments.batchId, ctx.batch.id));
    expect(rows.map((e) => e.status)).toEqual(["active", "active"]);
    const told = await systemDb().select().from(notifications).where(and(eq(notifications.userId, a.userId), eq(notifications.kind, "enrolment.confirmed")));
    expect(told).toHaveLength(1);
    const audits = await systemDb().select().from(auditLog).where(and(eq(auditLog.universityId, ctx.uni.id), eq(auditLog.action, "enrolment.add_by_staff")));
    expect(audits).toHaveLength(2);
    const events = await eventsOfType("enrolment.confirmed", ctx.uni.id);
    expect(events.map((e) => e.payload.userId).sort()).toEqual([a.userId, b.userId].sort());
    // The batch's department is added, so the student sees its courses.
    const depts = await systemDb().select().from(studentDepartments).where(eq(studentDepartments.userId, a.userId));
    expect(depts.map((d) => d.departmentId)).toEqual([ctx.dept.id]);
  });

  it("allows the batch's HOD and refuses faculty and a HOD of another department", async () => {
    const ctx = await setupCourse({ name: "Place Perms U" });
    const s = await ctx.student("Perm Student");
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    await expect(addStudentsToBatch(faculty, ctx.batch.id, [s.userId])).rejects.toBeInstanceOf(ForbiddenError);
    const other = await makeDepartment(ctx.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Other Hod", "hod", { universityId: ctx.uni.id, departmentId: other.id })).actor();
    await expect(addStudentsToBatch(otherHod, ctx.batch.id, [s.userId])).rejects.toBeInstanceOf(ForbiddenError);
    const r = await addStudentsToBatch(ctx.hod, ctx.batch.id, [s.userId]);
    expect(r.added).toHaveLength(1);
  });

  it("refuses more students than seats left, and saves none of them", async () => {
    const ctx = await setupCourse({ name: "Place Full U", seatLimit: 2 });
    const ids = [];
    for (const n of ["One", "Two", "Three"]) ids.push((await ctx.student(`Full ${n}`)).userId);
    const e = await addStudentsToBatch(ctx.admin, ctx.batch.id, ids).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictError);
    expect(e.message).toMatch(/has 2 seats left, and you picked 3 students/);
    expect(await systemDb().select().from(enrolments).where(eq(enrolments.batchId, ctx.batch.id))).toHaveLength(0);
  });

  it("leaves students already in the batch or the course as they are, and accepts a waiting request", async () => {
    const ctx = await setupCourse({ name: "Place Mixed U" });
    const other = await createBatch(ctx.hod, {
      courseId: ctx.course.id,
      name: "Evening",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(WEEKDAYS, "18:00", "19:00"),
      faculty: [{ userId: ctx.facultyUserId, role: "permanent_faculty" }],
    });
    const inBatch = await ctx.student("Already Here");
    const inOther = await ctx.student("In Evening");
    const fresh = await ctx.student("New Comer");
    await addStudentsToBatch(ctx.admin, ctx.batch.id, [inBatch.userId]);
    await addStudentsToBatch(ctx.admin, other.id, [inOther.userId]);
    const r = await addStudentsToBatch(ctx.admin, ctx.batch.id, [inBatch.userId, inOther.userId, fresh.userId]);
    expect(r.added.map((x) => x.name)).toEqual(["New Comer"]);
    expect(r.already.map((x) => x.name)).toEqual(["Already Here"]);
    expect(r.elsewhere.map((x) => x.name)).toEqual(["In Evening"]);
    expect(placementSummary(r)).toMatch(/In Evening already has a place in another batch of this course; move them with a batch switch/);
  });

  it("a student's waiting request, in this batch or another of the course, gives way to the place", async () => {
    const ctx = await setupCourse({ name: "Place Request U" });
    const other = await createBatch(ctx.hod, {
      courseId: ctx.course.id,
      name: "Evening",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(WEEKDAYS, "18:00", "19:00"),
      faculty: [{ userId: ctx.facultyUserId, role: "permanent_faculty" }],
    });
    // Requests waiting for staff, as a student's "Ask for a seat" leaves them.
    const here = await ctx.student("Waiting Here");
    const there = await ctx.student("Waiting There");
    await systemDb().insert(enrolments).values([
      { universityId: ctx.uni.id, userId: here.userId, courseId: ctx.course.id, batchId: ctx.batch.id, status: "requested" },
      { universityId: ctx.uni.id, userId: there.userId, courseId: ctx.course.id, batchId: other.id, status: "requested" },
    ]);
    const r = await addStudentsToBatch(ctx.admin, ctx.batch.id, [here.userId, there.userId]);
    expect(r.added).toHaveLength(2);
    for (const s of [here, there]) {
      const rows = await systemDb().select().from(enrolments).where(eq(enrolments.userId, s.userId));
      expect(rows.map((e) => e.status).sort()).toEqual(["active", "cancelled"]);
      expect(rows.find((e) => e.status === "active")!.batchId).toBe(ctx.batch.id);
      // Nothing left to decide.
      await expect(decideEnrolment(ctx.admin, rows.find((e) => e.status === "cancelled")!.id, true)).rejects.toBeInstanceOf(ConflictError);
    }
  });

  it("warns about a clash with the students' other batches and adds nobody until told to add anyway", async () => {
    const ctx = await setupCourse({ name: "Place Clash U" });
    // Another course at an overlapping time (setupCourse's batch is Mon–Fri 9–11 am).
    const ml = await createCourse(ctx.hod, { departmentId: ctx.dept.id, title: "Machine Learning", pricePaise: 0 });
    const mlBatch = await createBatch(ctx.hod, {
      courseId: ml.id,
      name: "ML morning",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: slots(WEEKDAYS, "10:00", "12:00"),
      faculty: [{ userId: ctx.facultyUserId, role: "permanent_faculty" }],
    });
    const busy = await ctx.student("Busy Student");
    const free = await ctx.student("Free Student");
    await addStudentsToBatch(ctx.admin, ctx.batch.id, [busy.userId]);
    const warn = await addStudentsToBatch(ctx.admin, mlBatch.id, [busy.userId, free.userId]);
    expect(warn.waitingOnClash).toBe(true);
    expect(warn.added).toEqual([]);
    expect(warn.clashes.map((c) => c.name)).toEqual(["Busy Student"]);
    expect(placementSummary(warn)).toMatch(/^Busy Student's place in Machine Learning, ML morning clashes with Data Analytics – Weekday morning .*Nobody was added yet/);
    expect(await systemDb().select().from(enrolments).where(eq(enrolments.batchId, mlBatch.id))).toHaveLength(0);
    const added = await addStudentsToBatch(ctx.admin, mlBatch.id, [busy.userId, free.userId], { acknowledgeClash: true });
    expect(added.added.map((x) => x.name).sort()).toEqual(["Busy Student", "Free Student"]);
    expect(placementSummary(added)).toMatch(/Busy Student has a clash with another batch; their timetable marks it/);
  });

  it("refuses people who aren't part of the institute, ended batches and an empty pick", async () => {
    const ctx = await setupCourse({ name: "Place Refuse U" });
    const stranger = await makeUser("Stranger Danger");
    await expect(addStudentsToBatch(ctx.admin, ctx.batch.id, [stranger.id])).rejects.toBeInstanceOf(ValidationError);
    await expect(addStudentsToBatch(ctx.admin, ctx.batch.id, [])).rejects.toBeInstanceOf(ValidationError);
    const s = await ctx.student("Late Student");
    await systemDb().update(batches).set({ startDate: "2020-01-06", endDate: "2020-03-30" }).where(eq(batches.id, ctx.batch.id));
    const e = await addStudentsToBatch(ctx.admin, ctx.batch.id, [s.userId]).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictError);
    expect(e.message).toMatch(/ended on/);
  });
});

describe("importing a CSV into a batch", () => {
  const csv = (rows: string[]) => ["name,email,phone,role,department,access_ends", ...rows].join("\n");

  it("imports the people and puts every student in the batch, in one step", async () => {
    const ctx = await setupCourse({ name: "Import Batch U" });
    const tag = Date.now();
    const r = await importPeople(ctx.admin, csv([`Ira One,ira${tag}@x.edu,,student,CS,`, `Om Two,om${tag}@x.edu,,student,,`]), { commit: true, batchId: ctx.batch.id });
    expect(r.saved).toBe(2);
    expect(r.placed).toMatchObject({ added: 2, already: 0, elsewhere: 0 });
    expect(await systemDb().select().from(enrolments).where(eq(enrolments.batchId, ctx.batch.id))).toHaveLength(2);
  });

  it("saves nothing when the batch hasn't the seats", async () => {
    const ctx = await setupCourse({ name: "Import Full U", seatLimit: 1 });
    const tag = Date.now();
    const email = `pa${tag}@x.edu`;
    const e = await importPeople(ctx.admin, csv([`Pa One,${email},,student,CS,`, `Pb Two,pb${tag}@x.edu,,student,CS,`]), { commit: true, batchId: ctx.batch.id }).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictError);
    const roles = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.universityId, ctx.uni.id));
    expect(roles.filter((x) => x.role === "student")).toHaveLength(0);
  });

  it("needs student rows when a batch is picked", async () => {
    const ctx = await setupCourse({ name: "Import Staff U" });
    await expect(importPeople(ctx.admin, csv([`Staff Only,staff${Date.now()}@x.edu,,permanent_faculty,CS,`]), { commit: false, batchId: ctx.batch.id })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("what the quick forms offer", () => {
  it("narrows each list to what the person may do", async () => {
    const ctx = await setupCourse({ name: "Choices U" });
    const faculty = await loadActor(ctx.facultyUserId, ctx.uni.id);
    const admin = await quickChoices(ctx.admin);
    expect(admin.place.map((b) => b.id)).toEqual([ctx.batch.id]);
    expect(admin.place[0]).toMatchObject({ label: "Data Analytics, Weekday morning", seatsLeft: 20, startTime: "09:00", endTime: "11:00" });
    expect(admin.departments.map((d) => d.id)).toEqual([ctx.dept.id]);
    const fac = await quickChoices(faculty);
    expect(fac.place).toEqual([]);
    expect(fac.schedule).toEqual([]);
    expect(fac.announce.map((b) => b.id)).toEqual([ctx.batch.id]);
    const student = await quickChoices(await ctx.student("Choice Student"));
    expect(student).toEqual({ place: [], announce: [], schedule: [], departments: [] });
  });
});
