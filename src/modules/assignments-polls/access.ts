/**
 * Who may do what with an assignment (brief: "Faculty manage and grade assignments for
 * their own batches; HODs for their department; admins everywhere").
 *
 * Every check is made per batch, against `{ universityId, departmentIds: [dept], batchIds: [batch] }`,
 * so a faculty member's batch assignment, a HOD's department and an admin's university all
 * work through the one engine. Changing a course-wide assignment needs the action on every
 * batch it covers (or the department, when the course has no batches yet).
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses } from "@/db/schema";
import { can, studentEnrolments, type Action, type Actor, type Target } from "@/server/core";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { asgnAssignmentBatches, asgnAssignments } from "./schema";

export type AssignmentRow = typeof asgnAssignments.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

/** Ids come from URLs and forms: anything that isn't an id is simply "not found". */
export function need(id: unknown, what: string): string {
  if (!isUuid(id)) throw new NotFoundError(what);
  return id;
}

export function uni(actor: Actor): string {
  if (!actor.universityId) throw new ForbiddenError("No university selected.");
  return actor.universityId;
}

export function batchTarget(universityId: string, departmentId: string, batchId: string): Target {
  return { universityId, departmentIds: [departmentId], batchIds: [batchId] };
}

export function deptTarget(universityId: string, departmentId: string): Target {
  return { universityId, departmentIds: [departmentId] };
}

export function ownTarget(actor: Actor): Target {
  return { universityId: uni(actor), ownerUserId: actor.userId };
}

/** Batch ids of a course, earliest first. */
export async function courseBatchIds(tx: Tx, courseId: string): Promise<string[]> {
  const rows = await tx.select({ id: batches.id }).from(batches).where(eq(batches.courseId, courseId)).orderBy(batches.startDate, batches.name);
  return rows.map((r) => r.id);
}

/** The batches an assignment is for. */
export async function coveredBatchIds(tx: Tx, a: Pick<AssignmentRow, "id" | "courseId" | "allBatches">): Promise<string[]> {
  if (a.allBatches) return courseBatchIds(tx, a.courseId);
  const rows = await tx.select({ id: asgnAssignmentBatches.batchId }).from(asgnAssignmentBatches).where(eq(asgnAssignmentBatches.assignmentId, a.id));
  return rows.map((r) => r.id);
}

/** Covered batches for many assignments at once. */
export async function coveredBatchMap(tx: Tx, list: Pick<AssignmentRow, "id" | "courseId" | "allBatches">[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (list.length === 0) return out;
  const courseIds = [...new Set(list.filter((a) => a.allBatches).map((a) => a.courseId))];
  const byCourse = new Map<string, string[]>();
  if (courseIds.length) {
    const bs = await tx.select({ id: batches.id, courseId: batches.courseId }).from(batches).where(inArray(batches.courseId, courseIds)).orderBy(batches.startDate, batches.name);
    for (const b of bs) byCourse.set(b.courseId, [...(byCourse.get(b.courseId) ?? []), b.id]);
  }
  const specific = list.filter((a) => !a.allBatches).map((a) => a.id);
  const links = specific.length
    ? await tx.select().from(asgnAssignmentBatches).where(inArray(asgnAssignmentBatches.assignmentId, specific))
    : [];
  for (const a of list) {
    out.set(a.id, a.allBatches ? (byCourse.get(a.courseId) ?? []) : links.filter((l) => l.assignmentId === a.id).map((l) => l.batchId));
  }
  return out;
}

/** The batches (of `batchIds`) where the actor holds `action` for this department. */
export function batchesWhere(actor: Actor, action: Action, departmentId: string, batchIds: readonly string[]): string[] {
  const u = uni(actor);
  return batchIds.filter((b) => can(actor, action, batchTarget(u, departmentId, b)));
}

/** Holds `action` on every one of the batches (or on the department when there are none). */
export function canOnAll(actor: Actor, action: Action, departmentId: string, batchIds: readonly string[]): boolean {
  if (batchIds.length === 0) return can(actor, action, deptTarget(uni(actor), departmentId));
  return batchesWhere(actor, action, departmentId, batchIds).length === batchIds.length;
}

export type StaffAccess = {
  covered: string[];
  /** Batches whose work the actor can see (status and marks). */
  viewBatchIds: string[];
  /** Batches whose work the actor can grade (and whose files they can open). */
  gradeBatchIds: string[];
  /** May edit or delete the assignment itself. */
  manage: boolean;
};

export function staffAccess(actor: Actor, a: Pick<AssignmentRow, "departmentId">, covered: string[]): StaffAccess {
  const viewBatchIds = batchesWhere(actor, "assignment.view", a.departmentId, covered);
  const deptView = covered.length === 0 && can(actor, "assignment.view", deptTarget(uni(actor), a.departmentId));
  return {
    covered,
    viewBatchIds: deptView ? [] : viewBatchIds,
    gradeBatchIds: batchesWhere(actor, "assignment.grade", a.departmentId, covered),
    manage: canOnAll(actor, "assignment.manage", a.departmentId, covered),
  };
}

export function canSeeAsStaff(actor: Actor, a: Pick<AssignmentRow, "departmentId">, covered: string[]) {
  if (covered.length === 0) return can(actor, "assignment.view", deptTarget(uni(actor), a.departmentId));
  return batchesWhere(actor, "assignment.view", a.departmentId, covered).length > 0;
}

/** Loads an assignment for staff, or "not found" when the actor can't see it at all. */
export async function loadForStaff(tx: Tx, actor: Actor, assignmentId: string, opts: { lock?: boolean } = {}) {
  need(assignmentId, "Assignment");
  const q = tx.select().from(asgnAssignments).where(eq(asgnAssignments.id, assignmentId));
  const [a] = opts.lock ? await q.for("update") : await q;
  if (!a) throw new NotFoundError("Assignment");
  const covered = await coveredBatchIds(tx, a);
  if (!canSeeAsStaff(actor, a, covered)) throw new NotFoundError("Assignment");
  return { a, access: staffAccess(actor, a, covered) };
}

export type LearnerSeat = { enrolmentId: string; courseId: string; batchId: string; status: string };

/** The student's seats that count for assignments: active (can submit) and completed (can read their work). */
export async function learnerSeats(tx: Tx, userId: string): Promise<LearnerSeat[]> {
  return (await studentEnrolments(tx, userId)).filter((e) => e.status === "active" || e.status === "completed");
}

/** The student's seat in an assignment's course, if that seat's batch is one the assignment is for. */
export function seatFor(seats: LearnerSeat[], a: Pick<AssignmentRow, "courseId">, covered: string[]): LearnerSeat | null {
  const inCourse = seats.filter((s) => s.courseId === a.courseId && covered.includes(s.batchId));
  return inCourse.find((s) => s.status === "active") ?? inCourse[0] ?? null;
}

/** Course titles and batch names for display. Core tables are read directly, as contracts section 6 allows. */
export async function names(tx: Tx, courseIds: string[], batchIds: string[]) {
  const cs = courseIds.length ? await tx.select({ id: courses.id, title: courses.title }).from(courses).where(inArray(courses.id, [...new Set(courseIds)])) : [];
  const bs = batchIds.length
    ? await tx.select({ id: batches.id, name: batches.name, courseId: batches.courseId }).from(batches).where(inArray(batches.id, [...new Set(batchIds)]))
    : [];
  return { course: new Map(cs.map((c) => [c.id, c.title])), batch: new Map(bs.map((b) => [b.id, b.name])) };
}

/** Assignments covering any of these batches (course-wide ones through their course). */
export async function assignmentsForBatches(tx: Tx, seats: { courseId: string; batchId: string }[]): Promise<AssignmentRow[]> {
  if (seats.length === 0) return [];
  const courseIds = [...new Set(seats.map((s) => s.courseId))];
  const batchIds = [...new Set(seats.map((s) => s.batchId))];
  const courseWide = await tx
    .select()
    .from(asgnAssignments)
    .where(and(inArray(asgnAssignments.courseId, courseIds), eq(asgnAssignments.allBatches, true)));
  const linked = await tx
    .select({ a: asgnAssignments })
    .from(asgnAssignments)
    .innerJoin(asgnAssignmentBatches, eq(asgnAssignmentBatches.assignmentId, asgnAssignments.id))
    .where(inArray(asgnAssignmentBatches.batchId, batchIds));
  const seen = new Map<string, AssignmentRow>();
  for (const a of [...courseWide, ...linked.map((r) => r.a)]) seen.set(a.id, a);
  return [...seen.values()];
}
