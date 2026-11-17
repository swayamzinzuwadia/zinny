/**
 * The Batches page lists every batch a person may open, across courses: the whole institute
 * for an admin, their departments for a HOD, the batches they teach for faculty, and nothing
 * for students or for anyone in another institute.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { batches } from "@/db/schema";
import type { Actor } from "@/server/authz/engine";
import { ensureRecordedBatch, systemActorFor, withTenant } from "@/server/core";
import { createBatch, listAllBatches, listBatches } from "@/server/services/batches";
import { createCourse } from "@/server/services/courses";
import { makeDepartment, makeUniversity, person, slots, WEEKDAYS } from "./fixtures";

afterAll(closeDb);

let admin: Actor, board: Actor, hodCs: Actor, hodMkt: Actor, faculty: Actor, accounts: Actor, student: Actor, outsider: Actor;
let csCourse: string;
let csMorning: string, csEvening: string, mktWeekend: string, elsewhere: string;

beforeAll(async () => {
  const uni = await makeUniversity("Batch List University");
  const cs = await makeDepartment(uni.id, "CS", "Computer Science");
  const mkt = await makeDepartment(uni.id, "MKT", "Marketing");
  admin = await (await person("List Admin", "institute_admin", { universityId: uni.id })).actor();
  board = await (await person("List Board", "board_owner", { universityId: uni.id })).actor();
  accounts = await (await person("List Accounts", "accounts_fees", { universityId: uni.id })).actor();
  hodCs = await (await person("List Hod Cs", "hod", { universityId: uni.id, departmentId: cs.id })).actor();
  hodMkt = await (await person("List Hod Mkt", "hod", { universityId: uni.id, departmentId: mkt.id })).actor();
  const fac = await person("List Faculty", "permanent_faculty", { universityId: uni.id, departmentId: cs.id });
  const other = await person("List Other Faculty", "permanent_faculty", { universityId: uni.id, departmentId: cs.id });
  const mktFac = await person("List Mkt Faculty", "permanent_faculty", { universityId: uni.id, departmentId: mkt.id });

  const course = await createCourse(hodCs, { departmentId: cs.id, title: "Data Analytics", pricePaise: 0 });
  csCourse = course.id;
  const mktCourse = await createCourse(hodMkt, { departmentId: mkt.id, title: "Digital Marketing", pricePaise: 0 });
  const make = async (by: Actor, courseId: string, name: string, startDate: string, teacher: string, start = "09:00", end = "11:00", days = WEEKDAYS) =>
    (
      await createBatch(by, {
        courseId,
        name,
        startDate,
        endDate: "2031-03-31",
        seatLimit: 20,
        slots: slots(days, start, end),
        faculty: [{ userId: teacher, role: "permanent_faculty" }],
      })
    ).id;
  csMorning = await make(hodCs, course.id, "Morning", "2030-11-04", fac.user.id);
  csEvening = await make(hodCs, course.id, "Evening", "2030-12-02", other.user.id, "18:00", "20:00");
  mktWeekend = await make(hodMkt, mktCourse.id, "Weekend", "2030-11-09", mktFac.user.id, "10:00", "13:00", [6, 7]);
  // A recorded (marketplace) batch has no timetable: it never shows in the list.
  const sys = systemActorFor(uni.id);
  await withTenant(sys, (tx) => ensureRecordedBatch(tx, sys, { id: course.id, departmentId: cs.id }));

  faculty = await fac.actor();
  student = await (await person("List Student", "student", { universityId: uni.id })).actor();

  // Another institute with a batch of its own.
  const uni2 = await makeUniversity("Other Batch University");
  const d2 = await makeDepartment(uni2.id, "CS", "Computer Science");
  const hod2 = await (await person("Other Hod", "hod", { universityId: uni2.id, departmentId: d2.id })).actor();
  const fac2 = await person("Other Teacher", "permanent_faculty", { universityId: uni2.id, departmentId: d2.id });
  const c2 = await createCourse(hod2, { departmentId: d2.id, title: "Elsewhere", pricePaise: 0 });
  elsewhere = await make(hod2, c2.id, "Elsewhere batch", "2030-11-04", fac2.user.id);
  outsider = await (await person("Other Admin", "institute_admin", { universityId: uni2.id })).actor();
});

const ids = async (a: Actor) => (await listAllBatches(a)).map((b) => b.batchId);

describe("listAllBatches: every batch a person may open", () => {
  it("Institute Admin and Board see every batch of the institute, earliest start first", async () => {
    expect(await ids(admin)).toEqual([csMorning, mktWeekend, csEvening]);
    expect(await ids(board)).toEqual([csMorning, mktWeekend, csEvening]);
  });
  it("gives each row its course, timings, seats and faculty", async () => {
    const row = (await listAllBatches(admin)).find((b) => b.batchId === csMorning)!;
    expect(row).toMatchObject({ batchName: "Morning", courseTitle: "Data Analytics", seatLimit: 20, seatsTaken: 0, seatsLeft: 20, faculty: ["List Faculty"] });
    expect(row.timings).toMatch(/9 am/);
  });
  it("HOD sees only their own department's batches", async () => {
    expect(await ids(hodCs)).toEqual([csMorning, csEvening]);
    expect(await ids(hodMkt)).toEqual([mktWeekend]);
  });
  it("faculty see only the batches they teach", async () => {
    expect(await ids(faculty)).toEqual([csMorning]);
  });
  it("students and Accounts & Fees see none", async () => {
    expect(await ids(student)).toEqual([]);
    expect(await ids(accounts)).toEqual([]);
  });
  it("never crosses institutes", async () => {
    expect(await ids(outsider)).toEqual([elsewhere]);
    expect(await ids(admin)).not.toContain(elsewhere);
  });
  it("leaves out recorded batches, like a course's own batch list", async () => {
    const recorded = await systemDb().select({ id: batches.id, recorded: batches.recorded }).from(batches);
    const hidden = recorded.filter((b) => b.recorded).map((b) => b.id);
    expect(hidden.length).toBeGreaterThan(0);
    const shown = await ids(admin);
    for (const id of hidden) expect(shown).not.toContain(id);
    // Same batches as the course's own list.
    expect((await listBatches(admin, csCourse)).map((b) => b.batchId).sort()).toEqual([csMorning, csEvening].sort());
  });
});
