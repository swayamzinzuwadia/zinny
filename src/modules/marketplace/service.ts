import "server-only";
/**
 * The marketplace, for buyers: who may shop, the catalogue, buying, and My library.
 *
 * Buyers don't belong to the institutes they buy from, so reading across institutes is the
 * point of this file. Brief exception to "never use systemDb()": it reads through the system
 * connection, limited to live listings of active institutes and the signed-in person's own
 * purchases. Every write runs under the selling institute's row-level security.
 *
 * Who may shop: people who signed up for the marketplace, and alumni. Current students of
 * an institute may not. Whatever someone already bought stays theirs either way.
 */
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { courses, enrolments, invoices, orders, roleAssignments, universities } from "@/db/schema";
import { contentCourseProgress } from "@/modules/content-progress/schema";
import { recordedOutline, type RecordedOutline } from "@/modules/content-progress/recorded";
import { spacesFor } from "@/server/auth/session";
import { audit, gstFor, holdRecordedSeat, loadActor, systemActorFor, withTenant } from "@/server/core";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { mktLearners, mktListings, type ListingKind } from "./schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ───────────────────────────── Who may shop ───────────────────────────── */

export async function marketplaceAccess(userId: string) {
  const [[learner], spaces] = await Promise.all([
    systemDb().select({ id: mktLearners.userId }).from(mktLearners).where(eq(mktLearners.userId, userId)),
    spacesFor(userId),
  ]);
  const roles = new Set(spaces.flatMap((s) => s.roles));
  return {
    canShop: !roles.has("student") && (!!learner || roles.has("alumni")),
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
  pricePaise: number;
  /** What the buyer pays, GST included. */
  totalPaise: number;
  lessons: number;
  minutes: number;
};

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
    totalPaise: l.pricePaise + gstFor(l.pricePaise, gstRateBp),
    lessons,
    minutes,
  }));
}

/** `institute` is a university slug: only what that institute sells. */
export async function browseMarketplace(filter: { q?: string; kind?: ListingKind; institute?: string; limit?: number } = {}) {
  const q = filter.q?.trim().slice(0, 80);
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const items = await liveListings(
    and(
      filter.kind ? eq(mktListings.kind, filter.kind) : undefined,
      filter.institute ? eq(universities.slug, filter.institute) : undefined,
      like ? or(ilike(mktListings.title, like), ilike(universities.name, like)) : undefined,
    ),
  );
  return filter.limit ? items.slice(0, filter.limit) : items;
}

/** An active institute, by slug, for the "From this institute" view of the catalogue. */
export async function marketplaceInstitute(slug: string) {
  const [row] = await systemDb()
    .select({ name: universities.name, slug: universities.slug })
    .from(universities)
    .where(and(eq(universities.slug, slug), eq(universities.status, "active")));
  return row ?? null;
}

export type ListingDetail = CatalogItem & { outline: RecordedOutline; ownedEnrolmentId: string | null };

/** One live listing, what's in it, and whether this person already owns it. */
/** Anyone may look at a listing; `userId` is only used to tell a signed-in buyer they already own it. */
export async function listingDetail(listingId: string, userId: string | null): Promise<ListingDetail | null> {
  if (!UUID.test(listingId)) return null;
  const [item] = await liveListings(eq(mktListings.id, listingId));
  if (!item) return null;
  const [outline, [owned]] = await Promise.all([
    withTenant(systemActorFor(item.universityId), (tx) => recordedOutline(tx, item.courseId)),
    userId
      ? systemDb()
          .select({ id: enrolments.id })
          .from(enrolments)
          .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, item.courseId), inArray(enrolments.status, ["active", "completed"])))
      : [],
  ]);
  return { ...item, outline, ownedEnrolmentId: owned?.id ?? null };
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
export async function startPurchase(userId: string, listingId: string): Promise<{ slug: string; orderId: string }> {
  const access = await marketplaceAccess(userId);
  if (!access.canShop) throw new ForbiddenError("The marketplace is open to independent learners and alumni.");
  if (!UUID.test(listingId)) throw new NotFoundError("Listing");
  const [item] = await liveListings(eq(mktListings.id, listingId));
  if (!item) throw new NotFoundError("Listing");
  await joinAsBuyer(item.universityId, userId);
  const actor = await loadActor(userId, item.universityId);
  const held = await holdRecordedSeat(actor, { batchId: item.batchId, pricePaise: item.pricePaise });
  return { slug: item.instituteSlug, orderId: held.orderId };
}

/* ───────────────────────────── My library ───────────────────────────── */

export type LibraryItem = {
  orderId: string;
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
