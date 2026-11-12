/**
 * The New course page's service: course, department, first batch, teachers and publishing
 * in one transaction, with each part's own permission and rules.
 */
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, batchSlots, batches, courses, departments, roleAssignments, users } from "@/db/schema";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { batchDateDefaults, createBatchWithTeachers, createCourseQuickly, quickCourseOptions, type QuickCourseInput } from "@/server/services/quick-course";
import { createCourse } from "@/server/services/courses";
import { eventsOfType } from "../helpers/events";
import { makeDepartment, makeUniversity, person, slots, uniqueCode } from "../fixtures";

const BATCH = { name: "Batch 1", startDate: "2031-01-06", endDate: "2031-03-30", seatLimit: 30, slots: slots([1, 3, 5], "10:00", "11:00") };

const base = (over: Partial<QuickCourseInput> = {}): QuickCourseInput => ({ title: "Spoken English", pricePaise: 0, publish: false, ...over });

async function sectionOf(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (err) => err,
  );
  expect(e).toBeInstanceOf(ValidationError);
  return { section: (e.details as { section?: string } | undefined)?.section, message: e.message as string };
}

async function rolesOf(userId: string, universityId: string) {
  return systemDb()
    .select()
    .from(roleAssignments)
    .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.universityId, universityId), isNull(roleAssignments.revokedAt)));
}

afterAll(closeDb);

describe("createCourseQuickly: everything in one go", () => {
  let uniId: string;
  let admin: Actor;
  let deptId: string;
  let facultyId: string;

  beforeAll(async () => {
    uniId = (await makeUniversity("Quick University")).id;
    admin = await (await person("Quick Admin", "institute_admin", { universityId: uniId })).actor();
    deptId = (await makeDepartment(uniId, uniqueCode("Q"), "Languages")).id;
    facultyId = (await person("Faculty Fatima", "permanent_faculty", { universityId: uniId, departmentId: deptId })).user.id;
  });

  it("creates the course, its first batch with timings and faculty, and publishes it", async () => {
    const r = await createCourseQuickly(admin, base({ departmentId: deptId, pricePaise: 499_900, gstRateBp: 1800, batch: BATCH, teacherIds: [facultyId], publish: true }));
    expect(r).toMatchObject({ departmentId: deptId, departmentCreated: false, published: true, teachersAdded: 0 });
    const db = systemDb();
    const [course] = await db.select().from(courses).where(eq(courses.id, r.courseId));
    expect(course).toMatchObject({ title: "Spoken English", status: "published", pricePaise: 499_900, gstRateBp: 1800, departmentId: deptId });
    const [batch] = await db.select().from(batches).where(eq(batches.id, r.batchId!));
    expect(batch).toMatchObject({ name: "Batch 1", seatLimit: 30, status: "open", courseId: course.id });
    expect((await db.select().from(batchSlots).where(eq(batchSlots.batchId, batch.id))).map((s) => s.weekday).sort()).toEqual([1, 3, 5]);
    const onBatch = await db.select().from(roleAssignments).where(eq(roleAssignments.batchId, batch.id));
    expect(onBatch.map((a) => [a.userId, a.role])).toEqual([[facultyId, "permanent_faculty"]]);
    // Every write is audited, the parts and the whole.
    const actions = (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.universityId, uniId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["course.create", "batch.create", "batch.assign_faculty", "course.update", "course.quick_create"]));
  });

  it("creates only the course when there is no batch, and leaves it as a draft", async () => {
    const r = await createCourseQuickly(admin, base({ departmentId: deptId, title: "Hindi basics" }));
    expect(r.batchId).toBeNull();
    const [course] = await systemDb().select().from(courses).where(eq(courses.id, r.courseId));
    expect(course.status).toBe("draft");
  });

  it("keeps the course a draft when publish is off, even with a batch", async () => {
    const r = await createCourseQuickly(admin, base({ departmentId: deptId, title: "French A1", batch: BATCH, teacherIds: [facultyId], publish: false }));
    const [course] = await systemDb().select().from(courses).where(eq(courses.id, r.courseId));
    expect(course.status).toBe("draft");
    expect(r.batchId).not.toBeNull();
  });

  it("refuses to publish without a batch, naming the part to fix", async () => {
    const e = await sectionOf(createCourseQuickly(admin, base({ departmentId: deptId, publish: true })));
    expect(e.section).toBe("publish");
  });

  it("puts each validation error in its section", async () => {
    expect((await sectionOf(createCourseQuickly(admin, base({ title: "X", departmentId: deptId })))).section).toBe("course");
    expect((await sectionOf(createCourseQuickly(admin, base({ pricePaise: -1, departmentId: deptId })))).section).toBe("course");
    expect((await sectionOf(createCourseQuickly(admin, base({ batch: { ...BATCH, endDate: "2030-01-01" }, teacherIds: [facultyId], departmentId: deptId })))).section).toBe("batch");
    expect((await sectionOf(createCourseQuickly(admin, base({ batch: { ...BATCH, slots: [] }, teacherIds: [facultyId], departmentId: deptId })))).section).toBe("batch");
    const noTeacher = await sectionOf(createCourseQuickly(admin, base({ batch: BATCH, departmentId: deptId })));
    expect(noTeacher.section).toBe("teachers");
    expect(noTeacher.message).toMatch(/I'll teach it myself/);
    expect((await sectionOf(createCourseQuickly(admin, base({ newTeachers: [{ name: "No Mail", email: "nope" }], departmentId: deptId })))).section).toBe("teachers");
  });
});

describe("createCourseQuickly: an empty institute", () => {
  it("makes the department inline when the institute has none", async () => {
    const uniId = (await makeUniversity("Empty Institute")).id;
    const admin = await (await person("Empty Admin", "institute_admin", { universityId: uniId })).actor();
    const r = await createCourseQuickly(admin, base({ newDepartmentName: "General" }));
    expect(r.departmentCreated).toBe(true);
    const [dept] = await systemDb().select().from(departments).where(eq(departments.id, r.departmentId));
    expect(dept).toMatchObject({ name: "General", code: "GEN", universityId: uniId });
    // A second department with a similar name gets a free code instead of a clash.
    const again = await createCourseQuickly(admin, base({ newDepartmentName: "General", title: "Second course" }));
    const [second] = await systemDb().select().from(departments).where(eq(departments.id, again.departmentId));
    expect(second.code).toBe("GEN2");
  });

  it("\"I'll teach it myself\" makes the admin teaching staff of the department and of the batch", async () => {
    const uniId = (await makeUniversity("Owner Teaches")).id;
    const admin = await (await person("Owner Olga", "institute_admin", { universityId: uniId })).actor();
    const r = await createCourseQuickly(admin, base({ newDepartmentName: "Music", batch: BATCH, teachMyself: true, publish: true }));
    const roles = await rolesOf(admin.userId, uniId);
    expect(roles.some((a) => a.role === "permanent_faculty" && a.departmentId === r.departmentId)).toBe(true);
    expect(roles.some((a) => a.role === "permanent_faculty" && a.batchId === r.batchId)).toBe(true);
    expect(roles.some((a) => a.role === "institute_admin")).toBe(true);
    expect(r.published).toBe(true);
    // Running it again in the same department doesn't add a second department role.
    const again = await createCourseQuickly(await loadActor(admin.userId, uniId), base({ departmentId: r.departmentId, title: "Guitar", batch: BATCH, teachMyself: true }));
    const after = await rolesOf(admin.userId, uniId);
    expect(after.filter((a) => a.role === "permanent_faculty" && a.departmentId === r.departmentId)).toHaveLength(1);
    expect(after.some((a) => a.batchId === again.batchId)).toBe(true);
  });

  it("adds a new teacher inline: department staff, on the batch, and invited", async () => {
    const uniId = (await makeUniversity("New Teacher U")).id;
    const admin = await (await person("Admin Anil", "institute_admin", { universityId: uniId })).actor();
    const email = `priya.${uniqueCode("T").toLowerCase()}@quick.test`;
    const r = await createCourseQuickly(admin, base({ newDepartmentName: "Commerce", batch: BATCH, newTeachers: [{ name: "Priya Nair", email }] }));
    expect(r.teachersAdded).toBe(1);
    const [u] = await systemDb().select().from(users).where(eq(users.email, email));
    const roles = await rolesOf(u.id, uniId);
    expect(roles.some((a) => a.role === "permanent_faculty" && a.departmentId === r.departmentId)).toBe(true);
    expect(roles.some((a) => a.batchId === r.batchId)).toBe(true);
    const invites = (await eventsOfType("user.invited", uniId)).filter((e) => (e.payload as { userId: string }).userId === u.id);
    expect(invites).toHaveLength(1);
  });

  it("rolls everything back when a later part fails", async () => {
    const uniId = (await makeUniversity("Rollback U")).id;
    const admin = await (await person("Admin Rita", "institute_admin", { universityId: uniId })).actor();
    const outsider = await person("Not Staff", "student", { universityId: uniId });
    const email = `ravi.${uniqueCode("R").toLowerCase()}@quick.test`;
    // The department, course and new teacher are written first; the batch then fails on a
    // "teacher" who isn't teaching staff of the department.
    const e = await sectionOf(
      createCourseQuickly(admin, base({ newDepartmentName: "Science", batch: BATCH, newTeachers: [{ name: "Ravi Rao", email }], teacherIds: [outsider.user.id], publish: true })),
    );
    expect(e.section).toBe("batch");
    const db = systemDb();
    expect(await db.select().from(departments).where(eq(departments.universityId, uniId))).toHaveLength(0);
    expect(await db.select().from(courses).where(eq(courses.universityId, uniId))).toHaveLength(0);
    expect(await db.select().from(batches).where(eq(batches.universityId, uniId))).toHaveLength(0);
    const [ravi] = await db.select().from(users).where(eq(users.email, email));
    expect(ravi).toBeUndefined();
    expect(await eventsOfType("user.invited", uniId)).toHaveLength(0);
    expect((await db.select().from(auditLog).where(eq(auditLog.universityId, uniId))).map((a) => a.action)).toEqual([]);
  });
});

describe("createCourseQuickly: permissions", () => {
  let uniId: string;
  let deptId: string;
  let otherDeptId: string;
  let hod: Actor;
  let faculty: Actor;
  let student: Actor;

  beforeAll(async () => {
    uniId = (await makeUniversity("Perm University")).id;
    deptId = (await makeDepartment(uniId, uniqueCode("P"), "Physics")).id;
    otherDeptId = (await makeDepartment(uniId, uniqueCode("C"), "Chemistry")).id;
    hod = await (await person("Hod Harsh", "hod", { universityId: uniId, departmentId: deptId })).actor();
    faculty = await (await person("Fac Farhan", "permanent_faculty", { universityId: uniId, departmentId: deptId })).actor();
    student = await (await person("Stu Sana", "student", { universityId: uniId })).actor();
  });

  it("a HOD creates a course with a batch they teach, in their own department (allow)", async () => {
    const r = await createCourseQuickly(hod, base({ departmentId: deptId, batch: BATCH, teachMyself: true, publish: true }));
    expect(r.published).toBe(true);
    // A HOD already teaches there, so no extra department role is given.
    const roles = await rolesOf(hod.userId, uniId);
    expect(roles.filter((a) => a.departmentId === deptId).map((a) => a.role)).toEqual(["hod"]);
  });

  it("a HOD adds a new teacher to their own department (allow)", async () => {
    const r = await createCourseQuickly(hod, base({ departmentId: deptId, title: "Optics", batch: BATCH, newTeachers: [{ name: "Neha Shah", email: `neha.${uniqueCode().toLowerCase()}@quick.test` }] }));
    expect(r.teachersAdded).toBe(1);
  });

  it("a HOD can't create a course in another department (deny)", async () => {
    await expect(createCourseQuickly(hod, base({ departmentId: otherDeptId }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a HOD can't make a new department (deny), and is told in the department section", async () => {
    const e = await sectionOf(createCourseQuickly(hod, base({ newDepartmentName: "Biology" })));
    expect(e.section).toBe("department");
    expect(await systemDb().select().from(departments).where(and(eq(departments.universityId, uniId), eq(departments.name, "Biology")))).toHaveLength(0);
  });

  it("faculty and students can't create courses (deny)", async () => {
    await expect(createCourseQuickly(faculty, base({ departmentId: deptId }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createCourseQuickly(student, base({ departmentId: deptId }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await sectionOf(createCourseQuickly(faculty, base({ newDepartmentName: "Art" })))).section).toBe("department");
  });

  it("the form's options follow the same permissions", async () => {
    const forHod = await quickCourseOptions(hod, "Asia/Kolkata");
    expect(forHod.departments.map((d) => d.id)).toEqual([deptId]);
    expect(forHod.canCreateDepartment).toBe(false);
    expect(forHod.departments[0].canAddTeachers).toBe(true);
    expect(forHod.canAddTeachersAnywhere).toBe(false);
    const forFaculty = await quickCourseOptions(faculty, "Asia/Kolkata");
    expect(forFaculty.departments).toEqual([]);
    expect(forFaculty.canCreateDepartment).toBe(false);
  });
});

describe("createBatchWithTeachers: the course page's batch form", () => {
  let uniId: string;
  let admin: Actor;
  let courseId: string;
  let deptId: string;

  beforeAll(async () => {
    uniId = (await makeUniversity("Batch Form U")).id;
    admin = await (await person("Batch Admin", "institute_admin", { universityId: uniId })).actor();
    deptId = (await makeDepartment(uniId, uniqueCode("B"), "Business")).id;
    courseId = (await createCourse(admin, { departmentId: deptId, title: "Accounts", pricePaise: 0 })).id;
  });

  it("adds the admin as teaching staff instead of failing (\"I'll teach it myself\")", async () => {
    const b = await createBatchWithTeachers(admin, { courseId, ...BATCH, teacherIds: [], teachMyself: true });
    const roles = await rolesOf(admin.userId, uniId);
    expect(roles.some((a) => a.departmentId === deptId && a.role === "permanent_faculty")).toBe(true);
    expect(roles.some((a) => a.batchId === b.id)).toBe(true);
  });

  it("adds a new teacher in the same step", async () => {
    const email = `tara.${uniqueCode().toLowerCase()}@quick.test`;
    const b = await createBatchWithTeachers(admin, { courseId, ...BATCH, name: "Evening", teacherIds: [], newTeachers: [{ name: "Tara Iyer", email }] });
    const [u] = await systemDb().select().from(users).where(eq(users.email, email));
    expect((await rolesOf(u.id, uniId)).some((a) => a.batchId === b.id)).toBe(true);
  });

  it("still needs at least one teacher", async () => {
    await expect(createBatchWithTeachers(admin, { courseId, ...BATCH, teacherIds: [] })).rejects.toThrow(/at least one faculty/);
  });

  it("faculty can't add batches or teachers (deny)", async () => {
    const fac = await (await person("Fac Only", "permanent_faculty", { universityId: uniId, departmentId: deptId })).actor();
    await expect(createBatchWithTeachers(fac, { courseId, ...BATCH, teacherIds: [fac.userId] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("batch date defaults", () => {
  it("start on the next Monday and run 12 weeks", () => {
    expect(batchDateDefaults("2026-11-12")).toEqual({ startDate: "2026-11-16", endDate: "2027-02-07" });
    // On a Monday, the next one is a week away.
    expect(batchDateDefaults("2026-11-16").startDate).toBe("2026-11-23");
  });
});
