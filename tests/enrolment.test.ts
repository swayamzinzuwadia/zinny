import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { enrolments, notifications, orders, roleAssignments } from "@/db/schema";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { createCourse, updateCourse } from "@/server/services/courses";
import {
  addSessionOverride,
  batchRoster,
  createBatch,
  facultyExpiryAlerts,
  listBatches,
  removeFaculty,
  updateBatch,
} from "@/server/services/batches";
import {
  batchOptions,
  decideSwitch,
  holdSeat,
  listSwitchRequests,
  myLearning,
  requestSwitch,
} from "@/server/services/enrolment";
import { listPeople } from "@/server/services/users";
import { studentTimetable } from "@/server/services/timetable";
import { systemActorFor } from "@/server/actor";
import { makeDepartment, makeUniversity, person, slots, WEEKDAYS } from "./fixtures";

let uniId: string;
let hod: Actor;
let otherHod: Actor;
let facultyId: string;
let faculty2Id: string;
let csId: string;
let courseId: string;
let morning: string;
let evening: string;
let weekend: string;

async function newStudent(name: string) {
  const p = await person(name, "student", { universityId: uniId });
  return p.actor();
}

beforeAll(async () => {
  const uni = await makeUniversity("Pilot University");
  uniId = uni.id;
  const cs = await makeDepartment(uniId, "CS", "Computer Science");
  const mkt = await makeDepartment(uniId, "MKT", "Marketing");
  csId = cs.id;
  hod = await (await person("Hema HOD", "hod", { universityId: uniId, departmentId: cs.id })).actor();
  otherHod = await (await person("Mehul HOD", "hod", { universityId: uniId, departmentId: mkt.id })).actor();
  const f1 = await person("Farah Faculty", "permanent_faculty", { universityId: uniId, departmentId: cs.id });
  const f2 = await person("Vikram Visiting", "visiting_faculty", { universityId: uniId, departmentId: cs.id }, new Date(Date.now() + 5 * 86_400_000));
  facultyId = f1.user.id;
  faculty2Id = f2.user.id;
});
afterAll(closeDb);

describe("PRD page 5: HOD sets up the course and its batches", () => {
  it("HOD creates a course in their own department only", async () => {
    await expect(createCourse(otherHod, { departmentId: csId, title: "Not mine", pricePaise: 0 })).rejects.toThrow(/access/);
    const c = await createCourse(hod, { departmentId: csId, title: "Data Analytics", pricePaise: 1_000_000 });
    courseId = c.id;
  });

  it("each batch needs timings and at least one faculty member", async () => {
    await expect(
      createBatch(hod, { courseId, name: "No faculty", startDate: "2030-11-04", endDate: "2031-01-31", seatLimit: 10, slots: slots(WEEKDAYS, "09:00", "11:00"), faculty: [] }),
    ).rejects.toThrow(/at least one faculty/);
    await expect(
      createBatch(hod, { courseId, name: "No timings", startDate: "2030-11-04", endDate: "2031-01-31", seatLimit: 10, slots: [], faculty: [{ userId: facultyId, role: "permanent_faculty" }] }),
    ).rejects.toThrow(/day and time/);
  });

  it("creates the three batches from the PRD example", async () => {
    const f = [{ userId: facultyId, role: "permanent_faculty" as const }];
    morning = (await createBatch(hod, { courseId, name: "Weekday morning", startDate: "2030-11-04", endDate: "2031-01-31", seatLimit: 12, slots: slots(WEEKDAYS, "09:00", "11:00"), faculty: f })).id;
    evening = (await createBatch(hod, { courseId, name: "Weekday evening", startDate: "2030-11-04", endDate: "2031-01-31", seatLimit: 5, slots: slots(WEEKDAYS, "19:00", "21:00"), faculty: f })).id;
    weekend = (
      await createBatch(hod, {
        courseId,
        name: "Weekend",
        startDate: "2030-11-09",
        endDate: "2031-01-31",
        seatLimit: 1,
        slots: slots([6, 7], "10:00", "13:00"),
        faculty: [{ userId: faculty2Id, role: "visiting_faculty" }],
      })
    ).id;
    await updateCourse(hod, courseId, { status: "published" });
    const list = await listBatches(hod, courseId);
    expect(list.map((b) => [b.batchName, b.timings, b.seatsLeft])).toEqual([
      ["Weekday morning", "Mon to Fri, 9 am to 11 am", 12],
      ["Weekday evening", "Mon to Fri, 7 pm to 9 pm", 5],
      ["Weekend", "Sat and Sun, 10 am to 1 pm", 1],
    ]);
  });

  it("a batch never drops to zero faculty", async () => {
    await expect(removeFaculty(hod, weekend, faculty2Id)).rejects.toThrow(/at least one faculty/);
  });
});

describe("PRD page 5: the student picks a batch", () => {
  it("only one student gets the last seat, even when five click at once", async () => {
    const students = await Promise.all([1, 2, 3, 4, 5].map((i) => newStudent(`Racer ${i}`)));
    const results = await Promise.allSettled(students.map((s) => holdSeat(s, { batchId: weekend })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected.every((r) => /full/.test(String(r.reason)))).toBe(true);
  });

  it("a full batch is shown but marked full", async () => {
    const s = await newStudent("Browsing Bina");
    const { options } = await batchOptions(s, courseId);
    expect(options.find((o) => o.batchId === weekend)).toMatchObject({ full: true, seatsLeft: 0 });
    expect(options.find((o) => o.batchId === morning)).toMatchObject({ full: false, seatsLeft: 12 });
  });

  it("the institute's own students join for free, even when the course has a price", async () => {
    const s = await newStudent("Joining Priya");
    const r = await holdSeat(s, { batchId: morning });
    expect(r.status).toBe("enrolled");
    if (r.status !== "enrolled") throw new Error("expected an enrolment");
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.id, r.enrolmentId));
    expect(e).toMatchObject({ status: "active", batchId: morning });
    // No order and no invoice: the course's price is for the marketplace and the website.
    expect(await systemDb().select().from(orders).where(eq(orders.userId, s.userId))).toEqual([]);
    const notes = await systemDb().select().from(notifications).where(eq(notifications.userId, s.userId));
    expect(notes.map((n) => n.title)).toContain("You're enrolled in Data Analytics");
  });

  it("a second seat in the same course is refused", async () => {
    const s = await newStudent("Double Dev");
    await holdSeat(s, { batchId: morning });
    await expect(holdSeat(s, { batchId: evening })).rejects.toThrow(/already enrolled/);
  });
});

describe("PRD page 6: clash check and timetable", () => {
  let student: Actor;
  let pythonCourse: string;
  let pythonMorning: string;

  it("warns before enrolling into a clashing batch", async () => {
    student = await newStudent("Clash Chirag");
    expect((await holdSeat(student, { batchId: morning })).status).toBe("enrolled");

    pythonCourse = (await createCourse(hod, { departmentId: csId, title: "Python Basics", pricePaise: 0 })).id;
    pythonMorning = (
      await createBatch(hod, {
        courseId: pythonCourse,
        name: "Morning",
        startDate: "2030-11-04",
        endDate: "2030-12-31",
        seatLimit: 30,
        slots: slots([2, 4], "10:00", "12:00"),
        faculty: [{ userId: facultyId, role: "permanent_faculty" }],
      })
    ).id;
    await updateCourse(hod, pythonCourse, { status: "published" });

    const opts = await batchOptions(student, pythonCourse);
    expect(opts.options[0].clashes.map((c) => c.when)).toEqual(["Tue 9 am–11 am", "Thu 9 am–11 am"]);

    const first = await holdSeat(student, { batchId: pythonMorning });
    expect(first.status).toBe("clash");
    const second = await holdSeat(student, { batchId: pythonMorning, acknowledgeClash: true });
    expect(second.status).toBe("enrolled");
  });

  it("builds the timetable from every batch the student is in", async () => {
    const t = await studentTimetable(student, { from: "2030-11-04", to: "2030-11-10" });
    expect(t.sessions.filter((s) => s.courseTitle === "Data Analytics")).toHaveLength(5);
    expect(t.sessions.filter((s) => s.courseTitle === "Python Basics").map((s) => s.date)).toEqual(["2030-11-05", "2030-11-07"]);
    expect(t.sessions[0].faculty).toEqual(["Farah Faculty"]);
  });

  it("updates instantly and notifies when the HOD changes timings or cancels a class", async () => {
    await updateBatch(hod, pythonMorning, { slots: slots([3], "14:00", "16:00") });
    await addSessionOverride(hod, morning, { date: "2030-11-04", kind: "cancelled", note: "Founders' Day" });
    const t = await studentTimetable(student, { from: "2030-11-04", to: "2030-11-10" });
    expect(t.sessions.filter((s) => s.courseTitle === "Python Basics").map((s) => `${s.date} ${s.startTime}`)).toEqual(["2030-11-06 14:00:00"]);
    expect(t.sessions.some((s) => s.date === "2030-11-04" && s.courseTitle === "Data Analytics")).toBe(false);
    const notes = await systemDb().select().from(notifications).where(eq(notifications.userId, student.userId));
    expect(notes.filter((n) => n.kind === "timetable.changed")).toHaveLength(2);
  });
});

describe("PRD page 5: switching batch", () => {
  it("student asks, HOD approves, timetable follows", async () => {
    const s = await newStudent("Switching Sana");
    const r = await holdSeat(s, { batchId: morning });
    if (r.status !== "enrolled") throw new Error("expected an enrolment");

    const req = await requestSwitch(s, { enrolmentId: r.enrolmentId, toBatchId: evening, reason: "Got a job" });
    expect(req.status).toBe("requested");
    await expect(requestSwitch(s, { enrolmentId: r.enrolmentId, toBatchId: evening })).rejects.toThrow(/already have a switch request/);

    // Only the HOD of that department sees and decides it.
    expect(await listSwitchRequests(otherHod)).toHaveLength(0);
    const inbox = await listSwitchRequests(hod);
    expect(inbox.find((x) => x.student === "Switching Sana")).toMatchObject({ fromBatchName: "Weekday morning", toBatchName: "Weekday evening" });
    if (req.status !== "requested") throw new Error();
    await expect(decideSwitch(otherHod, req.requestId, { approve: true })).rejects.toThrow(/access/);
    expect((await decideSwitch(hod, req.requestId, { approve: true })).status).toBe("approved");

    const learning = await myLearning(s);
    expect(learning[0].batch.name).toBe("Weekday evening");
    const t = await studentTimetable(s, { from: "2030-11-04", to: "2030-11-10" });
    expect(t.sessions.every((x) => x.startTime === "19:00:00")).toBe(true);
  });

  it("approval fails if the new batch filled up in the meantime", async () => {
    const s = await newStudent("Unlucky Uday");
    const r = await holdSeat(s, { batchId: morning });
    if (r.status !== "enrolled") throw new Error("expected an enrolment");
    const req = await requestSwitch(s, { enrolmentId: r.enrolmentId, toBatchId: evening });
    if (req.status !== "requested") throw new Error();

    // Fill the evening batch completely.
    const taken = (await listBatches(hod, courseId)).find((b) => b.batchId === evening)!;
    for (let i = 0; i < taken.seatsLeft; i++) {
      await holdSeat(await newStudent(`Filler ${i}`), { batchId: evening });
    }
    expect(await decideSwitch(hod, req.requestId, { approve: true })).toEqual({ status: "rejected", reason: "batch_full" });
    expect((await myLearning(s))[0].batch.name).toBe("Weekday morning");
  });
});

describe("faculty see only their own batches and students", () => {
  it("visiting faculty on Weekend can't see the morning roster", async () => {
    const visiting = await loadActor(faculty2Id, uniId);
    await expect(batchRoster(visiting, morning)).rejects.toThrow(/access/);
    const weekendRoster = await batchRoster(visiting, weekend);
    expect(weekendRoster.map((r) => r.name)).toEqual([expect.stringMatching(/^Racer \d$/)]);
    const students = await listPeople(visiting, "students");
    expect(students.map((p) => p.name)).toEqual(weekendRoster.map((r) => r.name));
  });

  it("HOD gets warned when visiting faculty access ends before the batch does", async () => {
    const alerts = await facultyExpiryAlerts(systemActorFor(uniId), 14);
    expect(alerts.map((a) => a.batchName)).toEqual(["Weekend"]);
    const notes = await systemDb().select().from(notifications).where(eq(notifications.userId, hod.userId));
    expect(notes.some((n) => n.kind === "batch.faculty_expiring")).toBe(true);
  });

  it("an expired visiting faculty member loses access", async () => {
    await systemDb().update(roleAssignments).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(roleAssignments.userId, faculty2Id));
    const expired = await loadActor(faculty2Id, uniId);
    await expect(batchRoster(expired, weekend)).rejects.toThrow(/access/);
  });
});

describe("guard rails", () => {
  it("a HOD can't give someone admin rights", async () => {
    const { assignRole } = await import("@/server/services/users");
    const s = await newStudent("Ambitious Arjun");
    await expect(assignRole(hod, { userId: s.userId, role: "institute_admin" })).rejects.toThrow(/own department/);
  });
  it("a student can't enrol someone else or see admin data", async () => {
    const s = await newStudent("Curious Kavya");
    await expect(listBatches(s, courseId)).rejects.toThrow(/access/);
    await expect(createCourse(s, { departmentId: csId, title: "Hack", pricePaise: 0 })).rejects.toThrow(/access/);
  });
  it("seat limit can't go below seats already taken", async () => {
    await expect(updateBatch(hod, evening, { seatLimit: 1 })).rejects.toThrow(/already taken/);
  });
});

describe("clash warnings count only the student's timetable", () => {
  it("a batch they were accepted into but haven't joined doesn't clash; once on the timetable it does", async () => {
    const f = [{ userId: facultyId, role: "permanent_faculty" as const }];
    const stats = (await createCourse(hod, { departmentId: csId, title: "Statistics", pricePaise: 0 })).id;
    const statsEvening = (
      await createBatch(hod, { courseId: stats, name: "Evening", startDate: "2030-11-04", endDate: "2030-12-31", seatLimit: 10, slots: slots([1, 3], "18:00", "20:00"), faculty: f })
    ).id;
    const excel = (await createCourse(hod, { departmentId: csId, title: "Excel", pricePaise: 0 })).id;
    await createBatch(hod, { courseId: excel, name: "Monday evening", startDate: "2030-11-04", endDate: "2030-12-31", seatLimit: 10, slots: slots([1], "19:00", "20:00"), faculty: f });
    await updateCourse(hod, stats, { status: "published" });
    await updateCourse(hod, excel, { status: "published" });

    const s = await newStudent("Accepted Ananya");
    const [e] = await systemDb()
      .insert(enrolments)
      .values({ universityId: uniId, userId: s.userId, courseId: stats, batchId: statsEvening, status: "approved", decidedAt: new Date() })
      .returning();
    expect((await batchOptions(s, excel)).options[0].clashes).toEqual([]);

    await systemDb().update(enrolments).set({ status: "active", enrolledAt: new Date() }).where(eq(enrolments.id, e.id));
    expect((await batchOptions(s, excel)).options[0].clashes.map((c) => `${c.courseTitle} ${c.when}`)).toEqual(["Statistics Mon 6 pm–8 pm"]);
  });
});
