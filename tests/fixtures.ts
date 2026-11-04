import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { systemDb } from "@/db/client";
import { batches, courses, departments, orders, roleAssignments, studentDepartments, universities, users, type RoleName } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { ensureRecordedBatch, systemActorFor, withTenant, type Actor } from "@/server/core";
import { holdRecordedSeat } from "@/server/services/enrolment";

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
  // Students only see the courses of their departments: like existing students on a real
  // institute, test students are placed in every department the university has so far.
  if ((role === "student" || role === "alumni") && scope.universityId) {
    const depts = await systemDb().select({ id: departments.id }).from(departments).where(eq(departments.universityId, scope.universityId));
    if (depts.length)
      await systemDb()
        .insert(studentDepartments)
        .values(depts.map((d) => ({ universityId: scope.universityId!, userId, departmentId: d.id })))
        .onConflictDoNothing();
  }
}

export async function makeDepartment(universityId: string, code: string, name: string) {
  const [d] = await systemDb().insert(departments).values({ universityId, code, name }).returning();
  // Test students belong to every department (see grant), including ones made after them.
  const learners = await systemDb()
    .select({ userId: roleAssignments.userId })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.universityId, universityId), inArray(roleAssignments.role, ["student", "alumni"])));
  if (learners.length)
    await systemDb()
      .insert(studentDepartments)
      .values(learners.map((l) => ({ universityId, userId: l.userId, departmentId: d.id })))
      .onConflictDoNothing();
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

/**
 * Starts a marketplace purchase of the course that `batchId` belongs to: its recordings, at the
 * course's price. Returns the held seat and its pending order. The institute's own batches are
 * free for its students, so marketplace purchases are the only orders there are.
 */
export async function buyRecordings(student: Actor, batchId: string) {
  const db = systemDb();
  const [b] = await db.select().from(batches).where(eq(batches.id, batchId));
  const [course] = await db.select().from(courses).where(eq(courses.id, b.courseId));
  const sys = systemActorFor(course.universityId);
  const recorded = b.recorded ? b : await withTenant(sys, (tx) => ensureRecordedBatch(tx, sys, course));
  const held = await holdRecordedSeat(student, { batchId: recorded.id, pricePaise: course.pricePaise });
  const [order] = await db.select().from(orders).where(eq(orders.id, held.orderId));
  return { ...held, order, recordedBatchId: recorded.id };
}
