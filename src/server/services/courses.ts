/** Products → Courses (PRD pages 5 and 7). HOD creates courses inside their own department. */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courseSections, courses, departments, enrolments, lessons } from "@/db/schema";
import { assertCan, reach, type Actor, type Target } from "../authz/engine";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { audit, withTenant } from "../tenant";

function uni(actor: Actor) {
  return actor.universityId!;
}

export async function courseTarget(tx: Tx, universityId: string, courseId: string): Promise<{ course: typeof courses.$inferSelect; target: Target }> {
  const [course] = await tx.select().from(courses).where(eq(courses.id, courseId));
  if (!course) throw new NotFoundError("Course");
  const bs = await tx.select({ id: batches.id }).from(batches).where(eq(batches.courseId, courseId));
  return { course, target: { universityId, departmentIds: [course.departmentId], batchIds: bs.map((b) => b.id) } };
}

export async function listCourses(actor: Actor) {
  const r = reach(actor, "course.view", uni(actor));
  if (!r.all && r.departmentIds.size === 0 && r.batchIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    let courseIds: string[] | null = null;
    if (!r.all) {
      const fromBatches = r.batchIds.size
        ? (await tx.select({ id: batches.courseId }).from(batches).where(inArray(batches.id, [...r.batchIds]))).map((b) => b.id)
        : [];
      const fromDepts = r.departmentIds.size
        ? (await tx.select({ id: courses.id }).from(courses).where(inArray(courses.departmentId, [...r.departmentIds]))).map((c) => c.id)
        : [];
      courseIds = [...new Set([...fromBatches, ...fromDepts])];
      if (courseIds.length === 0) return [];
    }
    const rows = await tx
      .select({
        id: courses.id,
        title: courses.title,
        status: courses.status,
        pricePaise: courses.pricePaise,
        departmentId: courses.departmentId,
        departmentName: departments.name,
        batchCount: sql<number>`(select count(*)::int from batches b where b.course_id = ${courses.id})`,
        studentCount: sql<number>`(select count(*)::int from enrolments e where e.course_id = ${courses.id} and e.status = 'active')`,
      })
      .from(courses)
      .innerJoin(departments, eq(departments.id, courses.departmentId))
      .where(courseIds ? inArray(courses.id, courseIds) : undefined)
      .orderBy(courses.title);
    return rows;
  });
}

export type CourseInput = {
  departmentId: string;
  title: string;
  description?: string;
  pricePaise: number;
  gstRateBp?: number;
  certificateEnabled?: boolean;
  programId?: string | null;
};

function validateCourse(input: Partial<CourseInput>) {
  if (input.title !== undefined && input.title.trim().length < 3) throw new ValidationError("Give the course a title.");
  if (input.pricePaise !== undefined && (!Number.isInteger(input.pricePaise) || input.pricePaise < 0))
    throw new ValidationError("Price must be zero or more.");
  if (input.gstRateBp !== undefined && ![0, 500, 1200, 1800, 2800].includes(input.gstRateBp))
    throw new ValidationError("GST rate must be 0, 5, 12, 18 or 28%.");
}

export async function createCourse(actor: Actor, input: CourseInput) {
  assertCan(actor, "course.create", { universityId: uni(actor), departmentIds: [input.departmentId] });
  validateCourse(input);
  return withTenant(actor, async (tx) => {
    const [dept] = await tx.select().from(departments).where(eq(departments.id, input.departmentId));
    if (!dept) throw new NotFoundError("Department");
    const [course] = await tx
      .insert(courses)
      .values({
        universityId: uni(actor),
        departmentId: input.departmentId,
        title: input.title.trim(),
        description: input.description?.trim() ?? "",
        pricePaise: input.pricePaise,
        gstRateBp: input.gstRateBp ?? 1800,
        certificateEnabled: input.certificateEnabled ?? true,
        programId: input.programId ?? null,
        createdBy: actor.userId,
      })
      .returning();
    await audit(tx, actor, "course.create", "course", course.id, { title: course.title, departmentId: dept.id });
    return course;
  });
}

export async function updateCourse(
  actor: Actor,
  courseId: string,
  patch: Partial<Omit<CourseInput, "departmentId">> & { status?: "draft" | "published" | "archived" },
) {
  validateCourse(patch);
  return withTenant(actor, async (tx) => {
    const { target } = await courseTarget(tx, uni(actor), courseId);
    assertCan(actor, "course.update", target);
    if (patch.status === "published") {
      const open = await tx.select({ id: batches.id }).from(batches).where(and(eq(batches.courseId, courseId), eq(batches.status, "open")));
      if (open.length === 0) throw new ValidationError("Add at least one open batch before publishing.");
    }
    const [course] = await tx
      .update(courses)
      .set({
        ...(patch.title !== undefined && { title: patch.title.trim() }),
        ...(patch.description !== undefined && { description: patch.description.trim() }),
        ...(patch.pricePaise !== undefined && { pricePaise: patch.pricePaise }),
        ...(patch.gstRateBp !== undefined && { gstRateBp: patch.gstRateBp }),
        ...(patch.certificateEnabled !== undefined && { certificateEnabled: patch.certificateEnabled }),
        ...(patch.programId !== undefined && { programId: patch.programId }),
        ...(patch.status !== undefined && { status: patch.status }),
      })
      .where(eq(courses.id, courseId))
      .returning();
    await audit(tx, actor, "course.update", "course", courseId, patch as Record<string, unknown>);
    return course;
  });
}

export async function deleteCourse(actor: Actor, courseId: string) {
  return withTenant(actor, async (tx) => {
    const { target } = await courseTarget(tx, uni(actor), courseId);
    assertCan(actor, "course.delete", target);
    const [e] = await tx.select({ id: enrolments.id }).from(enrolments).where(eq(enrolments.courseId, courseId)).limit(1);
    if (e) throw new ConflictError("Students have enrolled in this course. Archive it instead.");
    await tx.delete(courses).where(eq(courses.id, courseId));
    await audit(tx, actor, "course.delete", "course", courseId);
  });
}

export async function getCourse(actor: Actor, courseId: string) {
  return withTenant(actor, async (tx) => {
    const { course, target } = await courseTarget(tx, uni(actor), courseId);
    assertCan(actor, "course.view", target);
    const [dept] = await tx.select().from(departments).where(eq(departments.id, course.departmentId));
    const sections = await tx.select().from(courseSections).where(eq(courseSections.courseId, courseId)).orderBy(asc(courseSections.position));
    const lessonRows = await tx.select().from(lessons).where(eq(lessons.courseId, courseId)).orderBy(asc(lessons.position));
    return {
      course,
      department: dept,
      curriculum: sections.map((s) => ({ ...s, lessons: lessonRows.filter((l) => l.sectionId === s.id) })),
    };
  });
}

export async function addSection(actor: Actor, courseId: string, title: string) {
  return withTenant(actor, async (tx) => {
    const { target } = await courseTarget(tx, uni(actor), courseId);
    assertCan(actor, "course.update", target);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(courseSections).where(eq(courseSections.courseId, courseId));
    const [s] = await tx.insert(courseSections).values({ universityId: uni(actor), courseId, title: title.trim(), position: n }).returning();
    await audit(tx, actor, "course.add_section", "course", courseId, { title: s.title });
    return s;
  });
}

export async function addLesson(actor: Actor, courseId: string, sectionId: string, input: { title: string; kind: string }) {
  return withTenant(actor, async (tx) => {
    const { target } = await courseTarget(tx, uni(actor), courseId);
    assertCan(actor, "course.update", target);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(lessons).where(eq(lessons.sectionId, sectionId));
    const [l] = await tx
      .insert(lessons)
      .values({ universityId: uni(actor), courseId, sectionId, title: input.title.trim(), kind: input.kind, position: n })
      .returning();
    await audit(tx, actor, "course.add_lesson", "course", courseId, { title: l.title });
    return l;
  });
}
