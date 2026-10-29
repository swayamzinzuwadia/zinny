/**
 * Small read helpers for modules (contracts.md section 8). They take an open tenant
 * transaction (from withTenant), so row-level security already limits them to one
 * university; the caller checks permissions. Missing or invisible records throw NotFoundError.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses, enrolments, universities, users } from "@/db/schema";
import type { BatchLite, CourseLite, EnrolmentLite, PersonLite, StudentEnrolment, UniversityLite } from "@/contracts/core";
import { isActive, type Actor } from "../authz/engine";
import { NotFoundError } from "../errors";
import { todayIn } from "../lib/dates";

/** The university this transaction works in. */
export async function universityLite(tx: Tx): Promise<UniversityLite> {
  const [u] = await tx
    .select({
      id: universities.id,
      slug: universities.slug,
      name: universities.name,
      timezone: universities.timezone,
      legalName: universities.legalName,
      gstin: universities.gstin,
      branding: universities.branding,
    })
    .from(universities)
    .where(sql`${universities.id} = zinny_current_university()`);
  if (!u) throw new NotFoundError("University");
  return u;
}

/** Today, "YYYY-MM-DD", in the university's time zone. */
export async function todayFor(tx: Tx): Promise<string> {
  return todayIn((await universityLite(tx)).timezone);
}

/** Name and email of people visible in this university, in the order asked for. Unknown ids are left out. */
export async function peopleLite(tx: Tx, userIds: readonly string[]): Promise<PersonLite[]> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return [];
  const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

export async function getCourseLite(tx: Tx, courseId: string): Promise<CourseLite> {
  const [c] = await tx
    .select({
      id: courses.id,
      title: courses.title,
      departmentId: courses.departmentId,
      programId: courses.programId,
      status: courses.status,
      certificateEnabled: courses.certificateEnabled,
      pricePaise: courses.pricePaise,
    })
    .from(courses)
    .where(eq(courses.id, courseId));
  if (!c) throw new NotFoundError("Course");
  return c;
}

function toBatchLite(b: typeof batches.$inferSelect): BatchLite {
  return {
    id: b.id,
    courseId: b.courseId,
    departmentId: b.departmentId,
    name: b.name,
    startDate: b.startDate,
    endDate: b.endDate,
    seatLimit: b.seatLimit,
    status: b.status,
    meetingUrl: b.meetingUrl,
    target: { universityId: b.universityId, departmentIds: [b.departmentId], batchIds: [b.id] },
  };
}

export async function batchLite(tx: Tx, batchId: string): Promise<BatchLite> {
  const [b] = await tx.select().from(batches).where(eq(batches.id, batchId));
  if (!b) throw new NotFoundError("Batch");
  return toBatchLite(b);
}

/** Every batch of a course, earliest start first. */
export async function listCourseBatches(tx: Tx, courseId: string): Promise<BatchLite[]> {
  const rows = await tx.select().from(batches).where(eq(batches.courseId, courseId)).orderBy(asc(batches.startDate), asc(batches.name));
  return rows.map(toBatchLite);
}

/** Batches the actor teaches right now (active faculty assignments in their current university). */
export function facultyBatchIds(actor: Actor, now = new Date()): string[] {
  return [
    ...new Set(
      actor.assignments
        .filter((a) => a.scopeType === "batch" && a.batchId && a.universityId === actor.universityId && isActive(a, now))
        .filter((a) => a.role === "permanent_faculty" || a.role === "visiting_faculty")
        .map((a) => a.batchId!),
    ),
  ];
}

/** Students with an active enrolment in the batch. */
export async function batchStudentIds(tx: Tx, batchId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: enrolments.userId })
    .from(enrolments)
    .where(and(eq(enrolments.batchId, batchId), eq(enrolments.status, "active")));
  return rows.map((r) => r.userId);
}

/**
 * Every enrolment of a student in this university, oldest first, in any status
 * ("active" = learning now, "completed", "ended" at graduation, "held" while paying,
 * "cancelled", "expired"). Filter on status for what you need.
 */
export async function studentEnrolments(tx: Tx, userId: string): Promise<StudentEnrolment[]> {
  const rows = await tx
    .select({ enrolmentId: enrolments.id, courseId: enrolments.courseId, batchId: enrolments.batchId, status: enrolments.status })
    .from(enrolments)
    .where(eq(enrolments.userId, userId))
    .orderBy(asc(enrolments.createdAt));
  return rows;
}

export async function enrolmentById(tx: Tx, enrolmentId: string): Promise<EnrolmentLite> {
  const [e] = await tx
    .select({
      enrolmentId: enrolments.id,
      userId: enrolments.userId,
      courseId: enrolments.courseId,
      batchId: enrolments.batchId,
      status: enrolments.status,
      enrolledAt: enrolments.enrolledAt,
    })
    .from(enrolments)
    .where(eq(enrolments.id, enrolmentId));
  if (!e) throw new NotFoundError("Enrolment");
  return e;
}
