/**
 * What the marketplace needs from the curriculum: an outline a buyer can read before they
 * own a course, and the copy of a lesson that a single lecture is sold as.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { courseCurriculum, loadLesson } from "./internal";
import { contentLessons, contentSections } from "./schema";

export type RecordedOutline = {
  sections: { title: string; lessons: { title: string; kind: string; durationMinutes: number }[] }[];
  videos: number;
};

/** The ready lessons a buyer gets, by title only: nothing here opens a lesson's content. Live classes aren't part of a recording. */
export async function recordedOutline(tx: Tx, courseId: string): Promise<RecordedOutline> {
  const { sections, lessons } = await courseCurriculum(tx, courseId);
  const ready = lessons.filter((l) => l.ready && l.kind !== "live");
  return {
    sections: sections
      .map((s) => ({
        title: s.title,
        lessons: ready.filter((l) => l.sectionId === s.id).map((l) => ({ title: l.title, kind: l.kind, durationMinutes: l.durationMinutes })),
      }))
      .filter((s) => s.lessons.length > 0),
    videos: ready.filter((l) => l.kind === "video").length,
  };
}

/** The ready video lessons of these courses: what an institute can sell. */
export async function readyVideoLessons(tx: Tx, courseIds: string[]) {
  if (courseIds.length === 0) return [];
  return tx
    .select({ id: contentLessons.id, courseId: contentLessons.courseId, title: contentLessons.title })
    .from(contentLessons)
    .where(and(inArray(contentLessons.courseId, courseIds), eq(contentLessons.kind, "video"), eq(contentLessons.ready, true)))
    .orderBy(contentLessons.position);
}

/** The course a lesson belongs to. */
export async function lessonCourseId(tx: Tx, lessonId: string) {
  return (await loadLesson(tx, lessonId)).courseId;
}

/**
 * Makes a ready video lesson the only lesson of `courseId`, so a lecture sold on its own
 * opens nothing else. The two lessons share the stored file (service.ts keeps it while
 * either one uses it). Returns null when the lesson can't be sold.
 */
export async function copyLectureInto(tx: Tx, universityId: string, lessonId: string, courseId: string) {
  const lesson = await loadLesson(tx, lessonId);
  if (lesson.kind !== "video" || !lesson.ready) return null;
  const [section] = await tx.insert(contentSections).values({ universityId, courseId, title: "Lecture" }).returning();
  const [copy] = await tx
    .insert(contentLessons)
    .values({
      universityId,
      courseId,
      sectionId: section.id,
      title: lesson.title,
      kind: lesson.kind,
      content: lesson.content,
      ready: true,
      durationMinutes: lesson.durationMinutes,
    })
    .returning();
  return copy;
}
