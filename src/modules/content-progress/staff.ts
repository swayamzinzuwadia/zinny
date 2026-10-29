/**
 * The staff side of progress (PRD page 8): every student of a batch with their %, last
 * activity and a "Mark complete" action for courses finished offline, and the report
 * "Course and batch progress".
 *
 *   content.view_progress  Admin, Board, HOD (own department), faculty (own batches)
 *   enrolment.complete     Admin, HOD: marks an enrolment complete through core
 */
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses, departments, enrolments } from "@/db/schema";
import type { ReportParams, ReportResult } from "@/contracts/module";
import {
  assertCan,
  batchLite,
  can,
  getCourseLite,
  markEnrolmentCompleted,
  peopleLite,
  reach,
  universityLite,
  withTenant,
  type Actor,
} from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { isUuid, uni } from "./internal";
import { isDate } from "./lib/dates";
import { coursePercent } from "./lib/kinds";
import { contentCourseProgress, contentLessonProgress, contentLessons } from "./schema";

export type StudentProgress = {
  enrolmentId: string;
  userId: string;
  name: string;
  email: string;
  status: "active" | "completed";
  percent: number;
  done: number;
  total: number;
  /** Lessons opened or completed (required or not). */
  started: number;
  lastActivityAt: Date | null;
  /** Completed with fewer than all required lessons: marked complete by staff. */
  completedOffline: boolean;
};

/** Required-lesson completions and last activity per student of one course. */
async function courseStats(tx: Tx, courseId: string, userIds: string[]) {
  const [{ total }] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(contentLessons)
    .where(and(eq(contentLessons.courseId, courseId), eq(contentLessons.required, true), eq(contentLessons.ready, true)));
  if (userIds.length === 0) return { total, byUser: new Map<string, { done: number; started: number; last: Date | null }>() };
  const rows = await tx
    .select({
      userId: contentLessonProgress.userId,
      done: sql<number>`count(*) filter (where ${contentLessonProgress.completedAt} is not null and ${contentLessons.required} and ${contentLessons.ready})::int`,
      started: sql<number>`count(*) filter (where ${contentLessons.ready})::int`,
      last: max(contentLessonProgress.updatedAt),
    })
    .from(contentLessonProgress)
    .innerJoin(contentLessons, eq(contentLessons.id, contentLessonProgress.lessonId))
    .where(and(eq(contentLessonProgress.courseId, courseId), inArray(contentLessonProgress.userId, userIds)))
    .groupBy(contentLessonProgress.userId);
  return { total, byUser: new Map(rows.map((r) => [r.userId, { done: r.done, started: r.started, last: r.last ? new Date(r.last) : null }])) };
}

/** Every active or completed student of a batch with their progress. */
export async function batchProgress(actor: Actor, batchId: string) {
  if (!isUuid(batchId)) throw new NotFoundError("Batch");
  return withTenant(actor, async (tx) => {
    const batch = await batchLite(tx, batchId);
    assertCan(actor, "content.view_progress", batch.target);
    const course = await getCourseLite(tx, batch.courseId);
    const es = await tx
      .select({ id: enrolments.id, userId: enrolments.userId, status: enrolments.status })
      .from(enrolments)
      .where(and(eq(enrolments.batchId, batchId), inArray(enrolments.status, ["active", "completed"])));
    const userIds = es.map((e) => e.userId);
    const [people, stats, rows] = await Promise.all([
      peopleLite(tx, userIds),
      courseStats(tx, batch.courseId, userIds),
      es.length
        ? tx.select().from(contentCourseProgress).where(inArray(contentCourseProgress.enrolmentId, es.map((e) => e.id)))
        : Promise.resolve([]),
    ]);
    const byId = new Map(people.map((p) => [p.id, p]));
    const students: StudentProgress[] = es.map((e) => {
      const s = stats.byUser.get(e.userId);
      const row = rows.find((r) => r.enrolmentId === e.id);
      const done = Math.min(s?.done ?? 0, stats.total);
      const last = [s?.last ?? null, row?.lastActivityAt ?? null].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const percent = coursePercent(done, stats.total);
      return {
        enrolmentId: e.id,
        userId: e.userId,
        name: byId.get(e.userId)?.name ?? "Unknown student",
        email: byId.get(e.userId)?.email ?? "",
        status: e.status as "active" | "completed",
        percent,
        done,
        total: stats.total,
        started: s?.started ?? 0,
        lastActivityAt: last,
        completedOffline: e.status === "completed" && percent < 100,
      };
    });
    students.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
    const university = await universityLite(tx);
    return {
      batch,
      course,
      university,
      students,
      totalRequired: stats.total,
      canMarkComplete: can(actor, "enrolment.complete", batch.target),
      summary: {
        students: students.length,
        completed: students.filter((s) => s.status === "completed").length,
        notStarted: students.filter((s) => s.status === "active" && s.started === 0).length,
        average: students.length ? Math.round(students.reduce((n, s) => n + (s.status === "completed" ? 100 : s.percent), 0) / students.length) : 0,
      },
    };
  });
}

/**
 * Marks a student's enrolment complete for a course finished offline. Needs
 * `enrolment.complete` on the batch. Core emits enrolment.completed (once).
 */
export async function markStudentComplete(actor: Actor, batchId: string, enrolmentId: string) {
  if (!isUuid(batchId) || !isUuid(enrolmentId)) throw new NotFoundError("Enrolment");
  await withTenant(actor, async (tx) => {
    const batch = await batchLite(tx, batchId);
    assertCan(actor, "enrolment.complete", batch.target);
    const [e] = await tx.select({ batchId: enrolments.batchId }).from(enrolments).where(eq(enrolments.id, enrolmentId));
    if (!e || e.batchId !== batchId) throw new NotFoundError("Enrolment");
  });
  return markEnrolmentCompleted(actor, enrolmentId);
}

/* ───────────────────────────── Batches the viewer may see ───────────────────────────── */

export type BatchOverview = {
  batchId: string;
  batchName: string;
  batchStatus: string;
  startDate: string;
  endDate: string;
  courseId: string;
  courseTitle: string;
  departmentId: string;
  departmentName: string;
  students: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  averagePercent: number;
  completionRate: number;
  requiredLessons: number;
};

/**
 * Progress by course and batch for everything the viewer may see with
 * `content.view_progress` (reach: university, department or batch scope).
 */
export async function progressOverview(actor: Actor, params: ReportParams = {}): Promise<BatchOverview[]> {
  const universityId = uni(actor);
  const r = reach(actor, "content.view_progress", universityId);
  if (!r.all && r.departmentIds.size === 0 && r.batchIds.size === 0) return [];
  for (const k of ["courseId", "batchId", "departmentId"] as const) {
    if (params[k] && !isUuid(params[k]!)) throw new ValidationError("Pick a course, batch or department from the list.");
  }
  if ((params.from && !isDate(params.from)) || (params.to && !isDate(params.to))) throw new ValidationError("Dates must look like 2026-11-01.");
  if (params.from && params.to && params.to < params.from) throw new ValidationError("The end date must be on or after the start date.");

  return withTenant(actor, async (tx) => {
    const scope = r.all
      ? undefined
      : sql`(${r.departmentIds.size ? sql`${batches.departmentId} in ${[...r.departmentIds]}` : sql`false`} or ${
          r.batchIds.size ? sql`${batches.id} in ${[...r.batchIds]}` : sql`false`
        })`;
    const rows = await tx
      .select({
        batchId: batches.id,
        batchName: batches.name,
        batchStatus: batches.status,
        startDate: batches.startDate,
        endDate: batches.endDate,
        courseId: courses.id,
        courseTitle: courses.title,
        departmentId: departments.id,
        departmentName: departments.name,
      })
      .from(batches)
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .innerJoin(departments, eq(departments.id, batches.departmentId))
      .where(
        and(
          scope,
          params.courseId ? eq(batches.courseId, params.courseId) : undefined,
          params.batchId ? eq(batches.id, params.batchId) : undefined,
          params.departmentId ? eq(batches.departmentId, params.departmentId) : undefined,
          // A date range keeps the batches that run during it.
          params.to ? sql`${batches.startDate} <= ${params.to}` : undefined,
          params.from ? sql`${batches.endDate} >= ${params.from}` : undefined,
        ),
      )
      .orderBy(asc(courses.title), asc(batches.startDate), asc(batches.name));
    if (rows.length === 0) return [];

    const batchIds = rows.map((b) => b.batchId);
    const courseIds = [...new Set(rows.map((b) => b.courseId))];
    const required = await tx
      .select({ courseId: contentLessons.courseId, n: sql<number>`count(*)::int` })
      .from(contentLessons)
      .where(and(inArray(contentLessons.courseId, courseIds), eq(contentLessons.required, true), eq(contentLessons.ready, true)))
      .groupBy(contentLessons.courseId);
    const requiredOf = new Map(required.map((x) => [x.courseId, x.n]));

    // One row per enrolment: its status, required lessons done and lessons started.
    const per = await tx
      .select({
        batchId: enrolments.batchId,
        courseId: enrolments.courseId,
        status: enrolments.status,
        done: sql<number>`count(*) filter (where ${contentLessonProgress.completedAt} is not null and ${contentLessons.required} and ${contentLessons.ready})::int`,
        started: sql<number>`count(${contentLessonProgress.id}) filter (where ${contentLessons.ready})::int`,
      })
      .from(enrolments)
      .leftJoin(contentLessonProgress, and(eq(contentLessonProgress.userId, enrolments.userId), eq(contentLessonProgress.courseId, enrolments.courseId)))
      .leftJoin(contentLessons, eq(contentLessons.id, contentLessonProgress.lessonId))
      .where(and(inArray(enrolments.batchId, batchIds), inArray(enrolments.status, ["active", "completed"])))
      .groupBy(enrolments.id);

    return rows.map((b) => {
      const total = requiredOf.get(b.courseId) ?? 0;
      const mine = per.filter((p) => p.batchId === b.batchId);
      const completed = mine.filter((p) => p.status === "completed").length;
      const active = mine.filter((p) => p.status === "active");
      const percents = mine.map((p) => (p.status === "completed" ? 100 : coursePercent(Math.min(p.done, total), total)));
      return {
        ...b,
        students: mine.length,
        notStarted: active.filter((p) => p.started === 0).length,
        inProgress: active.filter((p) => p.started > 0).length,
        completed,
        averagePercent: percents.length ? Math.round(percents.reduce((n, x) => n + x, 0) / percents.length) : 0,
        completionRate: mine.length ? Math.round((completed * 100) / mine.length) : 0,
        requiredLessons: total,
      };
    });
  });
}

/** Report "Course and batch progress" (PRD page 8). */
export async function runProgressReport(actor: Actor, params: ReportParams): Promise<ReportResult> {
  const rows = await progressOverview(actor, params);
  return {
    columns: [
      { key: "course", label: "Course", type: "text" },
      { key: "batch", label: "Batch", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "startDate", label: "Batch starts", type: "date" },
      { key: "requiredLessons", label: "Required lessons", type: "number" },
      { key: "students", label: "Students", type: "number" },
      { key: "notStarted", label: "Not started", type: "number" },
      { key: "inProgress", label: "In progress", type: "number" },
      { key: "completed", label: "Completed", type: "number" },
      { key: "averagePercent", label: "Average progress", type: "percent" },
      { key: "completionRate", label: "Completion rate", type: "percent" },
    ],
    rows: rows.map((r) => ({
      course: r.courseTitle,
      batch: r.batchName,
      department: r.departmentName,
      startDate: r.startDate,
      requiredLessons: r.requiredLessons,
      students: r.students,
      notStarted: r.notStarted,
      inProgress: r.inProgress,
      completed: r.completed,
      averagePercent: r.averagePercent,
      completionRate: r.completionRate,
    })),
  };
}

/** Batches of one course the viewer may see progress for (Curriculum tab, progress links). */
export async function courseProgressBatches(actor: Actor, courseId: string) {
  if (!isUuid(courseId)) throw new NotFoundError("Course");
  return progressOverview(actor, { courseId });
}
