/**
 * Curriculum: sections and lessons of a course (PRD pages 4, 5 and 7).
 *
 * Who edits (brief, "Who edits"): holders of `content.manage` on the course: Institute
 * Admins, HODs for courses in their department, and faculty for courses where they teach
 * a batch (the course target lists every batch, and faculty grants come from batches).
 * Anyone who can see the course (`course.view`) can read its curriculum.
 *
 * Every change that can move a student's percentage (a required lesson added, removed,
 * made optional, or its content published) recounts the course's progress in the same
 * transaction; enrolments that reach 100% are completed through core afterwards.
 */
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, audit, can, courseTarget, getCourseLite, storage, withTenant, type Actor, type Target } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { finishCompletions, lockCourseRows, resyncCourse } from "./engine";
import { courseCurriculum, isUuid, loadLesson, loadSection, readyFor, uni, type LessonRow, type SectionRow } from "./internal";
import { isDate } from "./lib/dates";
import {
  DRIP_MODES,
  isLessonKind,
  normaliseLink,
  parseVideoUrl,
  readContent,
  storedFileKey,
  type DripMode,
  type LessonContent,
  type LessonKind,
} from "./lib/kinds";
import { MAX_TEXT_HTML, sanitizeLessonHtml, textLength } from "./lib/sanitize";
import { contentLessons, contentSections } from "./schema";

export type CurriculumLesson = LessonRow;
export type CurriculumSection = SectionRow & { lessons: CurriculumLesson[] };

/* ───────────────────────────── Permission helpers ───────────────────────────── */

async function editTarget(tx: Tx, actor: Actor, courseId: string): Promise<Target> {
  const target = await courseTarget(tx, uni(actor), courseId);
  assertCan(actor, "content.manage", target);
  return target;
}

/**
 * Loads a lesson for a change that may move progress: checks content.manage, locks the
 * course's progress rows first (the order learners use, so the two never deadlock),
 * then locks the lesson.
 */
async function lessonForChange(tx: Tx, actor: Actor, lessonId: string) {
  const peek = await loadLesson(tx, lessonId);
  await editTarget(tx, actor, peek.courseId);
  await lockCourseRows(tx, uni(actor), peek.courseId);
  return loadLesson(tx, lessonId, { lock: true });
}

/** Can this person edit the course's curriculum? (For showing edit controls; services check again.) */
export function canEditCurriculum(actor: Actor, target: Target) {
  return can(actor, "content.manage", target);
}

/** Work to do once the transaction has committed: delete replaced files, complete enrolments at 100%. */
type AfterCommit = { deleteKeys: string[]; finished: string[] };

async function afterCommit(universityId: string, a: AfterCommit) {
  for (const key of a.deleteKeys) {
    await storage()
      .delete(key)
      .catch((e) => console.error(`[content-progress] couldn't delete ${key}; remove it by hand:`, e));
  }
  if (a.finished.length) await finishCompletions(universityId, a.finished);
}

/** Runs a curriculum change in one transaction, then its after-commit work. */
async function change<T>(actor: Actor, fn: (tx: Tx, later: AfterCommit) => Promise<T>): Promise<T> {
  const later: AfterCommit = { deleteKeys: [], finished: [] };
  const result = await withTenant(actor, (tx) => fn(tx, later));
  await afterCommit(uni(actor), later);
  return result;
}

/** Recounts the course when the change can move percentages. */
async function resyncIf(tx: Tx, actor: Actor, courseId: string, later: AfterCommit, needed: boolean) {
  if (needed) later.finished.push(...(await resyncCourse(tx, actor, uni(actor), courseId)));
}

const countsTowardProgress = (l: Pick<LessonRow, "required" | "ready">) => l.required && l.ready;

/* ───────────────────────────── Validation ───────────────────────────── */

function cleanTitle(title: string, what: "section" | "lesson") {
  const t = (title ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 2) throw new ValidationError(what === "section" ? "Give the section a title, like Week 1." : "Give the lesson a title.");
  if (t.length > 200) throw new ValidationError(`Keep the ${what} title under 200 characters.`);
  return t;
}

function cleanDuration(minutes: number | undefined) {
  if (minutes === undefined) return undefined;
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 6000) throw new ValidationError("Duration is a whole number of minutes, from 0 to 6000.");
  return minutes;
}

export type DripInput = { mode: DripMode; days?: number | null; date?: string | null };

function cleanDrip(d: DripInput | undefined) {
  if (!d) return undefined;
  if (!DRIP_MODES.includes(d.mode)) throw new ValidationError("Pick when the lesson opens.");
  if (d.mode === "after_start") {
    const days = d.days ?? NaN;
    if (!Number.isInteger(days) || days < 0 || days > 730) throw new ValidationError("Enter how many days after the batch starts the lesson opens, from 0 to 730.");
    return { dripMode: d.mode, dripDays: days, dripDate: null };
  }
  if (d.mode === "on_date") {
    if (!d.date || !isDate(d.date)) throw new ValidationError("Pick the date the lesson opens.");
    return { dripMode: d.mode, dripDays: null, dripDate: d.date };
  }
  return { dripMode: d.mode, dripDays: null, dripDate: null };
}

/* ───────────────────────────── Reading ───────────────────────────── */

export async function getCurriculum(actor: Actor, courseId: string): Promise<CurriculumSection[]> {
  if (!isUuid(courseId)) throw new NotFoundError("Course");
  return withTenant(actor, async (tx) => {
    const target = await courseTarget(tx, uni(actor), courseId);
    assertCan(actor, "course.view", target);
    const { sections, lessons } = await courseCurriculum(tx, courseId);
    return sections.map((s) => ({ ...s, lessons: lessons.filter((l) => l.sectionId === s.id) }));
  });
}

/** One lesson with its course and sections, for the lesson editor. */
export async function getLessonForEdit(actor: Actor, lessonId: string) {
  return withTenant(actor, async (tx) => {
    const lesson = await loadLesson(tx, lessonId);
    const target = await courseTarget(tx, uni(actor), lesson.courseId);
    assertCan(actor, "course.view", target);
    const course = await getCourseLite(tx, lesson.courseId);
    const { sections, lessons } = await courseCurriculum(tx, lesson.courseId);
    const index = lessons.findIndex((l) => l.id === lesson.id);
    return {
      lesson,
      parsed: readContent(lesson.kind, lesson.content),
      course,
      target,
      sections,
      section: sections.find((s) => s.id === lesson.sectionId)!,
      prev: index > 0 ? lessons[index - 1] : null,
      next: index >= 0 && index < lessons.length - 1 ? lessons[index + 1] : null,
      canEdit: can(actor, "content.manage", target),
    };
  });
}

/** A short-lived signed URL for staff to preview a lesson's uploaded file (course.view). */
export async function staffLessonFileUrl(actor: Actor, lessonId: string, opts: { download?: boolean } = {}) {
  const file = await withTenant(actor, async (tx) => {
    const lesson = await loadLesson(tx, lessonId);
    assertCan(actor, "course.view", await courseTarget(tx, uni(actor), lesson.courseId));
    const c = readContent(lesson.kind, lesson.content);
    if (c.kind === "pdf" && c.pdf) return { key: c.pdf.key, name: c.pdf.fileName };
    if (c.kind === "video" && c.video?.source === "upload") return { key: c.video.key, name: c.video.fileName };
    throw new NotFoundError("File");
  });
  return storage().signedUrl(file.key, 30 * 60, opts.download ? { downloadName: file.name } : undefined);
}

/* ───────────────────────────── Sections ───────────────────────────── */

export async function addSection(actor: Actor, courseId: string, title: string) {
  const clean = cleanTitle(title, "section");
  if (!isUuid(courseId)) throw new NotFoundError("Course");
  return withTenant(actor, async (tx) => {
    await editTarget(tx, actor, courseId);
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${contentSections.position}) + 1, 0)::int` })
      .from(contentSections)
      .where(eq(contentSections.courseId, courseId));
    const [s] = await tx.insert(contentSections).values({ universityId: uni(actor), courseId, title: clean, position: next }).returning();
    await audit(tx, actor, "content.section_add", "course", courseId, { sectionId: s.id, title: s.title });
    return s;
  });
}

export async function renameSection(actor: Actor, sectionId: string, title: string) {
  const clean = cleanTitle(title, "section");
  return withTenant(actor, async (tx) => {
    const s = await loadSection(tx, sectionId, { lock: true });
    await editTarget(tx, actor, s.courseId);
    await tx.update(contentSections).set({ title: clean }).where(eq(contentSections.id, s.id));
    await audit(tx, actor, "content.section_rename", "course", s.courseId, { sectionId: s.id, from: s.title, to: clean });
    return { ...s, title: clean };
  });
}

/** Moves a section one place up or down. */
export async function moveSection(actor: Actor, sectionId: string, direction: "up" | "down") {
  return withTenant(actor, async (tx) => {
    const s = await loadSection(tx, sectionId);
    await editTarget(tx, actor, s.courseId);
    const siblings = await tx
      .select()
      .from(contentSections)
      .where(eq(contentSections.courseId, s.courseId))
      .orderBy(asc(contentSections.position), asc(contentSections.title))
      .for("update");
    const moved = swap(siblings, sectionId, direction);
    if (!moved) return false;
    for (const [i, row] of moved.entries()) {
      if (row.position !== i) await tx.update(contentSections).set({ position: i }).where(eq(contentSections.id, row.id));
    }
    await audit(tx, actor, "content.section_move", "course", s.courseId, { sectionId, direction });
    return true;
  });
}

/** Deletes a section with its lessons (and their files and progress). */
export async function deleteSection(actor: Actor, sectionId: string) {
  return change(actor, async (tx, later) => {
    const peek = await loadSection(tx, sectionId);
    await editTarget(tx, actor, peek.courseId);
    await lockCourseRows(tx, uni(actor), peek.courseId);
    const s = await loadSection(tx, sectionId, { lock: true });
    const lessons = await tx.select().from(contentLessons).where(eq(contentLessons.sectionId, s.id)).for("update");
    await tx.delete(contentSections).where(eq(contentSections.id, s.id));
    for (const l of lessons) {
      const key = storedFileKey(l.kind, l.content);
      if (key) later.deleteKeys.push(key);
    }
    await audit(tx, actor, "content.section_delete", "course", s.courseId, { sectionId: s.id, title: s.title, lessons: lessons.length });
    await resyncIf(tx, actor, s.courseId, later, lessons.some(countsTowardProgress));
    return { lessonsDeleted: lessons.length };
  });
}

/* ───────────────────────────── Lessons ───────────────────────────── */

export type NewLesson = { title: string; kind: string; required?: boolean; durationMinutes?: number };

export async function addLesson(actor: Actor, courseId: string, sectionId: string, input: NewLesson) {
  const title = cleanTitle(input.title, "lesson");
  if (!isLessonKind(input.kind)) throw new ValidationError("Pick a lesson type: video, PDF, text, link or live class.");
  const kind: LessonKind = input.kind;
  const durationMinutes = cleanDuration(input.durationMinutes) ?? 0;
  if (!isUuid(courseId)) throw new NotFoundError("Course");
  return change(actor, async (tx, later) => {
    await editTarget(tx, actor, courseId);
    await lockCourseRows(tx, uni(actor), courseId);
    if (!isUuid(sectionId)) throw new NotFoundError("Section");
    const [section] = await tx.select().from(contentSections).where(eq(contentSections.id, sectionId));
    if (!section || section.courseId !== courseId) throw new NotFoundError("Section");
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${contentLessons.position}) + 1, 0)::int` })
      .from(contentLessons)
      .where(eq(contentLessons.sectionId, sectionId));
    const ready = readyFor(kind, {});
    const [l] = await tx
      .insert(contentLessons)
      .values({
        universityId: uni(actor),
        courseId,
        sectionId,
        title,
        kind,
        content: {},
        ready,
        required: input.required ?? true,
        durationMinutes,
        position: next,
      })
      .returning();
    await audit(tx, actor, "content.lesson_add", "lesson", l.id, { courseId, sectionId, title, kind });
    await resyncIf(tx, actor, courseId, later, countsTowardProgress(l));
    return l;
  });
}

export type LessonPatch = {
  title?: string;
  sectionId?: string;
  required?: boolean;
  durationMinutes?: number;
  drip?: DripInput;
};

/** Title, section, required or optional, duration and drip. */
export async function updateLesson(actor: Actor, lessonId: string, patch: LessonPatch) {
  const title = patch.title !== undefined ? cleanTitle(patch.title, "lesson") : undefined;
  const durationMinutes = cleanDuration(patch.durationMinutes);
  const drip = cleanDrip(patch.drip);
  return change(actor, async (tx, later) => {
    const l = await lessonForChange(tx, actor, lessonId);
    const set: Partial<typeof contentLessons.$inferInsert> = { updatedAt: new Date() };
    if (title !== undefined) set.title = title;
    if (durationMinutes !== undefined) set.durationMinutes = durationMinutes;
    if (patch.required !== undefined) set.required = patch.required;
    if (drip) Object.assign(set, drip);
    if (patch.sectionId !== undefined && patch.sectionId !== l.sectionId) {
      const target = isUuid(patch.sectionId) ? (await tx.select().from(contentSections).where(eq(contentSections.id, patch.sectionId)))[0] : undefined;
      if (!target || target.courseId !== l.courseId) throw new NotFoundError("Section");
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${contentLessons.position}) + 1, 0)::int` })
        .from(contentLessons)
        .where(eq(contentLessons.sectionId, target.id));
      set.sectionId = target.id;
      set.position = next;
    }
    const [after] = await tx.update(contentLessons).set(set).where(eq(contentLessons.id, l.id)).returning();
    await audit(tx, actor, "content.lesson_update", "lesson", l.id, {
      courseId: l.courseId,
      ...(title !== undefined && { title }),
      ...(patch.required !== undefined && { required: patch.required }),
      ...(durationMinutes !== undefined && { durationMinutes }),
      ...(drip && { drip }),
      ...(set.sectionId && { sectionId: set.sectionId }),
    });
    await resyncIf(tx, actor, l.courseId, later, countsTowardProgress(l) !== countsTowardProgress(after));
    return after;
  });
}

/** Moves a lesson one place up or down inside its section. */
export async function moveLesson(actor: Actor, lessonId: string, direction: "up" | "down") {
  return withTenant(actor, async (tx) => {
    const l = await loadLesson(tx, lessonId);
    await editTarget(tx, actor, l.courseId);
    const siblings = await tx
      .select()
      .from(contentLessons)
      .where(eq(contentLessons.sectionId, l.sectionId))
      .orderBy(asc(contentLessons.position), asc(contentLessons.createdAt))
      .for("update");
    const moved = swap(siblings, lessonId, direction);
    if (!moved) return false;
    for (const [i, row] of moved.entries()) {
      if (row.position !== i) await tx.update(contentLessons).set({ position: i }).where(eq(contentLessons.id, row.id));
    }
    await audit(tx, actor, "content.lesson_move", "lesson", lessonId, { courseId: l.courseId, direction });
    return true;
  });
}

export async function deleteLesson(actor: Actor, lessonId: string) {
  return change(actor, async (tx, later) => {
    const l = await lessonForChange(tx, actor, lessonId);
    await tx.delete(contentLessons).where(eq(contentLessons.id, l.id));
    const key = storedFileKey(l.kind, l.content);
    if (key) later.deleteKeys.push(key);
    await audit(tx, actor, "content.lesson_delete", "lesson", l.id, { courseId: l.courseId, title: l.title, kind: l.kind });
    await resyncIf(tx, actor, l.courseId, later, countsTowardProgress(l));
    return { courseId: l.courseId };
  });
}

/** Changes the lesson's type. Its content (and any uploaded file) is removed. */
export async function setLessonKind(actor: Actor, lessonId: string, kind: string) {
  if (!isLessonKind(kind)) throw new ValidationError("Pick a lesson type: video, PDF, text, link or live class.");
  return storeContent(actor, lessonId, { kind, content: {}, action: "content.lesson_kind" });
}

/** Rich text for a text lesson. Sanitised before it is stored. */
export async function setTextContent(actor: Actor, lessonId: string, html: string) {
  if ((html ?? "").length > MAX_TEXT_HTML) throw new ValidationError("This text is too long for one lesson. Split it into two lessons.");
  const clean = sanitizeLessonHtml(html);
  if (textLength(clean) === 0) throw new ValidationError("Write the lesson text before saving.");
  return storeContent(actor, lessonId, { expect: "text", content: { html: clean }, action: "content.lesson_text" });
}

/** An external link lesson. */
export async function setLinkContent(actor: Actor, lessonId: string, url: string) {
  const clean = normaliseLink(url);
  if (!clean) throw new ValidationError("Enter a full web address that starts with https://.");
  return storeContent(actor, lessonId, { expect: "link", content: { url: clean }, action: "content.lesson_link" });
}

/** A YouTube or Vimeo video. */
export async function setVideoLink(actor: Actor, lessonId: string, url: string) {
  const v = parseVideoUrl(url);
  if (!v) throw new ValidationError("Paste a YouTube or Vimeo link, like https://www.youtube.com/watch?v=… or https://vimeo.com/….");
  return storeContent(actor, lessonId, { expect: "video", content: v, action: "content.lesson_video_link" });
}

/** Removes the lesson's video, PDF, text or link. Students stop seeing it until new content is added. */
export async function clearLessonContent(actor: Actor, lessonId: string) {
  return storeContent(actor, lessonId, { content: {}, action: "content.lesson_clear" });
}

/**
 * Stores new content for a lesson (and optionally a new kind), keeps `ready` in step,
 * deletes the replaced file after commit and recounts progress if the lesson now
 * counts (or stops counting) toward the percentage. Used by uploads too.
 */
export async function storeContent(
  actor: Actor,
  lessonId: string,
  input: { kind?: LessonKind; expect?: LessonKind; content: LessonContent; action: string; tx?: Tx; later?: AfterCommit },
) {
  const run = async (tx: Tx, later: AfterCommit) => {
    const l = await lessonForChange(tx, actor, lessonId);
    if (input.expect && l.kind !== input.expect) {
      throw new ConflictError(`This is a ${l.kind} lesson. Change its type first if you want to add ${input.expect} content.`, "wrong_kind");
    }
    const kind = input.kind ?? l.kind;
    const ready = readyFor(kind, input.content);
    const oldKey = storedFileKey(l.kind, l.content);
    const newKey = storedFileKey(kind, input.content);
    const [after] = await tx
      .update(contentLessons)
      .set({ kind, content: input.content, ready, updatedAt: new Date() })
      .where(eq(contentLessons.id, l.id))
      .returning();
    if (oldKey && oldKey !== newKey) later.deleteKeys.push(oldKey);
    await audit(tx, actor, input.action, "lesson", l.id, { courseId: l.courseId, kind, ready, ...(kind !== l.kind && { from: l.kind }) });
    await resyncIf(tx, actor, l.courseId, later, countsTowardProgress(l) !== countsTowardProgress(after));
    return after;
  };
  if (input.tx && input.later) return run(input.tx, input.later);
  return change(actor, run);
}

/* ───────────────────────────── Ordering ───────────────────────────── */

/** The list with `id` swapped with its neighbour, or null when it's already at that end. */
function swap<T extends { id: string }>(rows: T[], id: string, direction: "up" | "down"): T[] | null {
  const i = rows.findIndex((r) => r.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return null;
  const out = [...rows];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export type { AfterCommit };
export { afterCommit, editTarget };
