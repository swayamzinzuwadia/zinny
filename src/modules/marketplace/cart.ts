import "server-only";
/**
 * The cart: listings a learner means to buy together, from any institutes, paid in one go.
 * Checking out turns each item into an ordinary held order at its own institute (with the
 * code applied wherever it fits); the payments module then takes one payment for all of them.
 *
 * Like the rest of the marketplace's buyer side, it reads through the system connection: the
 * cart spans institutes and belongs to the learner, not to any one of them.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { courses } from "@/db/schema";
import { gstFor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { mktCartItems, mktListings } from "./schema";
import { liveListingsByIds, marketplaceAccess, ownedCourseIds, startPurchase, type CatalogItem } from "./service";

/** At most this many in a cart, so one payment stays a sensible size. */
export const CART_LIMIT = 20;

/** What the header badge shows: items in the cart that the learner doesn't own yet (bought ones leave the cart when it's next opened). */
export async function cartCount(userId: string) {
  const [{ n }] = await systemDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(mktCartItems)
    .innerJoin(mktListings, eq(mktListings.id, mktCartItems.listingId))
    .where(
      and(
        eq(mktCartItems.userId, userId),
        sql`not exists (select 1 from enrolments e where e.user_id = ${userId} and e.course_id = ${mktListings.courseId} and e.status in ('active', 'completed'))`,
      ),
    );
  return n;
}

export async function addToCart(userId: string, listingId: string) {
  if (!(await marketplaceAccess(userId)).canShop) throw new ForbiddenError("Buying is open to learners: students, alumni and people with a free Zinny account.");
  const [item] = await liveListingsByIds([listingId]);
  if (!item) throw new NotFoundError("Listing");
  if ((await ownedCourseIds(userId, [item.courseId])).size) throw new ConflictError("This is already on your shelf.", "already_owned");
  if (item.live?.seatsLeft === 0) throw new ConflictError(`${item.live.batchName} is full, so it can't go in your cart.`, "batch_full");
  if ((await cartCount(userId)) >= CART_LIMIT) throw new ValidationError(`A cart holds up to ${CART_LIMIT} items. Check out what's in it first.`);
  await systemDb().insert(mktCartItems).values({ userId, listingId }).onConflictDoNothing();
  return { count: await cartCount(userId) };
}

export async function removeFromCart(userId: string, listingId: string) {
  await systemDb()
    .delete(mktCartItems)
    .where(and(eq(mktCartItems.userId, userId), eq(mktCartItems.listingId, listingId)));
  return { count: await cartCount(userId) };
}

export type CartLine = CatalogItem & { gstPaise: number };
export type CartView = { lines: CartLine[]; subtotalPaise: number; gstPaise: number; totalPaise: number; dropped: number };

/**
 * What's in the cart now, with GST worked out per course at its own rate. Listings that went
 * off sale and courses the learner has since bought leave the cart here, counted in `dropped`.
 */
export async function cartView(userId: string): Promise<CartView> {
  const rows = await systemDb()
    .select({ listingId: mktCartItems.listingId })
    .from(mktCartItems)
    .where(eq(mktCartItems.userId, userId))
    .orderBy(asc(mktCartItems.addedAt));
  const items = await liveListingsByIds(rows.map((r) => r.listingId));
  const owned = await ownedCourseIds(userId, items.map((i) => i.courseId));
  const keep = items.filter((i) => !owned.has(i.courseId));
  const gone = rows.map((r) => r.listingId).filter((id) => !keep.some((k) => k.id === id));
  if (gone.length) {
    await systemDb()
      .delete(mktCartItems)
      .where(and(eq(mktCartItems.userId, userId), inArray(mktCartItems.listingId, gone)));
  }
  const rates = keep.length
    ? new Map((await systemDb().select({ id: courses.id, gstRateBp: courses.gstRateBp }).from(courses).where(inArray(courses.id, keep.map((i) => i.courseId)))).map((c) => [c.id, c.gstRateBp]))
    : new Map<string, number>();
  const order = new Map(rows.map((r, i) => [r.listingId, i]));
  const lines = keep
    .map((i) => ({ ...i, gstPaise: gstFor(i.pricePaise, rates.get(i.courseId) ?? 1800) }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const subtotalPaise = lines.reduce((n, l) => n + l.pricePaise, 0);
  const gstPaise = lines.reduce((n, l) => n + l.gstPaise, 0);
  return { lines, subtotalPaise, gstPaise, totalPaise: subtotalPaise + gstPaise, dropped: gone.length };
}

/**
 * Holds every course in the cart as its own order, with the code applied wherever it fits.
 * The cart stays as it is until the payment goes through; bought courses leave it then.
 */
export async function checkoutCart(userId: string, code?: string) {
  const { lines } = await cartView(userId);
  if (lines.length === 0) throw new ValidationError("Your cart is empty.");
  const orderIds: string[] = [];
  let codeApplied = 0;
  for (const line of lines) {
    const held = await startPurchase(userId, line.id, code, { skipCodeThatDoesNotFit: true });
    orderIds.push(held.orderId);
    if (held.codeApplied) codeApplied += 1;
  }
  if (code?.trim() && codeApplied === 0) throw new ValidationError(`"${code.trim()}" doesn't work on anything in your cart. Check the spelling, or check out without it.`);
  return { orderIds, codeApplied };
}

/** Whether this listing is already in the learner's cart, for the listing page's button. */
export async function inCart(userId: string, listingId: string) {
  const [row] = await systemDb()
    .select({ listingId: mktCartItems.listingId })
    .from(mktCartItems)
    .where(and(eq(mktCartItems.userId, userId), eq(mktCartItems.listingId, listingId)));
  return !!row;
}
