/**
 * The institute's side of the marketplace: what it sells, at what price, and how many
 * bought it. Listing needs course.update on the course, so a HOD manages their own
 * department's and an Institute Admin manages all of them.
 *
 * A whole course is sold as it is. A single lecture becomes a one-lesson course of its own,
 * so buying it opens that lecture and nothing else.
 */
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batchSlots, batches, courses, orders } from "@/db/schema";
import { describeSlots } from "@/server/services/schedule";
import { copyCourseInto, copyLectureInto, lessonCourseId, readyVideoLessons, recordedOutline } from "@/modules/content-progress/recorded";
import { assertCan, audit, courseTarget, createLectureCourse, ensureRecordedBatch, reach, todayFor, withTenant, type Actor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, isUniqueViolation } from "@/server/errors";
import { mktCodes, mktComboCourses, mktListings, mktSeatSales, type CodeKind, type CodeStatus, type ListingKind, type ListingStatus } from "./schema";

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

/**
 * How many people hold what a listing sells. Recorded: everyone in its hidden batch. A live
 * batch also holds the institute's own students, so only the seats sold through the marketplace
 * count. Spelled out in full: with no join, drizzle leaves a column bare and it would match the
 * inner tables' columns of the same name.
 */
const BUYERS = sql<number>`(case when mkt_listings.kind = 'batch'
  then (select count(*)::int from mkt_seat_sales s join orders o on o.id = s.order_id join enrolments e on e.id = o.enrolment_id
        where s.listing_id = mkt_listings.id and o.status = 'paid' and e.status in ('active', 'completed'))
  else (select count(*)::int from enrolments e where e.batch_id = mkt_listings.batch_id and e.status in ('active', 'completed')) end)`;

/**
 * Where a live batch's listing stands. "on_sale" and "full" are on the marketplace (a full batch
 * shows, but can't be bought). The rest are off it without anyone pausing the listing: the batch
 * ended, was closed or archived, started without late joining, or now needs faculty approval.
 */
export type BatchListingState = "on_sale" | "full" | "paused" | "ended" | "closed" | "started" | "needs_approval";

export type BatchListingInfo = {
  batchName: string;
  startDate: string;
  endDate: string;
  timings: string;
  seatLimit: number;
  /** Every seat in use, the institute's own students included. */
  seatsTaken: number;
  state: BatchListingState;
};

const seatsTakenSql = sql<number>`(select count(*)::int from enrolments e where e.batch_id = batches.id and (e.status in ('active', 'approved') or (e.status = 'held' and e.hold_expires_at > now())))`;

/** For live batch listings: the batch behind each and whether buyers can get it right now. */
async function batchListingInfo(tx: Tx, listings: { id: string; batchId: string; kind: ListingKind; status: ListingStatus; lateJoin: boolean }[]) {
  const out = new Map<string, BatchListingInfo>();
  const live = listings.filter((l) => l.kind === "batch");
  if (live.length === 0) return out;
  const ids = live.map((l) => l.batchId);
  const [rows, slots, today] = await Promise.all([
    tx.select({ batch: batches, taken: seatsTakenSql }).from(batches).where(inArray(batches.id, ids)),
    tx.select().from(batchSlots).where(inArray(batchSlots.batchId, ids)),
    todayFor(tx),
  ]);
  for (const l of live) {
    const row = rows.find((r) => r.batch.id === l.batchId);
    if (!row) continue;
    const b = row.batch;
    const state: BatchListingState =
      l.status !== "live"
        ? "paused"
        : b.endDate < today
          ? "ended"
          : b.status !== "open"
            ? "closed"
            : b.approvalRequired
              ? "needs_approval"
              : !l.lateJoin && b.startDate <= today
                ? "started"
                : row.taken >= b.seatLimit
                  ? "full"
                  : "on_sale";
    out.set(l.id, {
      batchName: b.name,
      startDate: b.startDate,
      endDate: b.endDate,
      timings: describeSlots(slots.filter((s) => s.batchId === b.id)),
      seatLimit: b.seatLimit,
      seatsTaken: row.taken,
      state,
    });
  }
  return out;
}

export async function listListings(actor: Actor) {
  const r = reach(actor, "course.update", uni(actor));
  if (!r.all && r.departmentIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({ listing: mktListings, departmentId: courses.departmentId, buyers: BUYERS })
      .from(mktListings)
      .innerJoin(courses, eq(courses.id, mktListings.courseId))
      .where(ne(mktListings.status, "removed"))
      .orderBy(desc(mktListings.createdAt));
    const mine = rows.filter((x) => r.all || r.departmentIds.has(x.departmentId));
    const includes = await comboTitles(
      tx,
      mine.filter((x) => x.listing.kind === "combo").map((x) => x.listing.id),
    );
    const batchInfo = await batchListingInfo(tx, mine.map((x) => x.listing));
    return mine.map(({ listing, buyers }) => ({ ...listing, buyers, includes: includes.get(listing.id) ?? [], batch: batchInfo.get(listing.id) ?? null }));
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
    // Removed listings still count for what they sold and earned; they just aren't on sale or paused.
    const mine = (
      await tx
        .select({ id: mktListings.id, kind: mktListings.kind, status: mktListings.status, batchId: mktListings.batchId, departmentId: courses.departmentId, buyers: BUYERS })
        .from(mktListings)
        .innerJoin(courses, eq(courses.id, mktListings.courseId))
    ).filter((l) => r.all || r.departmentIds.has(l.departmentId));
    if (mine.length === 0) return empty;
    // A live batch's own students aren't marketplace buyers, so its orders count only through their sales.
    const recordedBatchIds = mine.filter((l) => l.kind !== "batch").map((l) => l.batchId);
    const liveListingIds = mine.filter((l) => l.kind === "batch").map((l) => l.id);
    const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00+05:30`);
    const sold = or(
      recordedBatchIds.length ? inArray(orders.batchId, recordedBatchIds) : undefined,
      liveListingIds.length ? inArray(orders.id, tx.select({ id: mktSeatSales.orderId }).from(mktSeatSales).where(inArray(mktSeatSales.listingId, liveListingIds))) : undefined,
    );
    const [money] = await tx
      .select({
        total: sql<number>`coalesce(sum(${orders.basePaise}), 0)::int`,
        month: sql<number>`coalesce(sum(${orders.basePaise}) filter (where ${gte(orders.paidAt, monthStart)}), 0)::int`,
      })
      .from(orders)
      .where(and(sold, eq(orders.status, "paid"), isNotNull(orders.gatewayPaymentId)));
    const buyers = mine.reduce((n, l) => n + l.buyers, 0);
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
    const listed = await tx.select({ courseId: mktListings.courseId, kind: mktListings.kind, sourceLessonId: mktListings.sourceLessonId }).from(mktListings);
    // A course's live batches can be on sale next to its recordings, so only a recorded listing takes the course.
    const listedCourses = new Set(listed.filter((l) => l.kind !== "batch").map((l) => l.courseId));
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

export async function createListing(actor: Actor, input: ListingFields & { kind: "course" | "lecture"; sourceId: string }) {
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
  if (!listing || listing.status === "removed") throw new NotFoundError("Listing");
  assertCan(actor, "course.update", await courseTarget(tx, uni(actor), listing.courseId));
  return listing;
}

/** One listing, for its edit page. `batch` is set for a live batch. */
export async function getListing(actor: Actor, listingId: string) {
  return withTenant(actor, async (tx) => {
    const listing = await loadListing(tx, actor, listingId);
    const [{ buyers }] = await tx.select({ buyers: BUYERS }).from(mktListings).where(eq(mktListings.id, listing.id));
    return { ...listing, buyers, batch: (await batchListingInfo(tx, [listing])).get(listing.id) ?? null };
  });
}

/** `lateJoin` only means something for a live batch; it is left alone when not given. */
export async function updateListing(actor: Actor, listingId: string, input: ListingFields & { lateJoin?: boolean }) {
  const fields = cleanFields(input);
  return withTenant(actor, async (tx) => {
    const listing = await loadListing(tx, actor, listingId);
    const lateJoin = listing.kind === "batch" && input.lateJoin !== undefined ? { lateJoin: input.lateJoin } : {};
    await tx.update(mktListings).set({ ...fields, ...lateJoin, updatedAt: new Date() }).where(eq(mktListings.id, listingId));
    await audit(tx, actor, "marketplace.update", "mkt_listing", listingId, { ...fields, ...lateJoin });
  });
}

/** Paused listings leave the marketplace; people who already bought keep their access. */
export async function setListingStatus(actor: Actor, listingId: string, status: Exclude<ListingStatus, "removed">) {
  return withTenant(actor, async (tx) => {
    await loadListing(tx, actor, listingId);
    await tx.update(mktListings).set({ status, updatedAt: new Date() }).where(eq(mktListings.id, listingId));
    await audit(tx, actor, status === "live" ? "marketplace.resume" : "marketplace.pause", "mkt_listing", listingId);
  });
}

/* ───────────────────────────── Live batches ───────────────────────────── */

type BatchRow = typeof batches.$inferSelect;

/**
 * Why a batch can't be sold on the marketplace, in words for the admin; null when it can.
 * A listable batch is a real one (not the hidden recorded batch), open, not over, with class
 * timings, and without faculty approval: a buyer pays and is enrolled at once, so there is
 * nobody to accept them first.
 */
export function batchListingProblem(batch: Pick<BatchRow, "recorded" | "status" | "endDate" | "approvalRequired">, slotCount: number, today: string): string | null {
  if (batch.recorded) return "This is the hidden batch behind a recorded course. List the recordings instead.";
  if (batch.status !== "open") return `This batch is ${batch.status}. Only an open batch can be listed.`;
  if (batch.endDate < today) return "This batch has ended.";
  if (slotCount === 0) return "This batch has no class timings yet. Add its days and times first.";
  if (batch.approvalRequired)
    return "Faculty accept each student in this batch, but marketplace buyers pay and join straight away. Switch off \"Faculty accept each student\" on the batch to list it.";
  return null;
}

export type ListableBatch = {
  id: string;
  name: string;
  courseId: string;
  courseTitle: string;
  startDate: string;
  endDate: string;
  timings: string;
  seatLimit: number;
  seatsTaken: number;
  /** Why it can't be listed; null when it can. */
  problem: string | null;
};

/**
 * The real batches this person could put on the marketplace (of one course, or of all their
 * courses), each with the reason when it can't be listed. Batches already listed, ended
 * batches and archived ones are left out.
 */
export async function listableBatches(actor: Actor, courseId?: string): Promise<ListableBatch[]> {
  const r = reach(actor, "course.update", uni(actor));
  if (!r.all && r.departmentIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    const today = await todayFor(tx);
    const rows = (
      await tx
        .select({ batch: batches, courseTitle: courses.title, taken: seatsTakenSql })
        .from(batches)
        .innerJoin(courses, eq(courses.id, batches.courseId))
        .where(
          and(
            eq(batches.recorded, false),
            ne(batches.status, "archived"),
            gte(batches.endDate, today),
            inArray(courses.status, ["draft", "published"]),
            courseId ? eq(batches.courseId, courseId) : undefined,
          ),
        )
        .orderBy(asc(courses.title), asc(batches.startDate), asc(batches.name))
    ).filter((x) => r.all || r.departmentIds.has(x.batch.departmentId));
    if (rows.length === 0) return [];
    const ids = rows.map((x) => x.batch.id);
    const [slots, listed] = await Promise.all([
      tx.select().from(batchSlots).where(inArray(batchSlots.batchId, ids)),
      tx.select({ batchId: mktListings.batchId }).from(mktListings).where(and(inArray(mktListings.batchId, ids), ne(mktListings.status, "removed"))),
    ]);
    const taken = new Set(listed.map((l) => l.batchId));
    return rows
      .filter((x) => !taken.has(x.batch.id))
      .map(({ batch: b, courseTitle, taken: seatsTaken }) => {
        const mine = slots.filter((s) => s.batchId === b.id);
        return {
          id: b.id,
          name: b.name,
          courseId: b.courseId,
          courseTitle,
          startDate: b.startDate,
          endDate: b.endDate,
          timings: describeSlots(mine),
          seatLimit: b.seatLimit,
          seatsTaken,
          problem: batchListingProblem(b, mine.length, today),
        };
      });
  });
}

/**
 * Puts a seat in a real batch on the marketplace at its own price (the institute's own
 * students keep joining it free, as before). The listing carries the course's title unless
 * another is given. Buyers are enrolled in this very batch, within its seat limit.
 */
export async function createBatchListing(
  actor: Actor,
  input: { batchId: string; title?: string; description: string; pricePaise: number; compareAtPaise?: number | null; lateJoin?: boolean },
) {
  return withTenant(actor, async (tx) => {
    const [batch] = await tx.select().from(batches).where(eq(batches.id, input.batchId));
    if (!batch) throw new NotFoundError("Batch");
    const course = await loadCourseForListing(tx, actor, batch.courseId);
    const fields = cleanFields({ ...input, title: input.title?.trim() || course.title });
    const slots = await tx.select({ id: batchSlots.id }).from(batchSlots).where(eq(batchSlots.batchId, batch.id));
    const problem = batchListingProblem(batch, slots.length, await todayFor(tx));
    if (problem) throw new ValidationError(problem);
    if (course.status === "archived") throw new ValidationError("This course is archived, so its batches can't be listed.");
    const [listing] = await tx
      .insert(mktListings)
      .values({ universityId: uni(actor), courseId: course.id, batchId: batch.id, kind: "batch", lateJoin: input.lateJoin ?? false, createdBy: actor.userId, ...fields })
      .returning();
    await audit(tx, actor, "marketplace.list", "mkt_listing", listing.id, {
      kind: "batch",
      courseId: course.id,
      batchId: batch.id,
      title: fields.title,
      pricePaise: fields.pricePaise,
      lateJoin: listing.lateJoin,
    });
    return listing;
  }).catch(rethrowDuplicate);
}

/**
 * Takes a live batch off the marketplace for good. People who bought a seat keep it, and it
 * stays in their library; the batch can be listed again later as a new listing.
 */
export async function removeBatchListing(actor: Actor, listingId: string) {
  return withTenant(actor, async (tx) => {
    const listing = await loadListing(tx, actor, listingId);
    if (listing.kind !== "batch") throw new ValidationError("Only a live batch can be removed. Pause a recorded listing instead: its buyers keep watching.");
    await tx.update(mktListings).set({ status: "removed", updatedAt: new Date() }).where(eq(mktListings.id, listingId));
    await audit(tx, actor, "marketplace.remove", "mkt_listing", listingId, { batchId: listing.batchId });
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
    const buyers = BUYERS;
    const [whole] = await tx
      .select({ listing: mktListings, buyers })
      .from(mktListings)
      .where(and(eq(mktListings.courseId, course.id), eq(mktListings.kind, "course")));
    const liveRows = await tx
      .select({ listing: mktListings, buyers })
      .from(mktListings)
      .where(and(eq(mktListings.courseId, course.id), eq(mktListings.kind, "batch"), ne(mktListings.status, "removed")))
      .orderBy(asc(mktListings.createdAt));
    const batchInfo = await batchListingInfo(tx, liveRows.map((l) => l.listing));
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
      /** This course's live batches on the marketplace. */
      batches: liveRows.map((l) => ({ ...l.listing, buyers: l.buyers, batch: batchInfo.get(l.listing.id) ?? null })),
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
