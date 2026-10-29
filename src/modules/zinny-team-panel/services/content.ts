/**
 * Content review (platform.content_review): a queue of published courses across
 * universities with read-only previews. Content QA marks a course reviewed or flags an
 * issue with a note; Account Managers can read the flags to follow up. Nothing here
 * writes to a university's own content.
 */
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { batches, batchSlots, courses, departments, enrolments, programs, roleAssignments, universities, users } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { assertPlatform, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { platContentFlags, platCourseReviews } from "../schema";
import { assertSeeContentFlags } from "../lib/access";
import { FLAG_CATEGORIES } from "../lib/constants";
import { db, isUuid, logAction } from "./shared";

export type QueueTab = "to-review" | "flagged" | "cleared";
export const QUEUE_TABS: QueueTab[] = ["to-review", "flagged", "cleared"];

const openFlagCount = sql<number>`(select count(*) from ${platContentFlags} f where f.course_id = ${courses.id} and f.status = 'open')`.mapWith(Number);

function tabWhere(tab: QueueTab): SQL {
  switch (tab) {
    case "to-review":
      return sql`${courses.status} = 'published' and ${platCourseReviews.id} is null and ${openFlagCount} = 0`;
    case "flagged":
      return sql`${openFlagCount} > 0`;
    case "cleared":
      return sql`${platCourseReviews.id} is not null and ${openFlagCount} = 0`;
  }
}

export type QueueRow = {
  courseId: string;
  title: string;
  status: string;
  createdAt: Date;
  pricePaise: number;
  universityId: string;
  universityName: string;
  departmentName: string;
  batches: number;
  students: number;
  openFlags: number;
  reviewedAt: Date | null;
  reviewedByName: string | null;
};

/** One tab of the queue (newest courses first) and the size of every tab. */
export async function reviewQueue(actor: Actor, tab: QueueTab, opts: { universityId?: string } = {}) {
  assertSeeContentFlags(actor);
  const reviewer = alias(users, "reviewer");
  const uniFilter = opts.universityId && isUuid(opts.universityId) ? eq(courses.universityId, opts.universityId) : undefined;
  const base = () =>
    db()
      .select({
        courseId: courses.id,
        title: courses.title,
        status: courses.status,
        createdAt: courses.createdAt,
        pricePaise: courses.pricePaise,
        universityId: universities.id,
        universityName: universities.name,
        departmentName: departments.name,
        batches: sql<number>`(select count(*) from ${batches} b where b.course_id = ${courses.id})`.mapWith(Number),
        students: sql<number>`(select count(*) from ${enrolments} e where e.course_id = ${courses.id} and e.status = 'active')`.mapWith(Number),
        openFlags: openFlagCount,
        reviewedAt: platCourseReviews.reviewedAt,
        reviewedByName: reviewer.name,
      })
      .from(courses)
      .innerJoin(universities, eq(universities.id, courses.universityId))
      .innerJoin(departments, eq(departments.id, courses.departmentId))
      .leftJoin(platCourseReviews, eq(platCourseReviews.courseId, courses.id))
      .leftJoin(reviewer, eq(reviewer.id, platCourseReviews.reviewedBy));
  const rows = await base()
    .where(and(tabWhere(tab), uniFilter))
    .orderBy(tab === "cleared" ? desc(platCourseReviews.reviewedAt) : desc(courses.createdAt))
    .limit(200);
  const [counts] = await db()
    .select({
      toReview: sql<number>`count(*) filter (where ${tabWhere("to-review")})`.mapWith(Number),
      flagged: sql<number>`count(*) filter (where ${tabWhere("flagged")})`.mapWith(Number),
      cleared: sql<number>`count(*) filter (where ${tabWhere("cleared")})`.mapWith(Number),
    })
    .from(courses)
    .leftJoin(platCourseReviews, eq(platCourseReviews.courseId, courses.id))
    .where(uniFilter);
  return { rows: rows as QueueRow[], counts: { "to-review": counts.toReview, flagged: counts.flagged, cleared: counts.cleared } as Record<QueueTab, number> };
}

/** How many courses wait for review and how many have open flags, for the platform home. */
export async function reviewCounts(actor: Actor) {
  assertSeeContentFlags(actor);
  const [c] = await db()
    .select({
      toReview: sql<number>`count(*) filter (where ${tabWhere("to-review")})`.mapWith(Number),
      flaggedCourses: sql<number>`count(*) filter (where ${tabWhere("flagged")})`.mapWith(Number),
    })
    .from(courses)
    .leftJoin(platCourseReviews, eq(platCourseReviews.courseId, courses.id));
  const [f] = await db().select({ n: sql<number>`count(*)`.mapWith(Number) }).from(platContentFlags).where(eq(platContentFlags.status, "open"));
  return { toReview: c.toReview, flaggedCourses: c.flaggedCourses, openFlags: f.n };
}

const FACULTY_ROLES = ["permanent_faculty", "visiting_faculty"] as const;

/** A read-only preview of one course: details, batches with timings and faculty, and its flags. */
export async function coursePreview(actor: Actor, courseId: string) {
  assertSeeContentFlags(actor);
  if (!isUuid(courseId)) throw new NotFoundError("Course");
  const conn = db();
  const [row] = await conn
    .select({
      course: courses,
      universityName: universities.name,
      universitySlug: universities.slug,
      departmentName: departments.name,
      programName: programs.name,
      createdByName: users.name,
    })
    .from(courses)
    .innerJoin(universities, eq(universities.id, courses.universityId))
    .innerJoin(departments, eq(departments.id, courses.departmentId))
    .leftJoin(programs, eq(programs.id, courses.programId))
    .leftJoin(users, eq(users.id, courses.createdBy))
    .where(eq(courses.id, courseId));
  if (!row) throw new NotFoundError("Course");

  const bs = await conn.select().from(batches).where(eq(batches.courseId, courseId)).orderBy(asc(batches.startDate), asc(batches.name));
  const ids = bs.map((b) => b.id);
  const [slots, seats, faculty] = ids.length
    ? await Promise.all([
        conn.select().from(batchSlots).where(inArray(batchSlots.batchId, ids)).orderBy(asc(batchSlots.weekday), asc(batchSlots.startTime)),
        conn
          .select({ batchId: enrolments.batchId, n: sql<number>`count(*)`.mapWith(Number) })
          .from(enrolments)
          .where(and(inArray(enrolments.batchId, ids), inArray(enrolments.status, ["active", "held"])))
          .groupBy(enrolments.batchId),
        conn
          .select({ batchId: roleAssignments.batchId, name: users.name, role: roleAssignments.role })
          .from(roleAssignments)
          .innerJoin(users, eq(users.id, roleAssignments.userId))
          .where(and(inArray(roleAssignments.batchId, ids), inArray(roleAssignments.role, [...FACULTY_ROLES]), isNull(roleAssignments.revokedAt))),
      ])
    : [[], [], []];

  const author = alias(users, "author");
  const resolver = alias(users, "resolver");
  const reviewer = alias(users, "reviewer");
  const flags = await conn
    .select({ flag: platContentFlags, authorName: author.name, resolverName: resolver.name })
    .from(platContentFlags)
    .leftJoin(author, eq(author.id, platContentFlags.createdBy))
    .leftJoin(resolver, eq(resolver.id, platContentFlags.resolvedBy))
    .where(eq(platContentFlags.courseId, courseId))
    .orderBy(desc(platContentFlags.createdAt));
  const [review] = await conn
    .select({ review: platCourseReviews, reviewerName: reviewer.name })
    .from(platCourseReviews)
    .leftJoin(reviewer, eq(reviewer.id, platCourseReviews.reviewedBy))
    .where(eq(platCourseReviews.courseId, courseId));

  const seatsOf = new Map(seats.map((s) => [s.batchId, s.n]));
  return {
    course: row.course,
    universityName: row.universityName,
    universitySlug: row.universitySlug,
    departmentName: row.departmentName,
    programName: row.programName,
    createdByName: row.createdByName,
    batches: bs.map((b) => ({
      ...b,
      slots: slots.filter((s) => s.batchId === b.id),
      taken: seatsOf.get(b.id) ?? 0,
      faculty: faculty.filter((f) => f.batchId === b.id).map((f) => f.name),
    })),
    flags: flags.map((f) => ({ ...f.flag, authorName: f.authorName, resolverName: f.resolverName })),
    review: review ? { ...review.review, reviewerName: review.reviewerName } : null,
  };
}

async function courseOrThrow(courseId: string) {
  if (!isUuid(courseId)) throw new NotFoundError("Course");
  const [c] = await db().select({ id: courses.id, universityId: courses.universityId, title: courses.title }).from(courses).where(eq(courses.id, courseId));
  if (!c) throw new NotFoundError("Course");
  return c;
}

/** Records that Content QA reviewed the course and found nothing to flag. */
export async function markReviewed(actor: Actor, courseId: string, note = "") {
  assertPlatform(actor, "platform.content_review");
  const c = await courseOrThrow(courseId);
  const text = note.trim() || null;
  if (text && text.length > 1000) throw new ValidationError("Keep the note under 1,000 characters.");
  return db().transaction(async (tx) => {
    const [open] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(platContentFlags)
      .where(and(eq(platContentFlags.courseId, courseId), eq(platContentFlags.status, "open")));
    if (open.n > 0) throw new ConflictError("This course has open flags. Resolve them before you clear it.");
    const values = { reviewedBy: actor.userId || null, reviewedAt: new Date(), note: text };
    const [row] = await tx
      .insert(platCourseReviews)
      .values({ universityId: c.universityId, courseId, ...values })
      .onConflictDoUpdate({ target: platCourseReviews.courseId, set: values })
      .returning();
    await logAction(tx, actor, { universityId: c.universityId }, "plat.review.clear", "course", courseId, { title: c.title, note: text });
    return row;
  });
}

const CATEGORY_IDS = new Set<string>(FLAG_CATEGORIES.map((c) => c.id));

/** Flags an issue on a course with a note for the university's Account Manager. */
export async function flagCourse(actor: Actor, courseId: string, input: { category: string; note: string }) {
  assertPlatform(actor, "platform.content_review");
  const c = await courseOrThrow(courseId);
  if (!CATEGORY_IDS.has(input.category)) throw new ValidationError("Pick what kind of issue this is.");
  const note = input.note.trim();
  if (note.length < 10) throw new ValidationError("Describe the issue in a sentence or two, so the Account Manager can explain it to the university.");
  if (note.length > 2000) throw new ValidationError("Keep the note under 2,000 characters.");
  return db().transaction(async (tx) => {
    const [flag] = await tx
      .insert(platContentFlags)
      .values({ universityId: c.universityId, courseId, category: input.category, note, createdBy: actor.userId || null })
      .returning();
    // Flagging a course also counts as reviewing it.
    const reviewed = { reviewedBy: actor.userId || null, reviewedAt: new Date() };
    await tx
      .insert(platCourseReviews)
      .values({ universityId: c.universityId, courseId, ...reviewed })
      .onConflictDoUpdate({ target: platCourseReviews.courseId, set: reviewed });
    await logAction(tx, actor, { universityId: c.universityId }, "plat.flag.create", "plat_content_flag", flag.id, {
      courseId,
      title: c.title,
      category: input.category,
    });
    return flag;
  });
}

/** Closes a flag once the university has dealt with it, saying what changed. */
export async function resolveFlag(actor: Actor, flagId: string, resolutionNote: string) {
  assertPlatform(actor, "platform.content_review");
  if (!isUuid(flagId)) throw new NotFoundError("Flag");
  const note = resolutionNote.trim();
  if (note.length < 5) throw new ValidationError("Say how the issue was resolved.");
  if (note.length > 1000) throw new ValidationError("Keep the note under 1,000 characters.");
  return db().transaction(async (tx) => {
    const [f] = await tx.select().from(platContentFlags).where(eq(platContentFlags.id, flagId)).for("update");
    if (!f) throw new NotFoundError("Flag");
    if (f.status !== "open") throw new ConflictError("This flag is already resolved.");
    const [row] = await tx
      .update(platContentFlags)
      .set({ status: "resolved", resolvedBy: actor.userId || null, resolvedAt: new Date(), resolutionNote: note })
      .where(eq(platContentFlags.id, flagId))
      .returning();
    await logAction(tx, actor, { universityId: f.universityId }, "plat.flag.resolve", "plat_content_flag", f.id, { courseId: f.courseId });
    return row;
  });
}

/** Open flags across universities, newest first. Account Managers read these to follow up. */
export async function listOpenFlags(actor: Actor, opts: { universityId?: string; limit?: number } = {}) {
  assertSeeContentFlags(actor);
  return db()
    .select({
      id: platContentFlags.id,
      courseId: platContentFlags.courseId,
      courseTitle: courses.title,
      universityId: universities.id,
      universityName: universities.name,
      category: platContentFlags.category,
      note: platContentFlags.note,
      createdAt: platContentFlags.createdAt,
      authorName: users.name,
    })
    .from(platContentFlags)
    .innerJoin(courses, eq(courses.id, platContentFlags.courseId))
    .innerJoin(universities, eq(universities.id, platContentFlags.universityId))
    .leftJoin(users, eq(users.id, platContentFlags.createdBy))
    .where(and(eq(platContentFlags.status, "open"), opts.universityId && isUuid(opts.universityId) ? eq(platContentFlags.universityId, opts.universityId) : undefined))
    .orderBy(desc(platContentFlags.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));
}
