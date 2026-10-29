/**
 * Small helpers shared by this module's services. Not for pages: pages call the services.
 */
import { asc, eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { Actor } from "@/server/core";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { hasContent, type LessonKind } from "./lib/kinds";
import { contentLessons, contentSections } from "./schema";

export type LessonRow = typeof contentLessons.$inferSelect;
export type SectionRow = typeof contentSections.$inferSelect;

export function uni(actor: Actor): string {
  if (!actor.universityId) throw new ForbiddenError("No university selected.");
  return actor.universityId;
}

export async function loadLesson(tx: Tx, lessonId: string, opts: { lock?: boolean } = {}): Promise<LessonRow> {
  if (!isUuid(lessonId)) throw new NotFoundError("Lesson");
  const q = tx.select().from(contentLessons).where(eq(contentLessons.id, lessonId));
  const [l] = opts.lock ? await q.for("update") : await q;
  if (!l) throw new NotFoundError("Lesson");
  return l;
}

export async function loadSection(tx: Tx, sectionId: string, opts: { lock?: boolean } = {}): Promise<SectionRow> {
  if (!isUuid(sectionId)) throw new NotFoundError("Section");
  const q = tx.select().from(contentSections).where(eq(contentSections.id, sectionId));
  const [s] = opts.lock ? await q.for("update") : await q;
  if (!s) throw new NotFoundError("Section");
  return s;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids from URLs and forms: anything that isn't a uuid is simply "not found" (no database error). */
export const isUuid = (v: string) => UUID.test(v);

/** Sections and lessons of a course, in curriculum order. */
export async function courseCurriculum(tx: Tx, courseId: string) {
  const sections = await tx
    .select()
    .from(contentSections)
    .where(eq(contentSections.courseId, courseId))
    .orderBy(asc(contentSections.position), asc(contentSections.title));
  const lessons = await tx
    .select()
    .from(contentLessons)
    .where(eq(contentLessons.courseId, courseId))
    .orderBy(asc(contentLessons.position), asc(contentLessons.createdAt));
  const order = new Map(sections.map((s, i) => [s.id, i]));
  const ordered = [...lessons].sort(
    (a, b) => (order.get(a.sectionId) ?? 0) - (order.get(b.sectionId) ?? 0) || a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  return { sections, lessons: ordered };
}

/** Whether a lesson with this kind and content is ready for students (live lessons always are). */
export const readyFor = (kind: LessonKind, content: LessonRow["content"]) => hasContent(kind, content);
