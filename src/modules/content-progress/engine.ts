/**
 * The progress engine: records lesson completions, recounts course progress and decides
 * when a course is complete. Every write path (the player, curriculum changes, the seed)
 * goes through here, so the rules live in one place:
 *
 *   course % = completed required lessons ÷ required lessons (only lessons that are ready)
 *
 * Concurrency: each enrolment has one content_course_progress row. Every change to a
 * student's progress in a course locks that row first (then the lesson row), so two
 * lessons completing at the same moment are counted one after the other and exactly one
 * of them sees 100%. Completion itself goes through core `markEnrolmentCompleted`, which
 * is idempotent, so enrolment.completed is emitted once whatever happens here.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { enrolments } from "@/db/schema";
import { audit, emit, markEnrolmentCompleted, systemActorFor, type Actor } from "@/server/core";
import { AppError } from "@/server/errors";
import { coursePercent } from "./lib/kinds";
import { contentCourseProgress, contentLessonProgress, contentLessons } from "./schema";

export type EnrolmentRef = {
  enrolmentId: string;
  userId: string;
  courseId: string;
  batchId: string;
  status: "held" | "active" | "completed" | "cancelled" | "expired" | "ended";
};

export type CourseProgressRow = typeof contentCourseProgress.$inferSelect;
export type LessonProgressRow = typeof contentLessonProgress.$inferSelect;

/** The enrolment's progress row, created if missing, locked until the transaction ends. */
export async function lockCourseProgress(tx: Tx, universityId: string, e: EnrolmentRef): Promise<CourseProgressRow> {
  await tx
    .insert(contentCourseProgress)
    .values({ universityId, enrolmentId: e.enrolmentId, userId: e.userId, courseId: e.courseId })
    .onConflictDoNothing({ target: contentCourseProgress.enrolmentId });
  const [row] = await tx.select().from(contentCourseProgress).where(eq(contentCourseProgress.enrolmentId, e.enrolmentId)).for("update");
  return row;
}

/** The student's progress row for a lesson, created if missing, locked. Lock the course row first. */
export async function lockLessonProgress(tx: Tx, universityId: string, userId: string, courseId: string, lessonId: string) {
  const inserted = await tx
    .insert(contentLessonProgress)
    .values({ universityId, userId, courseId, lessonId })
    .onConflictDoNothing({ target: [contentLessonProgress.lessonId, contentLessonProgress.userId] })
    .returning({ id: contentLessonProgress.id });
  const [row] = await tx
    .select()
    .from(contentLessonProgress)
    .where(and(eq(contentLessonProgress.lessonId, lessonId), eq(contentLessonProgress.userId, userId)))
    .for("update");
  return { row, created: inserted.length > 0 };
}

/** Required, ready lessons of the course, and how many of them the student has completed. */
export async function countRequired(tx: Tx, courseId: string, userId: string) {
  const [r] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(${contentLessonProgress.completedAt})::int`,
    })
    .from(contentLessons)
    .leftJoin(contentLessonProgress, and(eq(contentLessonProgress.lessonId, contentLessons.id), eq(contentLessonProgress.userId, userId)))
    .where(and(eq(contentLessons.courseId, courseId), eq(contentLessons.required, true), eq(contentLessons.ready, true)));
  return { total: r?.total ?? 0, done: r?.done ?? 0 };
}

export type SyncResult = { percent: number; previous: number; total: number; done: number; reached100: boolean };

/**
 * Recounts one enrolment's course progress (its row must be locked), stores it and emits
 * course.progress when the percentage changed. `reached100` is true when an active
 * enrolment now has every required lesson done; the caller then completes it.
 */
export async function syncCourseProgress(
  tx: Tx,
  actor: Actor,
  row: CourseProgressRow,
  e: EnrolmentRef,
  touch?: { lessonId: string; at?: Date },
): Promise<SyncResult> {
  const { total, done } = await countRequired(tx, e.courseId, e.userId);
  const percent = coursePercent(done, total);
  await tx
    .update(contentCourseProgress)
    .set({
      percent,
      completedRequired: done,
      totalRequired: total,
      updatedAt: new Date(),
      ...(touch && { lastLessonId: touch.lessonId, lastActivityAt: touch.at ?? new Date() }),
    })
    .where(eq(contentCourseProgress.id, row.id));
  if (percent !== row.percent && e.status === "active") {
    await emit(tx, actor, "course.progress", { userId: e.userId, courseId: e.courseId, enrolmentId: e.enrolmentId, percent });
  }
  return { percent, previous: row.percent, total, done, reached100: e.status === "active" && total > 0 && done >= total };
}

export type CompletionResult = SyncResult & { lessonCompleted: boolean };

/**
 * Marks a lesson complete for a student (once) and recounts their course progress.
 * Emits lesson.completed only when the lesson wasn't complete before.
 * The caller has already checked that the student may complete this lesson.
 */
export async function completeLessonTx(
  tx: Tx,
  actor: Actor,
  input: { universityId: string; enrolment: EnrolmentRef; lessonId: string; via: "manual" | "video"; at?: Date },
): Promise<CompletionResult> {
  const { enrolment: e } = input;
  const course = await lockCourseProgress(tx, input.universityId, e);
  const { row } = await lockLessonProgress(tx, input.universityId, e.userId, e.courseId, input.lessonId);
  const at = input.at ?? new Date();
  let lessonCompleted = false;
  if (!row.completedAt) {
    await tx
      .update(contentLessonProgress)
      .set({ completedAt: at, percent: 100, completedVia: input.via, updatedAt: at })
      .where(eq(contentLessonProgress.id, row.id));
    await emit(tx, actor, "lesson.completed", { userId: e.userId, courseId: e.courseId, lessonId: input.lessonId });
    await audit(tx, actor, "lesson.complete", "lesson", input.lessonId, { userId: e.userId, enrolmentId: e.enrolmentId, via: input.via });
    lessonCompleted = true;
  }
  const sync = await syncCourseProgress(tx, actor, course, e, { lessonId: input.lessonId, at });
  return { ...sync, lessonCompleted };
}

/**
 * Recounts every enrolment of a course after its curriculum changed (a required lesson
 * added, removed, made optional, or its content published). Returns the active enrolments
 * that are now at 100%, to complete after the transaction commits.
 */
export async function resyncCourse(tx: Tx, actor: Actor, universityId: string, courseId: string): Promise<string[]> {
  const es = await tx
    .select({ enrolmentId: enrolments.id, userId: enrolments.userId, courseId: enrolments.courseId, batchId: enrolments.batchId, status: enrolments.status })
    .from(enrolments)
    .where(and(eq(enrolments.courseId, courseId), inArray(enrolments.status, ["active", "completed"])))
    .orderBy(asc(enrolments.id));
  if (es.length === 0) return [];
  await tx
    .insert(contentCourseProgress)
    .values(es.map((e) => ({ universityId, enrolmentId: e.enrolmentId, userId: e.userId, courseId: e.courseId })))
    .onConflictDoNothing({ target: contentCourseProgress.enrolmentId });
  const rows = await tx
    .select()
    .from(contentCourseProgress)
    .where(inArray(contentCourseProgress.enrolmentId, es.map((e) => e.enrolmentId)))
    .orderBy(asc(contentCourseProgress.id))
    .for("update");
  const byEnrolment = new Map(rows.map((r) => [r.enrolmentId, r]));
  const finished: string[] = [];
  for (const e of es) {
    const r = await syncCourseProgress(tx, actor, byEnrolment.get(e.enrolmentId)!, e);
    if (r.reached100) finished.push(e.enrolmentId);
  }
  return finished;
}

/**
 * Completes enrolments that reached 100%, through core (which emits enrolment.completed
 * exactly once). Call it after the transaction that recorded the progress has committed.
 * Never throws: an enrolment that is no longer active is skipped, and anything else is
 * logged and retried by the course.progress handler and the hourly job.
 */
export async function finishCompletions(universityId: string, enrolmentIds: readonly string[]) {
  const out: { enrolmentId: string; status: "completed" | "already_completed" | "skipped" }[] = [];
  for (const id of new Set(enrolmentIds)) {
    try {
      const r = await markEnrolmentCompleted(systemActorFor(universityId), id);
      out.push({ enrolmentId: id, status: r.status });
    } catch (err) {
      if (!(err instanceof AppError)) console.error(`[content-progress] completing enrolment ${id} failed; it will be retried:`, err);
      out.push({ enrolmentId: id, status: "skipped" });
    }
  }
  return out;
}

/** The active or completed enrolment of a student in a course (active first, then the latest completed). */
export async function learnerEnrolment(tx: Tx, userId: string, courseId: string): Promise<EnrolmentRef | null> {
  const rows = await tx
    .select({ enrolmentId: enrolments.id, userId: enrolments.userId, courseId: enrolments.courseId, batchId: enrolments.batchId, status: enrolments.status, createdAt: enrolments.createdAt })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, courseId), inArray(enrolments.status, ["active", "completed"])));
  if (rows.length === 0) return null;
  rows.sort((a, b) => (a.status === b.status ? b.createdAt.getTime() - a.createdAt.getTime() : a.status === "active" ? -1 : 1));
  const { createdAt: _c, ...e } = rows[0];
  void _c;
  return e;
}
