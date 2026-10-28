import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { createDepartment, listDepartments, setHod } from "@/server/services/departments";
import { createCourse, updateCourse } from "@/server/services/courses";
import { createBatch } from "@/server/services/batches";
import { holdSeat, myLearning } from "@/server/services/enrolment";
import { studentTimetable } from "@/server/services/timetable";
import { graduate, importPeople, linkParent, listPeople } from "@/server/services/users";
import { createProgram } from "@/server/services/departments";
import { makeUniversity, person, slots } from "./fixtures";

let uniId: string;
let admin: Actor;

beforeAll(async () => {
  uniId = (await makeUniversity("Import University")).id;
  admin = await (await person("Asha Admin", "institute_admin", { universityId: uniId })).actor();
  await createDepartment(admin, { code: "CS", name: "Computer Science" });
  await createDepartment(admin, { code: "MKT", name: "Marketing" });
});
afterAll(closeDb);

const CSV = `name,email,phone,role,department,access_ends
Ravi Kumar,ravi@import.test,9800000001,student,,
Neha Shah,neha@import.test,,permanent_faculty,CS,
Dev Rao,dev@import.test,,visiting_faculty,CS,2031-03-31
Meera Iyer,meera@import.test,,hod,MKT,`;

describe("PRD page 7: bulk import by CSV", () => {
  it("checks every row first and saves nothing if one is wrong", async () => {
    const bad = `${CSV}\nNo Email,,,student,,\nX Y,x@import.test,,wizard,,\nZ Z,z@import.test,,hod,LAW,`;
    const res = await importPeople(admin, bad, { commit: true });
    expect(res.saved).toBe(0);
    expect(res.errors).toBe(3);
    expect(res.rows.filter((r) => !r.ok).map((r) => r.line)).toEqual([6, 7, 8]);
    expect(await listPeople(admin, "students")).toHaveLength(0);
  });

  it("imports a clean file into the right groups", async () => {
    const preview = await importPeople(admin, CSV, { commit: false });
    expect(preview).toMatchObject({ total: 4, errors: 0, saved: 0 });
    const res = await importPeople(admin, CSV, { commit: true });
    expect(res.saved).toBe(4);
    expect((await listPeople(admin, "students")).map((p) => p.name)).toEqual(["Ravi Kumar"]);
    const teaching = await listPeople(admin, "teaching");
    expect(teaching.map((p) => `${p.name}:${p.roles[0].label}:${p.roles[0].scope}`)).toEqual([
      "Dev Rao:Visiting Faculty:Computer Science",
      "Meera Iyer:Head of Department:Marketing",
      "Neha Shah:Permanent Faculty:Computer Science",
    ]);
  });

  it("re-importing the same file doesn't duplicate anyone", async () => {
    await importPeople(admin, CSV, { commit: true });
    expect(await listPeople(admin, "teaching")).toHaveLength(3);
  });

  it("departments show their HOD", async () => {
    const depts = await listDepartments(admin);
    expect(depts.find((d) => d.code === "MKT")?.hods).toEqual(["Meera Iyer"]);
    expect(depts.find((d) => d.code === "CS")).toMatchObject({ facultyCount: 2, hods: [] });
  });

  it("only admins can bulk import", async () => {
    const mkt = (await listDepartments(admin)).find((d) => d.code === "MKT")!;
    const hod = await (await person("Some HOD", "hod", { universityId: uniId, departmentId: mkt.id })).actor();
    await expect(importPeople(hod, CSV, { commit: false })).rejects.toThrow(/access/);
  });
});

describe("PRD page 7: alumni and parents", () => {
  it("graduation keeps standalone courses but removes program courses", async () => {
    const cs = (await listDepartments(admin)).find((d) => d.code === "CS")!;
    const neha = (await listPeople(admin, "teaching")).find((p) => p.name === "Neha Shah")!;
    await setHod(admin, cs.id, neha.id);
    const program = await createProgram(admin, { departmentId: cs.id, name: "BTech AI" });
    const mk = async (title: string, programId: string | null) => {
      const c = await createCourse(admin, { departmentId: cs.id, title, pricePaise: 0, programId });
      const b = await createBatch(admin, {
        courseId: c.id,
        name: "Main",
        startDate: "2030-11-04",
        endDate: "2031-03-31",
        seatLimit: 50,
        slots: slots([1], title === "Semester 1" ? "09:00" : "14:00", title === "Semester 1" ? "11:00" : "16:00"),
        faculty: [{ userId: neha.id, role: "permanent_faculty" }],
      });
      await updateCourse(admin, c.id, { status: "published" });
      return b.id;
    };
    const sem1 = await mk("Semester 1", program.id);
    const elective = await mk("Photography elective", null);

    const ravi = (await listPeople(admin, "students")).find((p) => p.name === "Ravi Kumar")!;
    const raviActor = await loadActor(ravi.id, uniId);
    await holdSeat(raviActor, { batchId: sem1 });
    await holdSeat(raviActor, { batchId: elective });
    expect(await myLearning(raviActor)).toHaveLength(2);

    expect(await graduate(admin, ravi.id)).toEqual({ endedEnrolments: 1 });
    const after = await loadActor(ravi.id, uniId);
    expect(after.assignments.map((a) => a.role)).toEqual(["alumni"]);
    expect((await myLearning(after)).map((l) => l.course.title)).toEqual(["Photography elective"]);
  });

  it("a linked parent sees their child's timetable and nobody else's", async () => {
    const student = await (await person("Kid Kiran", "student", { universityId: uniId })).actor();
    const other = await (await person("Other Kid", "student", { universityId: uniId })).actor();
    const parentId = await linkParent(admin, { studentUserId: student.userId, parentEmail: "parent@import.test", parentName: "Pallavi Parent" });
    const parent = await loadActor(parentId, uniId);
    await expect(studentTimetable(parent, undefined, student.userId)).resolves.toHaveProperty("sessions");
    await expect(studentTimetable(parent, undefined, other.userId)).rejects.toThrow(/not found/);
  });
});
