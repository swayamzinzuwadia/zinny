import "server-only";
/**
 * The marketplace, for buyers: who may shop, the catalogue, buying, and My library.
 *
 * Buyers don't belong to the institutes they buy from, so reading across institutes is the
 * point of this file. Brief exception to "never use systemDb()": it reads through the system
 * connection, limited to live listings of active institutes and the signed-in person's own
 * purchases. Every write runs under the selling institute's row-level security.
 *
 * Who may shop: anyone who learns, meaning people who signed up for the marketplace and the
 * students and alumni of any institute. Staff accounts only look. Whatever someone bought
 * stays theirs whatever their roles become.
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { courses, enrolments, invoices, orders, roleAssignments, universities } from "@/db/schema";
import { contentCourseProgress } from "@/modules/content-progress/schema";
import { recordedOutline, type RecordedOutline } from "@/modules/content-progress/recorded";
import { spacesFor } from "@/server/auth/session";
import { audit, cancelHold, gstFor, holdRecordedSeat, loadActor, systemActorFor, todayIn, withTenant } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { normaliseCode } from "./listings";
import { mktCodes, mktComboCourses, mktLearners, mktListings, mktRedemptions, type ListingKind } from "./schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────────────────────── Who may shop ───────────────────────────── */

export async function marketplaceAccess(userId: string) {
  const [[learner], spaces] = await Promise.all([
    systemDb().select({ id: mktLearners.userId }).from(mktLearners).where(eq(mktLearners.userId, userId)),
    spacesFor(userId),
  ]);
  const roles = new Set(spaces.flatMap((s) => s.roles));
  return {
    canShop: !!learner || roles.has("student") || roles.has("alumni") || roles.has("individual_learner"),
    /** Signed up for the marketplace, so they have no institute to go back to. */
    independent: !!learner,
  };
}

/* ───────────────────────────── Catalogue ───────────────────────────── */

export type CatalogItem = {
  id: string;
  kind: ListingKind;
  title: string;
  description: string;
  institute: string;
  instituteSlug: string;
  universityId: string;
  courseId: string;
  batchId: string;
  /** The listed price, before GST: what the marketplace shows. GST is added at checkout. */
  pricePaise: number;
  /** The usual price before GST, shown struck through; null when there's no deal. */
  compareAtPaise: number | null;
  /** What checkout will charge, GST included. */
  totalPaise: number;
  /** Whole percent saved against the usual price. */
  percentOff: number | null;
  lessons: number;
  minutes: number;
};

export type CatalogSort = "new" | "price-low" | "price-high" | "deals";

async function liveListings(filter?: SQL): Promise<CatalogItem[]> {
  const rows = await systemDb()
    .select({
      listing: mktListings,
      institute: universities.name,
      instituteSlug: universities.slug,
      gstRateBp: courses.gstRateBp,
      lessons: sql<number>`(select count(*)::int from content_lessons l where l.course_id = ${mktListings.courseId} and l.ready and l.kind <> 'live')`,
      minutes: sql<number>`(select coalesce(sum(l.duration_minutes), 0)::int from content_lessons l where l.course_id = ${mktListings.courseId} and l.ready and l.kind <> 'live')`,
    })
    .from(mktListings)
    .innerJoin(universities, eq(universities.id, mktListings.universityId))
    .innerJoin(courses, eq(courses.id, mktListings.courseId))
    .where(and(eq(mktListings.status, "live"), eq(universities.status, "active"), filter))
    .orderBy(desc(mktListings.createdAt));
  return rows.map(({ listing: l, institute, instituteSlug, gstRateBp, lessons, minutes }) => ({
    id: l.id,
    kind: l.kind,
    title: l.title,
    description: l.description,
    institute,
    instituteSlug,
    universityId: l.universityId,
    courseId: l.courseId,
    batchId: l.batchId,
    pricePaise: l.pricePaise,
    compareAtPaise: l.compareAtPaise,
    totalPaise: l.pricePaise + gstFor(l.pricePaise, gstRateBp),
    percentOff: l.compareAtPaise ? Math.round((1 - l.pricePaise / l.compareAtPaise) * 100) : null,
    lessons,
    minutes,
  }));
}

const SORTS: Record<Exclude<CatalogSort, "new">, (a: CatalogItem, b: CatalogItem) => number> = {
  "price-low": (a, b) => a.pricePaise - b.pricePaise,
  "price-high": (a, b) => b.pricePaise - a.pricePaise,
  deals: (a, b) => (b.percentOff ?? 0) - (a.percentOff ?? 0),
};

/** `institute` is a university slug: only what that institute sells. Newest first unless `sort` says otherwise. */
export async function browseMarketplace(filter: { q?: string; kind?: ListingKind; institute?: string; sort?: CatalogSort; limit?: number } = {}) {
  const q = filter.q?.trim().slice(0, 80);
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const items = await liveListings(
    and(
      filter.kind ? eq(mktListings.kind, filter.kind) : undefined,
      filter.institute ? eq(universities.slug, filter.institute) : undefined,
      like ? or(ilike(mktListings.title, like), ilike(universities.name, like)) : undefined,
    ),
  );
  if (filter.sort && filter.sort !== "new") items.sort(SORTS[filter.sort]);
  return filter.limit ? items.slice(0, filter.limit) : items;
}

/** Institutes with something on sale, most listings first: the catalogue's shelves. */
export async function marketplaceInstitutes() {
  return systemDb()
    .select({ name: universities.name, slug: universities.slug, listings: sql<number>`count(*)::int` })
    .from(mktListings)
    .innerJoin(universities, eq(universities.id, mktListings.universityId))
    .where(and(eq(mktListings.status, "live"), eq(universities.status, "active")))
    .groupBy(universities.name, universities.slug)
    .orderBy(desc(sql`count(*)`), asc(universities.name));
}

/** An active institute, by slug, for the "From this institute" view of the catalogue. */
export async function marketplaceInstitute(slug: string) {
  const [row] = await systemDb()
    .select({ name: universities.name, slug: universities.slug })
    .from(universities)
    .where(and(eq(universities.slug, slug), eq(universities.status, "active")));
  return row ?? null;
}

/** `includes`: for a combo, the titles of the courses in it. */
export type ListingDetail = CatalogItem & { outline: RecordedOutline; ownedEnrolmentId: string | null; includes: string[] };

/** One live listing and what's in it. Anyone may look; `userId` only tells a signed-in buyer they already own it. */
export async function listingDetail(listingId: string, userId: string | null): Promise<ListingDetail | null> {
  if (!UUID.test(listingId)) return null;
  const [item] = await liveListings(eq(mktListings.id, listingId));
  if (!item) return null;
  const [outline, includes, [owned]] = await Promise.all([
    withTenant(systemActorFor(item.universityId), (tx) => recordedOutline(tx, item.courseId)),
    item.kind === "combo"
      ? systemDb()
          .select({ title: courses.title })
          .from(mktComboCourses)
          .innerJoin(courses, eq(courses.id, mktComboCourses.courseId))
          .where(eq(mktComboCourses.listingId, item.id))
          .orderBy(asc(mktComboCourses.position))
          .then((rows) => rows.map((r) => r.title))
      : [],
    userId
      ? systemDb()
          .select({ id: enrolments.id })
          .from(enrolments)
          .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, item.courseId), inArray(enrolments.status, ["active", "completed"])))
      : [],
  ]);
  return { ...item, outline, includes, ownedEnrolmentId: owned?.id ?? null };
}

/* ───────────────────────────── Buying ───────────────────────────── */

/** A buyer needs a role at the seller to pay, watch and download their invoice there. */
async function joinAsBuyer(universityId: string, userId: string) {
  const sys = systemActorFor(universityId);
  await withTenant(sys, async (tx) => {
    const [member] = await tx
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, userId),
          inArray(roleAssignments.role, ["student", "alumni", "individual_learner"]),
          isNull(roleAssignments.revokedAt),
        ),
      );
    if (member) return;
    // starts_at from this clock, because the next line of the purchase checks it against this clock.
    const [role] = await tx
      .insert(roleAssignments)
      .values({ userId, role: "individual_learner", scopeType: "university", universityId, startsAt: new Date(), createdBy: userId })
      .returning({ id: roleAssignments.id });
    await audit(tx, sys, "marketplace.buyer_joined", "role_assignment", role.id, { userId });
  });
}

/**
 * Starts checkout for a listing. Nothing is granted here: the course reaches My library
 * only when the gateway confirms the payment (core confirmPayment).
 */
export async function startPurchase(userId: string, listingId: string, code?: string): Promise<{ slug: string; orderId: string }> {
  const access = await marketplaceAccess(userId);
  if (!access.canShop) throw new ForbiddenError("Buying is open to learners: students, alumni and people with a marketplace account.");
  const item = await liveListing(listingId);
  const deal = code?.trim() ? await applyCode(item, code) : null;
  const pricePaise = item.pricePaise - (deal?.discountPaise ?? 0);

  await joinAsBuyer(item.universityId, userId);
  const actor = await loadActor(userId, item.universityId);
  // A checkout started earlier at another price (say, before a code) gives way to this one.
  const [earlier] = await systemDb()
    .select({ enrolmentId: enrolments.id, basePaise: orders.basePaise })
    .from(enrolments)
    .innerJoin(orders, eq(orders.enrolmentId, enrolments.id))
    .where(and(eq(enrolments.userId, userId), eq(enrolments.batchId, item.batchId), eq(enrolments.status, "held"), eq(orders.status, "pending")));
  if (earlier && earlier.basePaise !== pricePaise) await cancelHold(actor, earlier.enrolmentId);

  const held = await holdRecordedSeat(actor, { batchId: item.batchId, pricePaise });
  if (deal) {
    await withTenant(systemActorFor(item.universityId), async (tx) => {
      const [saved] = await tx
        .insert(mktRedemptions)
        .values({ universityId: item.universityId, codeId: deal.codeId, orderId: held.orderId, discountPaise: deal.discountPaise })
        .onConflictDoNothing()
        .returning({ id: mktRedemptions.id });
      if (saved) await audit(tx, actor, "marketplace.code_use", "mkt_code", deal.codeId, { orderId: held.orderId, discountPaise: deal.discountPaise });
    });
  }
  return { slug: item.instituteSlug, orderId: held.orderId };
}

async function liveListing(listingId: string) {
  if (!UUID.test(listingId)) throw new NotFoundError("Listing");
  const [item] = await liveListings(eq(mktListings.id, listingId));
  if (!item) throw new NotFoundError("Listing");
  return item;
}

/** What a code takes off this listing's price before GST, or why it doesn't apply. The price never drops below ₹1. */
async function applyCode(item: CatalogItem, typed: string) {
  const db = systemDb();
  const [code] = await db
    .select()
    .from(mktCodes)
    .where(and(eq(mktCodes.universityId, item.universityId), eq(mktCodes.code, normaliseCode(typed))));
  if (!code || code.status !== "active") throw new ValidationError(`"${typed.trim()}" isn't a code ${item.institute} has running. Check the spelling.`);
  if (code.listingId && code.listingId !== item.id) throw new ValidationError("That code works on a different course from this institute.");
  const [uni] = await db.select({ tz: universities.timezone }).from(universities).where(eq(universities.id, item.universityId));
  const today = todayIn(uni?.tz ?? "Asia/Kolkata");
  if (code.startsOn && today < code.startsOn) throw new ValidationError("That code hasn't started yet.");
  if (code.endsOn && today > code.endsOn) throw new ValidationError("That code has ended.");
  if (code.maxUses !== null) {
    const [{ used }] = await db
      .select({ used: sql<number>`count(*)::int` })
      .from(mktRedemptions)
      .innerJoin(orders, eq(orders.id, mktRedemptions.orderId))
      .where(and(eq(mktRedemptions.codeId, code.id), inArray(orders.status, ["pending", "paid"])));
    if (used >= code.maxUses) throw new ValidationError("That code has been used up.");
  }
  const off = code.kind === "percent" ? Math.floor((item.pricePaise * code.value) / 100) : code.value;
  return { codeId: code.id, discountPaise: Math.min(off, item.pricePaise - 100) };
}

/** The price with a code, before buying: what "Apply" shows. Before GST, like every price on the marketplace. */
export async function quoteCode(listingId: string, code: string) {
  const item = await liveListing(listingId);
  const { discountPaise } = await applyCode(item, code);
  return { pricePaise: item.pricePaise - discountPaise, savedPaise: discountPaise };
}

/* ───────────────────────────── My library ───────────────────────────── */

export type LibraryItem = {
  orderId: string;
  listingId: string;
  lessons: number;
  kind: ListingKind;
  title: string;
  institute: string;
  instituteSlug: string;
  enrolmentId: string;
  completed: boolean;
  percent: number;
  boughtAt: Date;
  invoiceId: string | null;
};

/**
 * What this person owns: orders the gateway has confirmed (paid, with a payment id) whose
 * seat is live. A pending, failed or fully refunded order never shows here.
 */
export async function myLibrary(userId: string): Promise<LibraryItem[]> {
  const rows = await systemDb()
    .select({
      orderId: orders.id,
      listingId: mktListings.id,
      lessons: sql<number>`(select count(*)::int from content_lessons l where l.course_id = ${mktListings.courseId} and l.ready and l.kind <> 'live')`,
      kind: mktListings.kind,
      title: mktListings.title,
      institute: universities.name,
      instituteSlug: universities.slug,
      enrolmentId: enrolments.id,
      status: enrolments.status,
      percent: contentCourseProgress.percent,
      paidAt: orders.paidAt,
      invoiceId: invoices.id,
    })
    .from(orders)
    // By batch, not course: fees for one of the course's live batches aren't a marketplace purchase.
    .innerJoin(mktListings, eq(mktListings.batchId, orders.batchId))
    .innerJoin(enrolments, eq(enrolments.id, orders.enrolmentId))
    .innerJoin(universities, eq(universities.id, orders.universityId))
    .leftJoin(contentCourseProgress, eq(contentCourseProgress.enrolmentId, enrolments.id))
    .leftJoin(invoices, eq(invoices.orderId, orders.id))
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, "paid"),
        isNotNull(orders.gatewayPaymentId),
        isNotNull(orders.paidAt),
        inArray(enrolments.status, ["active", "completed"]),
      ),
    )
    .orderBy(desc(orders.paidAt));
  return rows.map(({ status, percent, paidAt, ...r }) => ({ ...r, completed: status === "completed", percent: percent ?? 0, boughtAt: paidAt! }));
}
