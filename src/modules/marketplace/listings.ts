/**
 * The institute's side of the marketplace: what it sells, at what price, and how many
 * bought it. Listing needs course.update on the course, so a HOD manages their own
 * department's and an Institute Admin manages all of them.
 *
 * A whole course is sold as it is. A single lecture becomes a one-lesson course of its own,
 * so buying it opens that lecture and nothing else.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { courses, enrolments, orders } from "@/db/schema";
import { copyCourseInto, copyLectureInto, lessonCourseId, readyVideoLessons, recordedOutline } from "@/modules/content-progress/recorded";
import { assertCan, audit, courseTarget, createLectureCourse, ensureRecordedBatch, reach, withTenant, type Actor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, isUniqueViolation } from "@/server/errors";
import { mktCodes, mktComboCourses, mktListings, type CodeKind, type CodeStatus, type ListingKind, type ListingStatus } from "./schema";

const uni = (actor: Actor) => actor.universityId!;

/** `compareAtPaise` is the usual price, shown struck through; leave it empty for no deal. */
type ListingFields = { title: string; description: string; pricePaise: number; compareAtPaise?: number | null };

function cleanFields(input: ListingFields) {
  const title = input.title.trim().replace(/\s+/g, " ");
  const description = input.description.trim();
  if (title.length < 3 || title.length > 120) throw new ValidationError("Give the listing a title of 3 to 120 characters.");
  if (description.length > 2000) throw new ValidationError("Keep the description under 2,000 characters.");
  if (!Number.isInteger(input.pricePaise) || input.pricePaise < 100) throw new ValidationError("Set a price of at least ₹1. The marketplace sells paid courses only.");
  const compareAtPaise = input.compareAtPaise ?? null;
  if (compareAtPaise !== null && (!Number.isInteger(compareAtPaise) || compareAtPaise <= input.pricePaise))
    throw new ValidationError("The compare-at price is the usual price, so it has to be higher than the price. Leave it empty for no deal.");
  return { title, description, pricePaise: input.pricePaise, compareAtPaise };
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
    const mine = rows.filter((x) => r.all || r.departmentIds.has(x.departmentId));
    const includes = await comboTitles(
      tx,
      mine.filter((x) => x.listing.kind === "combo").map((x) => x.listing.id),
    );
    return mine.map(({ listing, buyers }) => ({ ...listing, buyers, includes: includes.get(listing.id) ?? [] }));
  });
}

/** For each combo, the titles of the courses it was made from, in order. */
async function comboTitles(tx: Tx, listingIds: string[]) {
  const out = new Map<string, string[]>();
  if (listingIds.length === 0) return out;
  const rows = await tx
    .select({ listingId: mktComboCourses.listingId, title: courses.title })
    .from(mktComboCourses)
    .innerJoin(courses, eq(courses.id, mktComboCourses.courseId))
    .where(inArray(mktComboCourses.listingId, listingIds))
    .orderBy(asc(mktComboCourses.position));
  for (const r of rows) out.set(r.listingId, [...(out.get(r.listingId) ?? []), r.title]);
  return out;
}

/**
 * The admin dashboard card: what is on sale, how many bought it and what it earned, for the
 * listings this person manages. Earnings are before GST, from payments the gateway confirmed.
 */
export async function salesSummary(actor: Actor, today: string) {
  const r = reach(actor, "course.update", uni(actor));
  const empty = { live: 0, paused: 0, buyers: 0, earnedPaise: 0, earnedThisMonthPaise: 0 };
  if (!r.all && r.departmentIds.size === 0) return empty;
  return withTenant(actor, async (tx) => {
    const mine = (
      await tx
        .select({ status: mktListings.status, batchId: mktListings.batchId, departmentId: courses.departmentId })
        .from(mktListings)
        .innerJoin(courses, eq(courses.id, mktListings.courseId))
    ).filter((l) => r.all || r.departmentIds.has(l.departmentId));
    if (mine.length === 0) return empty;
    const batchIds = mine.map((l) => l.batchId);
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00+05:30`);
    const [[{ buyers }], [money]] = await Promise.all([
      tx
        .select({ buyers: sql<number>`count(*)::int` })
        .from(enrolments)
        .where(and(inArray(enrolments.batchId, batchIds), inArray(enrolments.status, ["active", "completed"]))),
      tx
        .select({
          total: sql<number>`coalesce(sum(${orders.basePaise}), 0)::int`,
          month: sql<number>`coalesce(sum(${orders.basePaise}) filter (where ${gte(orders.paidAt, monthStart)}), 0)::int`,
        })
        .from(orders)
        .where(and(inArray(orders.batchId, batchIds), eq(orders.status, "paid"), isNotNull(orders.gatewayPaymentId))),
    ]);
    return {
      live: mine.filter((l) => l.status === "live").length,
      paused: mine.filter((l) => l.status === "paused").length,
      buyers,
      earnedPaise: money.total,
      earnedThisMonthPaise: money.month,
    };
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

export async function createListing(actor: Actor, input: ListingFields & { kind: Exclude<ListingKind, "combo">; sourceId: string }) {
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

/* ───────────────────────────── Combos ───────────────────────────── */

/**
 * Sells several courses together at one price. The combo is a course of its own holding copies
 * of their recorded lessons, a section per course, so one purchase opens one course with one
 * progress bar and one refund. Lessons added to those courses later don't reach combo buyers.
 */
export async function createCombo(actor: Actor, input: ListingFields & { courseIds: string[] }) {
  const fields = cleanFields(input);
  const courseIds = [...new Set(input.courseIds)];
  if (courseIds.length < 2) throw new ValidationError("Choose at least two courses for a combo.");
  if (courseIds.length > 10) throw new ValidationError("A combo can hold up to 10 courses.");
  return withTenant(actor, async (tx) => {
    const sources = [];
    for (const id of courseIds) sources.push(await loadCourseForListing(tx, actor, id));
    const combo = await createLectureCourse(tx, actor, sources[0], fields.title);
    for (const [i, source] of sources.entries()) {
      if ((await copyCourseInto(tx, uni(actor), source.id, combo.id, source.title, i)) === 0)
        throw new ValidationError(`"${source.title}" has no ready recorded lessons yet, so it can't go in a combo.`);
    }
    const batchId = (await ensureRecordedBatch(tx, actor, combo)).id;
    const [listing] = await tx
      .insert(mktListings)
      .values({ universityId: uni(actor), courseId: combo.id, batchId, kind: "combo", createdBy: actor.userId, ...fields })
      .returning();
    await tx.insert(mktComboCourses).values(sources.map((s, i) => ({ listingId: listing.id, universityId: uni(actor), courseId: s.id, position: i })));
    await audit(tx, actor, "marketplace.list", "mkt_listing", listing.id, { kind: "combo", courseIds, title: fields.title, pricePaise: fields.pricePaise });
    return listing;
  });
}

/** Courses that can go in a combo: this person's courses with at least one ready recorded lesson. */
export async function comboSources(actor: Actor) {
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
    const videos = await readyVideoLessons(tx, mine.map((c) => c.id));
    const withVideo = new Set(videos.map((v) => v.courseId));
    return mine.filter((c) => withVideo.has(c.id)).map(({ id, title }) => ({ id, title }));
  });
}

/**
 * The hidden courses behind single lectures and combos. They exist only to be sold, so the
 * course list leaves them out; they are managed from the Marketplace section.
 */
export async function marketplaceOnlyCourseIds(actor: Actor) {
  const r = reach(actor, "course.view", uni(actor));
  if (!r.all && r.departmentIds.size === 0 && r.batchIds.size === 0) return new Set<string>();
  return withTenant(actor, async (tx) => {
    const rows = await tx.select({ courseId: mktListings.courseId }).from(mktListings).where(inArray(mktListings.kind, ["lecture", "combo"]));
    return new Set(rows.map((r) => r.courseId));
  });
}

/* ───────────────────────────── One course's page ───────────────────────────── */

/** The course editor's Marketplace tab: how this course is sold, and what of it could be. */
export async function courseMarketplace(actor: Actor, courseId: string) {
  return withTenant(actor, async (tx) => {
    const course = await loadCourseForListing(tx, actor, courseId);
    const lessons = await readyVideoLessons(tx, [course.id]);
    // Spelled out in full: with no join, drizzle leaves the column bare and it would match enrolments.batch_id.
    const buyers = sql<number>`(select count(*)::int from enrolments e where e.batch_id = mkt_listings.batch_id and e.status in ('active', 'completed'))`;
    const [whole] = await tx.select({ listing: mktListings, buyers }).from(mktListings).where(eq(mktListings.courseId, course.id));
    const lectures = lessons.length
      ? await tx
          .select({ listing: mktListings, buyers })
          .from(mktListings)
          .where(inArray(mktListings.sourceLessonId, lessons.map((l) => l.id)))
          .orderBy(asc(mktListings.createdAt))
      : [];
    const combos = await tx
      .select({ id: mktListings.id, title: mktListings.title, status: mktListings.status })
      .from(mktComboCourses)
      .innerJoin(mktListings, eq(mktListings.id, mktComboCourses.listingId))
      .where(eq(mktComboCourses.courseId, course.id));
    const listedLessons = new Set(lectures.map((l) => l.listing.sourceLessonId));
    return {
      course: { id: course.id, title: course.title, description: course.description ?? "" },
      videos: lessons.length,
      whole: whole ? { ...whole.listing, buyers: whole.buyers } : null,
      lectures: lectures.map((l) => ({ ...l.listing, buyers: l.buyers })),
      unlistedLectures: lessons.filter((l) => !listedLessons.has(l.id)).map((l) => ({ id: l.id, title: l.title })),
      combos,
    };
  });
}

/* ───────────────────────────── Discount codes ───────────────────────────── */

export type CodeInput = {
  code: string;
  kind: CodeKind;
  /** A percentage, or paise off when kind is "amount". */
  value: number;
  listingId?: string | null;
  startsOn?: string | null;
  endsOn?: string | null;
  maxUses?: number | null;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Codes are typed by buyers, so they are kept in capitals without spaces. */
export const normaliseCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");

function cleanCode(input: CodeInput) {
  const code = normaliseCode(input.code);
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw new ValidationError("Use 3 to 24 letters, numbers, - or _ for the code.");
  if (!Number.isInteger(input.value) || input.value <= 0) throw new ValidationError("Set how much the code takes off.");
  if (input.kind === "percent" && input.value > 90) throw new ValidationError("A percentage code can take off at most 90%.");
  const startsOn = input.startsOn || null;
  const endsOn = input.endsOn || null;
  if ((startsOn && !DATE.test(startsOn)) || (endsOn && !DATE.test(endsOn))) throw new ValidationError("Pick the dates from the calendar.");
  if (startsOn && endsOn && endsOn < startsOn) throw new ValidationError("The last day can't be before the first day.");
  const maxUses = input.maxUses ?? null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) throw new ValidationError("Set the limit to 1 use or more, or leave it empty for no limit.");
  return { code, kind: input.kind, value: input.value, listingId: input.listingId || null, startsOn, endsOn, maxUses };
}

/**
 * A code for everything the institute sells needs course.update across the institute; a code
 * for one listing needs it on that listing's course, so a HOD can run deals on their own courses.
 */
async function assertCanCode(tx: Tx, actor: Actor, listingId: string | null) {
  if (listingId) return loadListing(tx, actor, listingId);
  if (!reach(actor, "course.update", uni(actor)).all) throw new ForbiddenError("Only an institute admin can make a code for everything you sell. Pick one listing instead.");
  return null;
}

export async function createCode(actor: Actor, input: CodeInput) {
  const fields = cleanCode(input);
  return withTenant(actor, async (tx) => {
    await assertCanCode(tx, actor, fields.listingId);
    const [code] = await tx
      .insert(mktCodes)
      .values({ universityId: uni(actor), createdBy: actor.userId, ...fields })
      .returning();
    await audit(tx, actor, "marketplace.code_create", "mkt_code", code.id, fields);
    return code;
  }).catch((err) => {
    if (isUniqueViolation(err)) throw new ConflictError("You already have a code with that name.", "code_taken");
    throw err;
  });
}

export async function setCodeStatus(actor: Actor, codeId: string, status: CodeStatus) {
  return withTenant(actor, async (tx) => {
    const [code] = await tx.select().from(mktCodes).where(eq(mktCodes.id, codeId));
    if (!code) throw new NotFoundError("Code");
    await assertCanCode(tx, actor, code.listingId);
    await tx.update(mktCodes).set({ status }).where(eq(mktCodes.id, codeId));
    await audit(tx, actor, status === "active" ? "marketplace.code_resume" : "marketplace.code_pause", "mkt_code", codeId);
  });
}

/** Codes this person can see: every code for an institute admin, codes on their own listings for a HOD. */
export async function listCodes(actor: Actor) {
  const listings = await listListings(actor);
  const mine = new Map(listings.map((l) => [l.id, l.title]));
  const all = reach(actor, "course.update", uni(actor)).all;
  if (!all && mine.size === 0) return [];
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        code: mktCodes,
        uses: sql<number>`(select count(*)::int from mkt_redemptions r join orders o on o.id = r.order_id where r.code_id = mkt_codes.id and o.status in ('pending', 'paid'))`,
      })
      .from(mktCodes)
      .orderBy(desc(mktCodes.createdAt));
    return rows
      .filter(({ code }) => (code.listingId ? mine.has(code.listingId) : all))
      .map(({ code, uses }) => ({ ...code, uses, listingTitle: code.listingId ? mine.get(code.listingId)! : null }));
  });
}
