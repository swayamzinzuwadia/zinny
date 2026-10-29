/**
 * The learner side (PRD pages 4 and 6): the lesson player, the course outline, progress
 * and "continue learning".
 *
 * Access rules, checked by every learner function (and the signed-file route):
 *   - `self.learn` on the learner's own records;
 *   - an active enrolment in the lesson's course (a completed enrolment may still review
 *     its lessons; held, cancelled, expired and ended enrolments may not);
 *   - the lesson is ready (has its content);
 *   - the lesson is unlocked: drip lessons open N days after the student's batch starts,
 *     or on a fixed date, in the university's time zone.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  assertCan,
  audit,
  batchLite,
  enrolmentById,
  expandSessions,
  getCourseLite,
  scheduledBatches,
  storage,
  studentEnrolments,
  todayFor,
  withTenant,
  type Actor,
  type BatchLite,
} from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  completeLessonTx,
  finishCompletions,
  learnerEnrolment,
  lockCourseProgress,
  lockLessonProgress,
  type EnrolmentRef,
} from "./engine";
import { courseCurriculum, isUuid, loadLesson, uni, type LessonRow } from "./internal";
import { addDays } from "./lib/dates";
import { coursePercent, isLocked, readContent, unlockDate, type LessonKind, type ParsedContent, type WatchedRange } from "./lib/kinds";
import { addWatched, reachedCompletion, watchedPercent } from "./lib/ranges";
import { sanitizeLessonHtml } from "./lib/sanitize";
import { contentCourseProgress, contentLessonProgress } from "./schema";

const own = (actor: Actor) => ({ universityId: uni(actor), ownerUserId: actor.userId });

export const NOT_ENROLLED = "You aren't enrolled in this course. Enrol in a batch to open its lessons.";

/* ───────────────────────────── Outline ───────────────────────────── */

export type LessonState = "done" | "open" | "locked";

export type OutlineLesson = {
  id: string;
  sectionId: string;
  title: string;
  kind: LessonKind;
  required: boolean;
  durationMinutes: number;
  state: LessonState;
  /** "YYYY-MM-DD" the lesson opens, when it has a drip rule. */
  unlockOn: string | null;
  /** 0–100: videos show the share watched. */
  percent: number;
  started: boolean;
  completedAt: Date | null;
};

export type Outline = {
  sections: { id: string; title: string; lessons: OutlineLesson[] }[];
  lessons: OutlineLesson[];
  percent: number;
  done: number;
  total: number;
  /** The next unfinished lesson: the first open required lesson not completed, else the first optional one not yet opened. */
  next: OutlineLesson | null;
  /** The next lesson that will unlock, if any is locked. */
  nextUnlock: OutlineLesson | null;
  totalMinutes: number;
};

async function buildOutline(tx: Tx, e: EnrolmentRef, batchStart: string, today: string): Promise<Outline> {
  const { sections, lessons } = await courseCurriculum(tx, e.courseId);
  const ready = lessons.filter((l) => l.ready);
  const progress = await tx
    .select()
    .from(contentLessonProgress)
    .where(and(eq(contentLessonProgress.userId, e.userId), eq(contentLessonProgress.courseId, e.courseId)));
  const byLesson = new Map(progress.map((p) => [p.lessonId, p]));
  const items: OutlineLesson[] = ready.map((l) => {
    const p = byLesson.get(l.id);
    const unlockOn = unlockDate(l, batchStart);
    const done = !!p?.completedAt;
    return {
      id: l.id,
      sectionId: l.sectionId,
      title: l.title,
      kind: l.kind,
      required: l.required,
      durationMinutes: l.durationMinutes,
      state: done ? "done" : isLocked(unlockOn, today) ? "locked" : "open",
      unlockOn,
      percent: done ? 100 : (p?.percent ?? 0),
      started: !!p,
      completedAt: p?.completedAt ?? null,
    };
  });
  const required = items.filter((l) => l.required);
  const done = required.filter((l) => l.state === "done").length;
  const locked = items.filter((l) => l.state === "locked").sort((a, b) => (a.unlockOn ?? "").localeCompare(b.unlockOn ?? ""));
  return {
    sections: sections
      .map((s) => ({ id: s.id, title: s.title, lessons: items.filter((l) => l.sectionId === s.id) }))
      .filter((s) => s.lessons.length > 0),
    lessons: items,
    percent: coursePercent(done, required.length),
    done,
    total: required.length,
    next: items.find((l) => l.state === "open" && l.required) ?? items.find((l) => l.state === "open" && !l.started) ?? null,
    nextUnlock: locked[0] ?? null,
    totalMinutes: items.reduce((n, l) => n + l.durationMinutes, 0),
  };
}

/* ───────────────────────────── Access ───────────────────────────── */

type Access = { lesson: LessonRow; enrolment: EnrolmentRef; batch: BatchLite; today: string; unlockOn: string | null; locked: boolean };

/** Enrolment, batch and lock state for one lesson; throws when the learner may not see it at all. */
async function access(tx: Tx, actor: Actor, lessonId: string): Promise<Access> {
  const lesson = await loadLesson(tx, lessonId);
  if (!lesson.ready) throw new NotFoundError("Lesson");
  const enrolment = await learnerEnrolment(tx, actor.userId, lesson.courseId);
  if (!enrolment) throw new ForbiddenError(NOT_ENROLLED);
  const batch = await batchLite(tx, enrolment.batchId);
  const today = await todayFor(tx);
  const unlockOn = unlockDate(lesson, batch.startDate);
  return { lesson, enrolment, batch, today, unlockOn, locked: isLocked(unlockOn, today) };
}

/** Like `access`, and refuses locked lessons. */
async function openAccess(tx: Tx, actor: Actor, lessonId: string): Promise<Access> {
  const a = await access(tx, actor, lessonId);
  if (a.locked) throw new ConflictError(`This lesson opens on ${a.unlockOn}.`, "locked");
  return a;
}

/* ───────────────────────────── The lesson player ───────────────────────────── */

export type LiveSession = { date: string; startTime: string; endTime: string; joinUrl: string | null; kind: string; note: string | null };

export type LearnerLesson = {
  lesson: Pick<LessonRow, "id" | "title" | "kind" | "required" | "durationMinutes" | "courseId" | "sectionId">;
  sectionTitle: string;
  course: { id: string; title: string };
  enrolment: EnrolmentRef;
  batch: { id: string; name: string; startDate: string; endDate: string };
  today: string;
  locked: boolean;
  unlockOn: string | null;
  /** Null while locked. Text is sanitised again here, whatever was stored. */
  content: ParsedContent | null;
  progress: { completed: boolean; completedAt: Date | null; percent: number; positionSeconds: number; watchedRanges: WatchedRange[] };
  outline: Outline;
  prev: OutlineLesson | null;
  next: OutlineLesson | null;
  /** For live lessons: the batch's next classes. */
  sessions: LiveSession[];
};

export async function lessonForLearner(actor: Actor, lessonId: string): Promise<LearnerLesson> {
  assertCan(actor, "self.learn", own(actor));
  if (!isUuid(lessonId)) throw new NotFoundError("Lesson");
  return withTenant(actor, async (tx) => {
    const a = await access(tx, actor, lessonId);
    const course = await getCourseLite(tx, a.enrolment.courseId);
    const outline = await buildOutline(tx, a.enrolment, a.batch.startDate, a.today);
    const i = outline.lessons.findIndex((l) => l.id === lessonId);
    const [p] = await tx
      .select()
      .from(contentLessonProgress)
      .where(and(eq(contentLessonProgress.lessonId, lessonId), eq(contentLessonProgress.userId, actor.userId)));
    let content: ParsedContent | null = null;
    if (!a.locked) {
      content = readContent(a.lesson.kind, a.lesson.content);
      if (content.kind === "text") content = { kind: "text", html: sanitizeLessonHtml(content.html) };
    }
    let sessions: LiveSession[] = [];
    if (!a.locked && a.lesson.kind === "live") {
      const sched = await scheduledBatches(tx, [a.batch.id]);
      sessions = expandSessions(sched, a.today, addDays(a.today, 28))
        .slice(0, 5)
        .map((s) => ({ date: s.date, startTime: s.startTime, endTime: s.endTime, joinUrl: s.joinUrl, kind: s.kind, note: s.note }));
    }
    const section = outline.sections.find((s) => s.id === a.lesson.sectionId);
    return {
      lesson: {
        id: a.lesson.id,
        title: a.lesson.title,
        kind: a.lesson.kind,
        required: a.lesson.required,
        durationMinutes: a.lesson.durationMinutes,
        courseId: a.lesson.courseId,
        sectionId: a.lesson.sectionId,
      },
      sectionTitle: section?.title ?? "",
      course: { id: course.id, title: course.title },
      enrolment: a.enrolment,
      batch: { id: a.batch.id, name: a.batch.name, startDate: a.batch.startDate, endDate: a.batch.endDate },
      today: a.today,
      locked: a.locked,
      unlockOn: a.unlockOn,
      content,
      progress: {
        completed: !!p?.completedAt,
        completedAt: p?.completedAt ?? null,
        percent: p?.completedAt ? 100 : (p?.percent ?? 0),
        positionSeconds: p?.positionSeconds ?? 0,
        watchedRanges: p?.watchedRanges ?? [],
      },
      outline,
      prev: i > 0 ? outline.lessons[i - 1] : null,
      next: i >= 0 && i < outline.lessons.length - 1 ? outline.lessons[i + 1] : null,
      sessions,
    };
  });
}

/**
 * A short-lived signed URL for the lesson's uploaded video or PDF. Refused for anyone the
 * lesson isn't open to. Videos get enough time to be watched with seeking.
 */
export async function lessonFileUrl(actor: Actor, lessonId: string, opts: { download?: boolean } = {}) {
  assertCan(actor, "self.learn", own(actor));
  if (!isUuid(lessonId)) throw new NotFoundError("Lesson");
  const file = await withTenant(actor, async (tx) => {
    const a = await openAccess(tx, actor, lessonId);
    const c = readContent(a.lesson.kind, a.lesson.content);
    if (c.kind === "pdf" && c.pdf) return { key: c.pdf.key, name: c.pdf.fileName, seconds: 30 * 60 };
    if (c.kind === "video" && c.video?.source === "upload") {
      const length = c.video.durationSeconds ?? a.lesson.durationMinutes * 60;
      return { key: c.video.key, name: c.video.fileName, seconds: Math.min(6 * 3600, Math.max(30 * 60, Math.ceil(length * 3) + 15 * 60)) };
    }
    throw new NotFoundError("File");
  });
  return storage().signedUrl(file.key, file.seconds, opts.download ? { downloadName: file.name } : undefined);
}

/* ───────────────────────────── Progress ───────────────────────────── */

export type ProgressResult = { lessonCompleted: boolean; completed: boolean; percent: number; coursePercent: number; courseCompleted: boolean };

/** Finish the enrolment if this progress took it to 100%. */
async function settle(actor: Actor, enrolmentId: string, reached100: boolean) {
  if (!reached100) return false;
  const [r] = await finishCompletions(uni(actor), [enrolmentId]);
  return r?.status === "completed" || r?.status === "already_completed";
}

/** "Mark complete" for PDF, text, link and live lessons. Videos complete themselves at 90% watched. */
export async function markLessonComplete(actor: Actor, lessonId: string): Promise<ProgressResult> {
  assertCan(actor, "self.learn", own(actor));
  if (!isUuid(lessonId)) throw new NotFoundError("Lesson");
  const r = await withTenant(actor, async (tx) => {
    const a = await openAccess(tx, actor, lessonId);
    if (a.lesson.kind === "video") throw new ConflictError("Videos complete on their own once you've watched 90% of them.", "video");
    const res = await completeLessonTx(tx, actor, { universityId: uni(actor), enrolment: a.enrolment, lessonId, via: "manual" });
    return { ...res, enrolmentId: a.enrolment.enrolmentId };
  });
  const courseCompleted = await settle(actor, r.enrolmentId, r.reached100);
  return { lessonCompleted: r.lessonCompleted, completed: true, percent: 100, coursePercent: r.percent, courseCompleted };
}

/** The learner opened a lesson: remembered for "continue learning" and last activity. Locked lessons are ignored. */
export async function recordLessonOpened(actor: Actor, lessonId: string) {
  assertCan(actor, "self.learn", own(actor));
  if (!isUuid(lessonId)) throw new NotFoundError("Lesson");
  return withTenant(actor, async (tx) => {
    const a = await access(tx, actor, lessonId);
    if (a.locked) return { recorded: false };
    const course = await lockCourseProgress(tx, uni(actor), a.enrolment);
    const { row, created } = await lockLessonProgress(tx, uni(actor), actor.userId, a.lesson.courseId, lessonId);
    const now = new Date();
    await tx.update(contentLessonProgress).set({ updatedAt: now }).where(eq(contentLessonProgress.id, row.id));
    await tx.update(contentCourseProgress).set({ lastLessonId: lessonId, lastActivityAt: now }).where(eq(contentCourseProgress.id, course.id));
    if (created) await audit(tx, actor, "lesson.start", "lesson", lessonId, { enrolmentId: a.enrolment.enrolmentId });
    return { recorded: true };
  });
}

export type VideoReport = { ranges: WatchedRange[]; duration: number; position: number };

/** Reads a video report from untrusted JSON. */
export function parseVideoReport(body: unknown): VideoReport {
  const b = (body ?? {}) as Record<string, unknown>;
  const duration = Number(b.duration);
  const position = Number(b.position ?? 0);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 3600) throw new ValidationError("The video's length is missing.");
  if (!Array.isArray(b.ranges) || b.ranges.length > 500) throw new ValidationError("The watched parts are missing.");
  const ranges = (b.ranges as unknown[])
    .filter((r): r is [number, number] => Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === "number" && Number.isFinite(n)))
    .map(([a, z]) => [a, z] as WatchedRange);
  return { ranges, duration, position: Number.isFinite(position) && position >= 0 ? Math.min(position, duration) : 0 };
}

/** Allowance for new watched time: playback can't outrun the clock (2.5x covers fast playback). */
const SPEED_ALLOWANCE = 2.5;
const SLACK_SECONDS = 20;

/**
 * The player reports what it has played. The watched parts add up across sittings; the
 * lesson completes when 90% of the video has been watched.
 */
export async function reportVideoProgress(actor: Actor, lessonId: string, report: VideoReport): Promise<ProgressResult> {
  assertCan(actor, "self.learn", own(actor));
  if (!isUuid(lessonId)) throw new NotFoundError("Lesson");
  const r = await withTenant(actor, async (tx) => {
    const a = await openAccess(tx, actor, lessonId);
    if (a.lesson.kind !== "video") throw new ConflictError("Only video lessons report watching progress.", "not_video");
    const course = await lockCourseProgress(tx, uni(actor), a.enrolment);
    const { row, created } = await lockLessonProgress(tx, uni(actor), actor.userId, a.lesson.courseId, lessonId);
    const now = new Date();
    if (created) await audit(tx, actor, "lesson.start", "lesson", lessonId, { enrolmentId: a.enrolment.enrolmentId });
    const touchCourse = () =>
      tx.update(contentCourseProgress).set({ lastLessonId: lessonId, lastActivityAt: now }).where(eq(contentCourseProgress.id, course.id));

    if (row.completedAt) {
      await tx.update(contentLessonProgress).set({ positionSeconds: Math.floor(report.position), updatedAt: now }).where(eq(contentLessonProgress.id, row.id));
      await touchCourse();
      return { lessonCompleted: false, completed: true, percent: 100, coursePercent: course.percent, reached100: false, enrolmentId: a.enrolment.enrolmentId };
    }

    const c = readContent("video", a.lesson.content);
    const known = c.kind === "video" && c.video?.source === "upload" ? c.video.durationSeconds : undefined;
    // The length of an external video comes from the player, so it can't be shorter than
    // half the duration staff set for the lesson, and once known it never changes.
    const floor = Math.round(a.lesson.durationMinutes * 30);
    const duration = known ?? row.mediaSeconds ?? Math.max(Math.round(report.duration), floor);
    const elapsed = created ? 0 : Math.max(0, (now.getTime() - row.updatedAt.getTime()) / 1000);
    const { ranges, watched } = addWatched(row.watchedRanges, report.ranges, duration, elapsed * SPEED_ALLOWANCE + SLACK_SECONDS);
    const percent = watchedPercent(watched, duration);
    await tx
      .update(contentLessonProgress)
      .set({ watchedRanges: ranges, percent, mediaSeconds: duration, positionSeconds: Math.floor(report.position), updatedAt: now })
      .where(eq(contentLessonProgress.id, row.id));

    if (reachedCompletion(watched, duration)) {
      const res = await completeLessonTx(tx, actor, { universityId: uni(actor), enrolment: a.enrolment, lessonId, via: "video", at: now });
      return { lessonCompleted: res.lessonCompleted, completed: true, percent: 100, coursePercent: res.percent, reached100: res.reached100, enrolmentId: a.enrolment.enrolmentId };
    }
    await touchCourse();
    return { lessonCompleted: false, completed: false, percent, coursePercent: course.percent, reached100: false, enrolmentId: a.enrolment.enrolmentId };
  });
  const courseCompleted = await settle(actor, r.enrolmentId, r.reached100);
  return { lessonCompleted: r.lessonCompleted, completed: r.completed, percent: r.percent, coursePercent: r.coursePercent, courseCompleted };
}

/* ───────────────────────────── Course hub and home ───────────────────────────── */

/** The outline for one of the learner's own enrolments (the Lessons tab). */
export async function learnerOutline(actor: Actor, enrolmentId: string) {
  assertCan(actor, "self.learn", own(actor));
  if (!isUuid(enrolmentId)) throw new NotFoundError("Course");
  return withTenant(actor, async (tx) => {
    const e = await enrolmentById(tx, enrolmentId);
    if (e.userId !== actor.userId) throw new NotFoundError("Course");
    if (e.status !== "active" && e.status !== "completed") throw new ForbiddenError(NOT_ENROLLED);
    const batch = await batchLite(tx, e.batchId);
    const today = await todayFor(tx);
    const outline = await buildOutline(tx, e, batch.startDate, today);
    return { enrolment: e, batch, today, outline };
  });
}

export type ContinueItem = {
  enrolmentId: string;
  courseId: string;
  courseTitle: string;
  batchName: string;
  percent: number;
  done: number;
  total: number;
  next: OutlineLesson | null;
  nextUnlock: OutlineLesson | null;
  sectionTitle: string;
  lastActivityAt: Date | null;
};

/** The learner's active courses with their next unfinished lesson, most recently studied first. */
export async function continueLearning(actor: Actor): Promise<ContinueItem[]> {
  assertCan(actor, "self.learn", own(actor));
  return withTenant(actor, async (tx) => {
    const active = (await studentEnrolments(tx, actor.userId)).filter((e) => e.status === "active");
    if (active.length === 0) return [];
    const today = await todayFor(tx);
    const rows = await tx
      .select()
      .from(contentCourseProgress)
      .where(inArray(contentCourseProgress.enrolmentId, active.map((e) => e.enrolmentId)));
    const items: ContinueItem[] = [];
    for (const e of active) {
      const ref: EnrolmentRef = { ...e, userId: actor.userId };
      const [batch, course] = await Promise.all([batchLite(tx, e.batchId), getCourseLite(tx, e.courseId)]);
      const outline = await buildOutline(tx, ref, batch.startDate, today);
      if (outline.lessons.length === 0) continue;
      const row = rows.find((r) => r.enrolmentId === e.enrolmentId);
      items.push({
        enrolmentId: e.enrolmentId,
        courseId: e.courseId,
        courseTitle: course.title,
        batchName: batch.name,
        percent: outline.percent,
        done: outline.done,
        total: outline.total,
        next: outline.next,
        nextUnlock: outline.nextUnlock,
        sectionTitle: outline.sections.find((s) => s.id === outline.next?.sectionId)?.title ?? "",
        lastActivityAt: row?.lastActivityAt ?? null,
      });
    }
    return items.sort(
      (a, b) =>
        (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0) ||
        Number(!!b.next) - Number(!!a.next) ||
        a.courseTitle.localeCompare(b.courseTitle),
    );
  });
}
