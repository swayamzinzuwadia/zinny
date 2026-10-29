import { randomUUID } from "node:crypto";
import { systemDb } from "@/db/client";
import { departments, roleAssignments, universities, users, type RoleName } from "@/db/schema";
import { loadActor } from "@/server/actor";

// 12 hex characters: with every module's tests sharing one database, 6 collided now and then.
const tag = () => randomUUID().replace(/-/g, "").slice(0, 12);

/** A short unique code like "D3F9A1", for unique columns (department codes, slugs) in test data. */
export const uniqueCode = (prefix = "D") => `${prefix}${randomUUID().slice(0, 6).toUpperCase()}`;

export async function makeUniversity(name = "Test University") {
  const slug = `t-${tag()}`;
  const [u] = await systemDb()
    .insert(universities)
    .values({ name, slug, invoicePrefix: "TU", gstin: "27AAAAA0000A1Z5", legalName: `${name} Trust` })
    .returning();
  return u;
}

export async function makeUser(name: string) {
  const [u] = await systemDb()
    .insert(users)
    .values({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}.${tag()}@test.zinny` })
    .returning();
  return u;
}

export async function grant(
  userId: string,
  role: RoleName,
  scope: { universityId?: string; departmentId?: string; batchId?: string } = {},
  endsAt: Date | null = null,
) {
  const scopeType = scope.batchId ? "batch" : scope.departmentId ? "department" : scope.universityId ? "university" : "platform";
  await systemDb()
    .insert(roleAssignments)
    .values({
      userId,
      role,
      scopeType,
      universityId: scope.universityId ?? null,
      departmentId: scope.batchId ? null : (scope.departmentId ?? null),
      batchId: scope.batchId ?? null,
      endsAt,
    });
}

export async function makeDepartment(universityId: string, code: string, name: string) {
  const [d] = await systemDb().insert(departments).values({ universityId, code, name }).returning();
  return d;
}

/** A person with one role, returned as a ready-to-use actor. */
export async function person(
  name: string,
  role: RoleName,
  scope: { universityId?: string; departmentId?: string; batchId?: string },
  endsAt: Date | null = null,
) {
  const u = await makeUser(name);
  await grant(u.id, role, scope, endsAt);
  return { user: u, actor: () => loadActor(u.id, scope.universityId ?? null) };
}

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const slots = (days: number[], start: string, end: string) => days.map((weekday) => ({ weekday, startTime: start, endTime: end }));

/**
 * A university with one department, a HOD, a faculty member and a published course with
 * one open batch (Mon–Fri 09:00–11:00, from 2030-11-04). Price 0 = free enrolment.
 */
export async function setupCourse(opts: { name?: string; pricePaise?: number; seatLimit?: number } = {}) {
  const { createCourse, updateCourse } = await import("@/server/services/courses");
  const { createBatch } = await import("@/server/services/batches");
  const uni = await makeUniversity(opts.name ?? "Course University");
  const dept = await makeDepartment(uni.id, "CS", "Computer Science");
  const admin = await (await person("Admin Asha", "institute_admin", { universityId: uni.id })).actor();
  const hod = await (await person("Hod Hema", "hod", { universityId: uni.id, departmentId: dept.id })).actor();
  const fac = await person("Faculty Farah", "permanent_faculty", { universityId: uni.id, departmentId: dept.id });
  const course = await createCourse(hod, { departmentId: dept.id, title: "Data Analytics", pricePaise: opts.pricePaise ?? 0 });
  const batch = await createBatch(hod, {
    courseId: course.id,
    name: "Weekday morning",
    startDate: "2030-11-04",
    endDate: "2031-01-31",
    seatLimit: opts.seatLimit ?? 20,
    slots: slots(WEEKDAYS, "09:00", "11:00"),
    faculty: [{ userId: fac.user.id, role: "permanent_faculty" }],
  });
  await updateCourse(hod, course.id, { status: "published" });
  const student = async (name: string) => (await person(name, "student", { universityId: uni.id })).actor();
  return { uni, dept, admin, hod, facultyUserId: fac.user.id, course, batch, student };
}
