/**
 * Curriculum: sections and lessons of a course (PRD pages 5 and 7). Moved from core
 * by foundation-lock unchanged in behaviour; content-progress builds on it.
 */
import { asc, eq, sql } from "drizzle-orm";
import { assertCan, type Actor } from "@/server/authz/engine";
import { audit, courseTarget, withTenant } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { contentLessons, contentSections } from "./schema";

function uni(actor: Actor) {
  return actor.universityId!;
}

export type CurriculumSection = typeof contentSections.$inferSelect & { lessons: (typeof contentLessons.$inferSelect)[] };

export async function getCurriculum(actor: Actor, courseId: string): Promise<CurriculumSection[]> {
  return withTenant(actor, async (tx) => {
    const target = await courseTarget(tx, uni(actor), courseId);
    assertCan(actor, "course.view", target);
    const sections = await tx.select().from(contentSections).where(eq(contentSections.courseId, courseId)).orderBy(asc(contentSections.position));
    const lessons = await tx.select().from(contentLessons).where(eq(contentLessons.courseId, courseId)).orderBy(asc(contentLessons.position));
    return sections.map((s) => ({ ...s, lessons: lessons.filter((l) => l.sectionId === s.id) }));
  });
}

export async function addSection(actor: Actor, courseId: string, title: string) {
  if (title.trim().length < 2) throw new ValidationError("Give the section a title, like Week 1.");
  return withTenant(actor, async (tx) => {
    const target = await courseTarget(tx, uni(actor), courseId);
    assertCan(actor, "course.update", target);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(contentSections).where(eq(contentSections.courseId, courseId));
    const [s] = await tx.insert(contentSections).values({ universityId: uni(actor), courseId, title: title.trim(), position: n }).returning();
    await audit(tx, actor, "course.add_section", "course", courseId, { title: s.title });
    return s;
  });
}

export async function addLesson(actor: Actor, courseId: string, sectionId: string, input: { title: string; kind: string }) {
  if (input.title.trim().length < 2) throw new ValidationError("Give the lesson a title.");
  return withTenant(actor, async (tx) => {
    const target = await courseTarget(tx, uni(actor), courseId);
    assertCan(actor, "course.update", target);
    const [section] = await tx.select().from(contentSections).where(eq(contentSections.id, sectionId));
    if (!section || section.courseId !== courseId) throw new NotFoundError("Section");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(contentLessons).where(eq(contentLessons.sectionId, sectionId));
    const [l] = await tx
      .insert(contentLessons)
      .values({ universityId: uni(actor), courseId, sectionId, title: input.title.trim(), kind: input.kind, position: n })
      .returning();
    await audit(tx, actor, "course.add_lesson", "course", courseId, { title: l.title });
    return l;
  });
}
