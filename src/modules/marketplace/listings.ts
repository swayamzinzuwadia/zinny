/**
 * The institute's side of the marketplace: what it sells, at what price, and how many
 * bought it. Listing needs course.update on the course, so a HOD manages their own
 * department's and an Institute Admin manages all of them.
 *
 * A whole course is sold as it is. A single lecture becomes a one-lesson course of its own,
 * so buying it opens that lecture and nothing else.
 */
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { courses } from "@/db/schema";
import { copyLectureInto, lessonCourseId, readyVideoLessons, recordedOutline } from "@/modules/content-progress/recorded";
import { assertCan, audit, courseTarget, createLectureCourse, ensureRecordedBatch, reach, withTenant, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "@/server/errors";
import { mktListings, type ListingKind, type ListingStatus } from "./schema";

const uni = (actor: Actor) => actor.universityId!;

type ListingFields = { title: string; description: string; pricePaise: number };

function cleanFields(input: ListingFields): ListingFields {
  const title = input.title.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (title.length < 3 || title.length > 120) throw new ValidationError("Give the listing a title of 3 to 120 characters.");
  if (description.length > 2000) throw new ValidationError("Keep the description under 2,000 characters.");
  if (!Number.isInteger(input.pricePaise) || input.pricePaise < 100) throw new ValidationError("Set a price of at least ₹1. The marketplace sells paid courses only.");
  return { title, description, pricePaise: input.pricePaise };
}

const rethrowDuplicate = (err: unknown) => {
  if (isUniqueViolation(err)) throw new ConflictError("This is already on the marketplace.", "already_listed");
  throw err;
};

export async function listListings(actor: Actor) {
  const r = reach(actor, "course.update", uni(actor));
  if (!r.all && r.departmentIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        listing: mktListings,
        departmentId: courses.departmentId,
        buyers: sql<number>`(select count(*)::int from enrolments e where e.batch_id = ${mktListings.batchId} and e.status in ('active', 'completed'))`,
      })
      .from(mktListings)
      .innerJoin(courses, eq(courses.id, mktListings.courseId))
      .orderBy(desc(mktListings.createdAt));
    return rows.filter((x) => r.all || r.departmentIds.has(x.departmentId)).map(({ listing, buyers }) => ({ ...listing, buyers }));
  });
}

/** Courses this person can list, each with its unlisted video lectures. Lecture courses are archived, so they never appear. */
export async function listableSources(actor: Actor) {
  const r = reach(actor, "course.update", uni(actor));
  if (!r.all && r.departmentIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    const mine = (
      await tx
        .select({ id: courses.id, title: courses.title, departmentId: courses.departmentId })
        .from(courses)
        .where(inArray(courses.status, ["draft", "published"]))
        .orderBy(courses.title)
    ).filter((c) => r.all || r.departmentIds.has(c.departmentId));
    const lessons = await readyVideoLessons(tx, mine.map((c) => c.id));
    const listed = await tx.select({ courseId: mktListings.courseId, sourceLessonId: mktListings.sourceLessonId }).from(mktListings);
    const listedCourses = new Set(listed.map((l) => l.courseId));
    const listedLessons = new Set(listed.map((l) => l.sourceLessonId));
    return mine
      .map((c) => {
        const videos = lessons.filter((l) => l.courseId === c.id);
        return {
          id: c.id,
          title: c.title,
          canSellWhole: videos.length > 0 && !listedCourses.has(c.id),
          lectures: videos.filter((l) => !listedLessons.has(l.id)).map((l) => ({ id: l.id, title: l.title })),
        };
      })
      .filter((c) => c.canSellWhole || c.lectures.length > 0);
  });
}

async function loadCourseForListing(tx: Tx, actor: Actor, courseId: string) {
  const [course] = await tx.select().from(courses).where(eq(courses.id, courseId));
  if (!course) throw new NotFoundError("Course");
  assertCan(actor, "course.update", await courseTarget(tx, uni(actor), course.id));
  return course;
}

export async function createListing(actor: Actor, input: ListingFields & { kind: ListingKind; sourceId: string }) {
  const fields = cleanFields(input);
  return withTenant(actor, async (tx) => {
    let courseId: string;
    let sourceLessonId: string | null = null;
    let batchId: string;

    if (input.kind === "course") {
      const course = await loadCourseForListing(tx, actor, input.sourceId);
      if ((await recordedOutline(tx, course.id)).videos === 0) throw new ValidationError("Upload at least one video lesson to this course before listing it.");
      courseId = course.id;
      batchId = (await ensureRecordedBatch(tx, actor, course)).id;
    } else {
      const course = await loadCourseForListing(tx, actor, await lessonCourseId(tx, input.sourceId));
      const [taken] = await tx.select({ id: mktListings.id }).from(mktListings).where(eq(mktListings.sourceLessonId, input.sourceId));
      if (taken) throw new ConflictError("This lecture is already on the marketplace.", "already_listed");
      const lecture = await createLectureCourse(tx, actor, course, fields.title);
      if (!(await copyLectureInto(tx, uni(actor), input.sourceId, lecture.id))) throw new ValidationError("Only a video lesson with its video in place can be sold as a lecture.");
      courseId = lecture.id;
      sourceLessonId = input.sourceId;
      batchId = (await ensureRecordedBatch(tx, actor, lecture)).id;
    }

    const [listing] = await tx
      .insert(mktListings)
      .values({ universityId: uni(actor), courseId, batchId, kind: input.kind, sourceLessonId, createdBy: actor.userId, ...fields })
      .returning();
    await audit(tx, actor, "marketplace.list", "mkt_listing", listing.id, { kind: input.kind, courseId, title: fields.title, pricePaise: fields.pricePaise });
    return listing;
  }).catch(rethrowDuplicate);
}

async function loadListing(tx: Tx, actor: Actor, listingId: string) {
  const [listing] = await tx.select().from(mktListings).where(eq(mktListings.id, listingId));
  if (!listing) throw new NotFoundError("Listing");
  assertCan(actor, "course.update", await courseTarget(tx, uni(actor), listing.courseId));
  return listing;
}

export async function getListing(actor: Actor, listingId: string) {
  return withTenant(actor, (tx) => loadListing(tx, actor, listingId));
}

export async function updateListing(actor: Actor, listingId: string, input: ListingFields) {
  const fields = cleanFields(input);
  return withTenant(actor, async (tx) => {
    await loadListing(tx, actor, listingId);
    await tx.update(mktListings).set({ ...fields, updatedAt: new Date() }).where(eq(mktListings.id, listingId));
    await audit(tx, actor, "marketplace.update", "mkt_listing", listingId, fields);
  });
}

/** Paused listings leave the marketplace; people who already bought keep their access. */
export async function setListingStatus(actor: Actor, listingId: string, status: ListingStatus) {
  return withTenant(actor, async (tx) => {
    await loadListing(tx, actor, listingId);
    await tx.update(mktListings).set({ status, updatedAt: new Date() }).where(eq(mktListings.id, listingId));
    await audit(tx, actor, status === "live" ? "marketplace.resume" : "marketplace.pause", "mkt_listing", listingId);
  });
}
