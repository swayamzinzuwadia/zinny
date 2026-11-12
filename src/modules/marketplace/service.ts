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
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { batchSlots, batches, courses, enrolments, invoices, orders, roleAssignments, sessionOverrides, universities, users } from "@/db/schema";
import { contentCourseProgress } from "@/modules/content-progress/schema";
import { recordedOutline, type RecordedOutline } from "@/modules/content-progress/recorded";
import { spacesFor } from "@/server/auth/session";
import { audit, cancelHold, gstFor, holdRecordedSeat, loadActor, systemActorFor, todayIn, withTenant } from "@/server/core";
import { expandSessions, holdMarketplaceSeat, type Slot } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { daysBetween, minutesNowIn, toMinutes } from "@/server/lib/dates";
import { joinWindowOpen } from "@/server/lib/links";
import { describeSlots } from "@/server/services/schedule";
import { normaliseCode } from "./listings";
import { mktCodes, mktComboCourses, mktLearners, mktListings, mktRedemptions, mktSeatSales, type ListingKind, type RecordedKind } from "./schema";

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
  /** Set for a live batch (kind "batch"): its dates, timings and seats. Null for everything recorded. */
  live: LiveInfo | null;
};

/** Newest first by default; "soonest" puts the batches that start next first (recorded items keep their order after them). */
export type CatalogSort = "new" | "price-low" | "price-high" | "deals" | "soonest";

/** The two halves of the marketplace: recordings to watch any time, and seats in live batches. */
export type CatalogFormat = "recorded" | "live";

/** "upcoming": hasn't started yet. "running": classes have begun and the listing still takes buyers. */
export type LivePhase = "upcoming" | "running";

export type LiveInfo = BatchFacts & {
  /** Whether people may still buy after the start date. */
  lateJoin: boolean;
  phase: LivePhase;
  /** Days until the first day; 0 or less once it has started. */
  startsInDays: number;
};

/** What a live batch is, read for buyers: dates and times are in the institute's time zone. */
export type BatchFacts = {
  batchId: string;
  batchName: string;
  startDate: string;
  endDate: string;
  /** Today in the institute's time zone. */
  today: string;
  timezone: string;
  slots: Slot[];
  /** "Mon to Fri, 9 am to 11 am". */
  timings: string;
  /** Classes from the first day to the last, holidays and extra classes counted. */
  classes: number;
  classesLeft: number;
  nextClass: { date: string; startTime: string; endTime: string } | null;
  faculty: string[];
  seatLimit: number;
  /** Free seats right now: paid seats and seats held while someone pays are taken. */
  seatsLeft: number;
};

/** Few enough seats that the shelf says how many: a fifth of the batch, at least 3 and at most 10. */
export function fewSeatsLeft(live: Pick<BatchFacts, "seatsLeft" | "seatLimit">) {
  return live.seatsLeft > 0 && live.seatsLeft <= Math.min(10, Math.max(3, Math.ceil(live.seatLimit / 5)));
}

/** Starting within a week. */
export function startsSoon(live: Pick<LiveInfo, "phase" | "startsInDays">) {
  return live.phase === "upcoming" && live.startsInDays <= 7;
}

/**
 * A live batch is offered only while a buyer could still take a seat in it: it is open, not
 * past its last day, doesn't need faculty to accept each student, and either hasn't started
 * or allows late joining. Dates are compared in the institute's own time zone. Nothing is
 * written when a batch ends or closes: its listing simply stops matching.
 */
const todayAt = sql`(now() at time zone universities.timezone)::date`;
const OFFERED = sql`(mkt_listings.kind <> 'batch' or exists (
  select 1 from batches b join courses bc on bc.id = b.course_id
  where b.id = mkt_listings.batch_id and b.status = 'open' and not b.recorded and not b.approval_required
    and bc.status <> 'archived' and b.end_date >= ${todayAt} and (mkt_listings.late_join or b.start_date > ${todayAt})))`;

/** Dates, timings, classes, faculty and free seats of these batches, by batch id. Reads only. */
async function batchFacts(batchIds: string[]): Promise<Map<string, BatchFacts>> {
  const ids = [...new Set(batchIds)];
  const out = new Map<string, BatchFacts>();
  if (ids.length === 0) return out;
  const db = systemDb();
  const [rows, slots, overrides, faculty] = await Promise.all([
    db
      .select({
        batch: batches,
        courseTitle: courses.title,
        timezone: universities.timezone,
        taken: sql<number>`(select count(*)::int from enrolments e where e.batch_id = batches.id and (e.status in ('active', 'approved') or (e.status = 'held' and e.hold_expires_at > now())))`,
      })
      .from(batches)
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .innerJoin(universities, eq(universities.id, batches.universityId))
      .where(inArray(batches.id, ids)),
    db.select().from(batchSlots).where(inArray(batchSlots.batchId, ids)),
    db.select().from(sessionOverrides).where(inArray(sessionOverrides.batchId, ids)),
    db
      .select({ batchId: roleAssignments.batchId, name: users.name, endsAt: roleAssignments.endsAt })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(and(inArray(roleAssignments.batchId, ids), inArray(roleAssignments.role, ["permanent_faculty", "visiting_faculty"]), isNull(roleAssignments.revokedAt)))
      .orderBy(asc(users.name)),
  ]);
  const now = new Date();
  for (const { batch: b, courseTitle, timezone, taken } of rows) {
    const today = todayIn(timezone);
    const mine = slots.filter((s) => s.batchId === b.id).map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime }));
    const sessions = expandSessions(
      [
        {
          batchId: b.id,
          batchName: b.name,
          courseId: b.courseId,
          courseTitle,
          startDate: b.startDate,
          endDate: b.endDate,
          slots: mine,
          overrides: overrides
            .filter((o) => o.batchId === b.id)
            .map((o) => ({ date: o.date, kind: o.kind, newDate: o.newDate, startTime: o.startTime, endTime: o.endTime, note: o.note })),
        },
      ],
      b.startDate,
      b.endDate,
    );
    const nowMinutes = minutesNowIn(timezone, now);
    const ahead = sessions.filter((s) => s.date > today || (s.date === today && toMinutes(s.endTime) > nowMinutes));
    const next = ahead[0];
    out.set(b.id, {
      batchId: b.id,
      batchName: b.name,
      startDate: b.startDate,
      endDate: b.endDate,
      today,
      timezone,
      slots: mine,
      timings: describeSlots(mine),
      classes: sessions.length,
      classesLeft: ahead.length,
      nextClass: next ? { date: next.date, startTime: next.startTime, endTime: next.endTime } : null,
      faculty: [...new Set(faculty.filter((f) => f.batchId === b.id && (!f.endsAt || f.endsAt > now)).map((f) => f.name))],
      seatLimit: b.seatLimit,
      seatsLeft: Math.max(0, b.seatLimit - taken),
    });
  }
  return out;
}

async function liveListings(filter?: SQL): Promise<CatalogItem[]> {
  const rows = await systemDb()
    .select({
      listing: mktListings,
      institute: universities.name,
      instituteSlug: universities.slug,
      gstRateBp: sql<number>`case when ${universities.gstEnabled} then ${courses.gstRateBp} else 0 end`,
      lessons: sql<number>`(select count(*)::int from content_lessons l where l.course_id = ${mktListings.courseId} and l.ready and l.kind <> 'live')`,
      minutes: sql<number>`(select coalesce(sum(l.duration_minutes), 0)::int from content_lessons l where l.course_id = ${mktListings.courseId} and l.ready and l.kind <> 'live')`,
    })
    .from(mktListings)
    .innerJoin(universities, eq(universities.id, mktListings.universityId))
    .innerJoin(courses, eq(courses.id, mktListings.courseId))
    .where(and(eq(mktListings.status, "live"), eq(universities.status, "active"), OFFERED, filter))
    .orderBy(desc(mktListings.createdAt));
  const facts = await batchFacts(rows.filter((r) => r.listing.kind === "batch").map((r) => r.listing.batchId));
  const lateJoin = new Map(rows.map((r) => [r.listing.id, r.listing.lateJoin]));
  return recordedShape(rows).map((item) => {
    const f = item.kind === "batch" ? facts.get(item.batchId) : undefined;
    if (!f) return item;
    const startsInDays = daysBetween(f.today, f.startDate);
    return { ...item, live: { ...f, lateJoin: lateJoin.get(item.id) ?? false, phase: startsInDays > 0 ? ("upcoming" as const) : ("running" as const), startsInDays } };
  });
}

/** Each row as the shelf shows it, before a live batch's dates and seats are added. */
function recordedShape(
  rows: { listing: typeof mktListings.$inferSelect; institute: string; instituteSlug: string; gstRateBp: number; lessons: number; minutes: number }[],
): CatalogItem[] {
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
    live: null,
  }));
}

/** Batches yet to start come first, the nearest first; then the ones already running, the latest start first. */
const soonest = (a: CatalogItem, b: CatalogItem) => {
  if (!a.live || !b.live) return Number(!a.live) - Number(!b.live);
  if (a.live.phase !== b.live.phase) return a.live.phase === "upcoming" ? -1 : 1;
  return a.live.phase === "upcoming" ? a.live.startDate.localeCompare(b.live.startDate) : b.live.startDate.localeCompare(a.live.startDate);
};

const SORTS: Record<Exclude<CatalogSort, "new">, (a: CatalogItem, b: CatalogItem) => number> = {
  "price-low": (a, b) => a.pricePaise - b.pricePaise,
  "price-high": (a, b) => b.pricePaise - a.pricePaise,
  deals: (a, b) => (b.percentOff ?? 0) - (a.percentOff ?? 0),
  soonest,
};

/** A recording on the shelf: a course, a lecture or a combo. */
export type RecordedCatalogItem = CatalogItem & { kind: RecordedKind; live: null };
/** A seat in a live batch. */
export type LiveCatalogItem = CatalogItem & { kind: "batch"; live: LiveInfo };

export type CatalogFilter = {
  q?: string;
  /**
   * "recorded" (the default, as before live batches were sold): courses, lectures and combos.
   * "live": seats in live batches. "all": both.
   */
  format?: CatalogFormat | "all";
  kind?: ListingKind;
  /** A university slug: only what that institute sells. */
  institute?: string;
  /** Only listings with a deal running. */
  onOffer?: boolean;
  /** Live batches only: the ones yet to start, or the ones already running. */
  phase?: LivePhase;
  sort?: CatalogSort;
  limit?: number;
};

/**
 * What is on sale now. Newest first unless `sort` says otherwise. A search matches the listing's
 * title, the institute's name and, for a live batch, the batch's name.
 */
export async function browseMarketplace(filter?: CatalogFilter & { format?: "recorded" }): Promise<RecordedCatalogItem[]>;
export async function browseMarketplace(filter: CatalogFilter & { format: "live" | "all" }): Promise<CatalogItem[]>;
export async function browseMarketplace(filter: CatalogFilter = {}): Promise<CatalogItem[]> {
  const q = filter.q?.trim().slice(0, 80);
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const format = filter.format ?? "recorded";
  const listed = await liveListings(
    and(
      filter.kind ? eq(mktListings.kind, filter.kind) : undefined,
      format === "live" ? eq(mktListings.kind, "batch") : format === "recorded" ? ne(mktListings.kind, "batch") : undefined,
      filter.institute ? eq(universities.slug, filter.institute) : undefined,
      like
        ? or(
            ilike(mktListings.title, like),
            ilike(universities.name, like),
            sql`(mkt_listings.kind = 'batch' and exists (select 1 from batches b where b.id = mkt_listings.batch_id and b.name ilike ${like}))`,
          )
        : undefined,
    ),
  );
  let items = filter.onOffer ? listed.filter((i) => i.percentOff) : listed;
  if (filter.phase) items = items.filter((i) => i.live?.phase === filter.phase);
  if (filter.sort && filter.sort !== "new") items.sort(SORTS[filter.sort]);
  return filter.limit ? items.slice(0, filter.limit) : items;
}

/** Both halves of the catalogue for one search or one institute: recordings newest first, live batches soonest first. */
export function splitCatalog(items: CatalogItem[]) {
  return {
    recorded: items.filter((i): i is RecordedCatalogItem => !i.live),
    live: items.filter((i): i is LiveCatalogItem => !!i.live).sort(soonest),
  };
}

/** Seats in live batches on sale now, the soonest first unless `sort` says otherwise. */
export async function browseLive(filter: Omit<CatalogFilter, "format" | "kind"> = {}) {
  const items = await browseMarketplace({ ...filter, format: "live", sort: filter.sort ?? "soonest" });
  return items.filter((i): i is LiveCatalogItem => !!i.live);
}

/**
 * The marketplace title of each listing sold through these batches, by batch: what the buyer
 * saw on the shelf, for checkout to show instead of the course's own name.
 */
export async function listingTitlesByBatch(batchIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(batchIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) return new Map();
  const rows = await systemDb().select({ batchId: mktListings.batchId, title: mktListings.title }).from(mktListings).where(inArray(mktListings.batchId, ids));
  return new Map(rows.map((r) => [r.batchId, r.title]));
}

export type DirectoryInstitute = {
  id: string;
  name: string;
  slug: string;
  /** The institute's own colour, when it has set one. */
  brandColor: string | null;
  /** Recorded courses, lectures and combos on sale now. */
  recorded: number;
  /** Live batches a buyer can still take a seat in. */
  live: number;
  /** Everything on sale: recorded plus live. */
  listings: number;
};

const brandColorOf = (branding: { primaryColor?: string } | null) => (branding?.primaryColor && /^#[0-9a-f]{6}$/i.test(branding.primaryColor) ? branding.primaryColor : null);

/**
 * Every active institute on Zinny, the ones with something on sale first (most first), then by
 * name. `q` searches the name. Suspended institutes never appear.
 */
export async function marketplaceDirectory(filter: { q?: string } = {}): Promise<DirectoryInstitute[]> {
  const q = filter.q?.trim().slice(0, 80);
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const [unis, items] = await Promise.all([
    systemDb()
      .select({ id: universities.id, name: universities.name, slug: universities.slug, branding: universities.branding })
      .from(universities)
      .where(and(eq(universities.status, "active"), like ? ilike(universities.name, like) : undefined)),
    liveListings(like ? ilike(universities.name, like) : undefined),
  ]);
  return unis
    .map((u) => {
      const mine = items.filter((i) => i.universityId === u.id);
      const live = mine.filter((i) => i.live).length;
      return { id: u.id, name: u.name, slug: u.slug, brandColor: brandColorOf(u.branding), recorded: mine.length - live, live, listings: mine.length };
    })
    .sort((a, b) => Number(b.listings > 0) - Number(a.listings > 0) || b.listings - a.listings || a.name.localeCompare(b.name));
}

/** Of these batches, the real (live) ones a seat was listed for: checkout says the seat is held while the buyer pays. */
export async function liveBatchNames(batchIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(batchIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) return new Map();
  const rows = await systemDb()
    .select({ id: batches.id, name: batches.name })
    .from(batches)
    .where(and(inArray(batches.id, ids), eq(batches.recorded, false)));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Institutes with something on sale, most listings first: the catalogue's shelves. */
export async function marketplaceInstitutes() {
  return (await marketplaceDirectory()).filter((i) => i.listings > 0);
}

/** An active institute, by slug. Null for one that is suspended or doesn't exist. */
export async function marketplaceInstitute(slug: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const [row] = await systemDb()
    .select({ id: universities.id, name: universities.name, slug: universities.slug, timezone: universities.timezone, branding: universities.branding })
    .from(universities)
    .where(and(eq(universities.slug, slug), eq(universities.status, "active")));
  if (!row) return null;
  const { branding, ...institute } = row;
  return { ...institute, brandColor: brandColorOf(branding) };
}

/**
 * One institute's page: what it sells, under the three tabs. "Live batches" holds the batches
 * running now that still take buyers and the ones yet to start; "Upcoming" only the ones yet to
 * start, the soonest first.
 */
export async function instituteShelves(slug: string) {
  const institute = await marketplaceInstitute(slug);
  if (!institute) return null;
  const { recorded, live } = splitCatalog(await liveListings(eq(universities.id, institute.id)));
  return { institute, recorded, live, upcoming: live.filter((i) => i.live!.phase === "upcoming") };
}

/**
 * `includes`: for a combo, the titles of the courses in it. `course` is the course behind the
 * listing as the institute describes it, for a live batch's "what it covers".
 */
export type ListingDetail = CatalogItem & {
  outline: RecordedOutline;
  ownedEnrolmentId: string | null;
  /** The seat they own is in this very batch (false when they own the course some other way). */
  ownedHere: boolean;
  includes: string[];
  course: { title: string; description: string };
};

/** One live listing and what's in it. Anyone may look; `userId` only tells a signed-in buyer they already own it. */
export async function listingDetail(listingId: string, userId: string | null): Promise<ListingDetail | null> {
  if (!UUID.test(listingId)) return null;
  const [item] = await liveListings(eq(mktListings.id, listingId));
  if (!item) return null;
  const [outline, [course], includes, [owned]] = await Promise.all([
    withTenant(systemActorFor(item.universityId), (tx) => recordedOutline(tx, item.courseId)),
    systemDb().select({ title: courses.title, description: courses.description }).from(courses).where(eq(courses.id, item.courseId)),
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
          .select({ id: enrolments.id, batchId: enrolments.batchId })
          .from(enrolments)
          .where(and(eq(enrolments.userId, userId), eq(enrolments.courseId, item.courseId), inArray(enrolments.status, ["active", "completed"])))
      : [],
  ]);
  return { ...item, outline, includes, course, ownedEnrolmentId: owned?.id ?? null, ownedHere: owned?.batchId === item.batchId };
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
export async function startPurchase(
  userId: string,
  listingId: string,
  code?: string,
  /** For a cart: a code that doesn't fit this item is skipped instead of refused. */
  opts: { skipCodeThatDoesNotFit?: boolean } = {},
): Promise<{ slug: string; orderId: string; codeApplied: boolean; live: boolean }> {
  const access = await marketplaceAccess(userId);
  if (!access.canShop) throw new ForbiddenError("Buying is open to learners: students, alumni and people with a free Zinny account.");
  const item = await liveListing(listingId);
  const deal = code?.trim()
    ? await applyCode(item, code).catch((e) => {
        if (opts.skipCodeThatDoesNotFit && e instanceof ValidationError) return null;
        throw e;
      })
    : null;
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

  // A live batch is a real seat: the batch's limit applies and the seat is kept while they pay.
  const held = item.live
    ? await holdMarketplaceSeat(actor, { batchId: item.batchId, pricePaise, lateJoin: item.live.lateJoin })
    : await holdRecordedSeat(actor, { batchId: item.batchId, pricePaise });
  if (item.live) {
    await withTenant(systemActorFor(item.universityId), async (tx) => {
      const [sale] = await tx
        .insert(mktSeatSales)
        .values({ universityId: item.universityId, listingId: item.id, orderId: held.orderId })
        .onConflictDoNothing()
        .returning({ id: mktSeatSales.id });
      if (sale) await audit(tx, actor, "marketplace.seat_hold", "mkt_listing", item.id, { orderId: held.orderId, batchId: item.batchId });
    });
  }
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
  return { slug: item.instituteSlug, orderId: held.orderId, codeApplied: !!deal, live: !!item.live };
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
  /** For a seat in a live batch: its dates and timings, the next class and whether it can be joined now. */
  live: (BatchFacts & { joinOpen: boolean }) | null;
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
      batchId: orders.batchId,
      institute: universities.name,
      instituteSlug: universities.slug,
      enrolmentId: enrolments.id,
      status: enrolments.status,
      percent: contentCourseProgress.percent,
      paidAt: orders.paidAt,
      invoiceId: invoices.id,
    })
    .from(orders)
    // Recordings by their hidden batch. A seat in a live batch only through its sale: the same
    // batch holds the institute's own students, and their orders aren't marketplace purchases.
    .leftJoin(mktSeatSales, eq(mktSeatSales.orderId, orders.id))
    .innerJoin(
      mktListings,
      or(eq(mktListings.id, mktSeatSales.listingId), and(isNull(mktSeatSales.id), ne(mktListings.kind, "batch"), eq(mktListings.batchId, orders.batchId))),
    )
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
  const facts = await batchFacts(rows.filter((r) => r.kind === "batch").map((r) => r.batchId));
  const now = new Date();
  return rows.map(({ status, percent, paidAt, batchId, ...r }) => {
    const f = r.kind === "batch" ? facts.get(batchId) : undefined;
    return {
      ...r,
      completed: status === "completed",
      percent: percent ?? 0,
      boughtAt: paidAt!,
      live: f ? { ...f, joinOpen: !!f.nextClass && joinWindowOpen(f.nextClass, f.today, minutesNowIn(f.timezone, now)) } : null,
    };
  });
}

/** Whether this person holds a seat in a live batch at this institute (bought on the marketplace or not), so their learner app shows a timetable. */
export async function hasLiveSeat(userId: string, universityId: string) {
  const [row] = await systemDb()
    .select({ id: enrolments.id })
    .from(enrolments)
    .innerJoin(batches, eq(batches.id, enrolments.batchId))
    .where(and(eq(enrolments.userId, userId), eq(enrolments.universityId, universityId), eq(enrolments.status, "active"), eq(batches.recorded, false)))
    .limit(1);
  return !!row;
}

/* ───────────────────────────── For the cart ───────────────────────────── */

/** These listings, if they are still on sale. */
export async function liveListingsByIds(ids: string[]) {
  const valid = ids.filter((id) => UUID.test(id));
  return valid.length ? liveListings(inArray(mktListings.id, valid)) : [];
}

/** Of these courses, the ones this person already owns (enrolled, active or completed). */
export async function ownedCourseIds(userId: string, courseIds: string[]) {
  if (courseIds.length === 0) return new Set<string>();
  const rows = await systemDb()
    .select({ courseId: enrolments.courseId })
    .from(enrolments)
    .where(and(eq(enrolments.userId, userId), inArray(enrolments.courseId, courseIds), inArray(enrolments.status, ["active", "completed"])));
  return new Set(rows.map((r) => r.courseId));
}
