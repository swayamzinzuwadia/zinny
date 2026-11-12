/**
 * Live batches on the marketplace: the recorded/live split of the catalogue, which batches can
 * be listed and by whom, the seat limit and hold while buying, listings that stop being offered
 * on their own, the institutes directory and each institute's tabs.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { batchSlots, batches, courses, enrolments, orders, roleAssignments, universities } from "@/db/schema";
import { loadActor, systemActorFor } from "@/server/actor";
import { can } from "@/server/authz/engine";
import { addDays, todayIn } from "@/server/lib/dates";
import { createBatch, updateBatch } from "@/server/services/batches";
import { confirmPayment, failPayment, holdSeat } from "@/server/services/enrolment";
import { studentTimetable } from "@/server/services/timetable";
import { withTenant } from "@/server/tenant";
import { signUpMarketplaceLearner } from "@/modules/identity/auth";
import { contentLessons, contentSections } from "@/modules/content-progress/schema";
import { addToCart, cartView, checkoutCart } from "@/modules/marketplace/cart";
import { handlers } from "@/modules/marketplace/events";
import {
  batchListingProblem,
  courseMarketplace,
  createBatchListing,
  createListing,
  getListing,
  listListings,
  listableBatches,
  listableSources,
  removeBatchListing,
  salesSummary,
  setListingStatus,
  updateListing,
} from "@/modules/marketplace/listings";
import { mktListings, mktSeatSales } from "@/modules/marketplace/schema";
import {
  browseLive,
  browseMarketplace,
  fewSeatsLeft,
  hasLiveSeat,
  instituteShelves,
  listingDetail,
  marketplaceDirectory,
  marketplaceInstitute,
  marketplaceInstitutes,
  myLibrary,
  startPurchase,
  startsSoon,
} from "@/modules/marketplace/service";
import { payRefunds } from "@/modules/payments/schema";
import { WEEKDAYS, makeDepartment, person, setupCourse, slots, uniqueCode } from "../fixtures";
import { expectTenantIsolated } from "../helpers/isolation";

afterAll(() => closeDb());

const PW = "a quiet green field";
const today = todayIn("Asia/Kolkata");

async function learner(name = "Live Learner") {
  const r = await signUpMarketplaceLearner({
    name,
    email: `live.${uniqueCode("").toLowerCase()}@market.test`,
    password: PW,
    confirm: PW,
    ip: `10.6.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
  if (r.status !== "created") throw new Error("Sign-up was limited.");
  return r.userId;
}

type Shop = Awaited<ReturnType<typeof setupCourse>>;

/** One more real batch of the shop's course. */
async function addBatch(s: Shop, over: Partial<Parameters<typeof createBatch>[1]> = {}) {
  return createBatch(s.hod, {
    courseId: s.course.id,
    name: `Batch ${uniqueCode("")}`,
    startDate: addDays(today, 10),
    endDate: addDays(today, 100),
    seatLimit: 20,
    slots: slots(WEEKDAYS, "18:00", "20:00"),
    faculty: [{ userId: s.facultyUserId, role: "permanent_faculty" }],
    ...over,
  });
}

const listBatch = (s: Shop, batchId: string, over: Partial<Parameters<typeof createBatchListing>[1]> = {}) =>
  createBatchListing(s.hod, { batchId, description: "Taught live.", pricePaise: 500_000, ...over });

const patchBatch = (batchId: string, set: Partial<typeof batches.$inferInsert>) => systemDb().update(batches).set(set).where(eq(batches.id, batchId));

async function pay(userId: string, listingId: string) {
  const { orderId } = await startPurchase(userId, listingId);
  const [order] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
  const outcome = await confirmPayment(order.universityId, { orderId, gatewayPaymentId: `pay_${orderId.slice(0, 8)}` });
  return { orderId, universityId: order.universityId, outcome };
}

/** A recorded listing for the shop's course, so both halves of the catalogue have something. */
async function addRecording(s: Shop) {
  const [section] = await systemDb().insert(contentSections).values({ universityId: s.uni.id, courseId: s.course.id, title: "Week 1" }).returning();
  await systemDb()
    .insert(contentLessons)
    .values({ universityId: s.uni.id, courseId: s.course.id, sectionId: section.id, title: "Intro", kind: "video", content: { source: "youtube", videoId: "abc123", url: "https://youtu.be/abc123" }, ready: true, durationMinutes: 10 });
  return createListing(s.hod, { kind: "course", sourceId: s.course.id, title: "The full recordings", description: "", pricePaise: 100_000 });
}

describe("the catalogue's two halves", () => {
  it("keeps recordings and live batches apart, and searches across both", async () => {
    const name = `Twohalves ${uniqueCode()}`;
    const s = await setupCourse({ name });
    const recording = await addRecording(s);
    const upcoming = await listBatch(s, s.batch.id);
    const runningBatch = await addBatch(s, { name: "Already going", startDate: addDays(today, -7) });
    const running = await listBatch(s, runningBatch.id, { lateJoin: true, pricePaise: 300_000 });

    // The default is what it was before live batches: recordings only (the institute's website and the homepage rely on it).
    expect((await browseMarketplace({ q: name })).map((i) => i.id)).toEqual([recording.id]);
    expect((await browseMarketplace({ q: name, format: "recorded" })).map((i) => i.id)).toEqual([recording.id]);
    expect((await browseMarketplace({ q: name, format: "live" })).map((i) => i.id).sort()).toEqual([upcoming.id, running.id].sort());
    const both = await browseMarketplace({ q: name, format: "all" });
    expect(both.map((i) => i.id).sort()).toEqual([recording.id, upcoming.id, running.id].sort());
    // Each result says which half it belongs to.
    expect(both.find((i) => i.id === recording.id)).toMatchObject({ kind: "course", live: null });
    expect(both.find((i) => i.id === upcoming.id)).toMatchObject({ kind: "batch", live: { phase: "upcoming", batchName: "Weekday morning" } });

    // Live filters and sorting: yet to start, running now, soonest first, by price.
    expect((await browseLive({ q: name, phase: "upcoming" })).map((i) => i.id)).toEqual([upcoming.id]);
    expect((await browseLive({ q: name, phase: "running" })).map((i) => i.id)).toEqual([running.id]);
    expect((await browseLive({ q: name })).map((i) => i.id)).toEqual([upcoming.id, running.id]);
    expect((await browseLive({ q: name, sort: "price-low" })).map((i) => i.id)).toEqual([running.id, upcoming.id]);
    // The recorded filters never let a live batch through.
    expect((await browseMarketplace({ q: name, kind: "course" })).map((i) => i.id)).toEqual([recording.id]);
    // A batch is found by its own name too.
    expect((await browseLive({ q: "Already going" })).map((i) => i.id)).toContain(running.id);
  });

  it("gives a live listing its dates, timings, classes, faculty and seats", async () => {
    const s = await setupCourse({ seatLimit: 4 });
    const listing = await listBatch(s, s.batch.id, { compareAtPaise: 800_000 });
    const item = (await listingDetail(listing.id, null))!;
    expect(item).toMatchObject({ kind: "batch", title: "Data Analytics", pricePaise: 500_000, compareAtPaise: 800_000, percentOff: 38, course: { title: "Data Analytics" } });
    expect(item.live).toMatchObject({
      batchName: "Weekday morning",
      startDate: "2030-11-04",
      endDate: "2031-01-31",
      timings: "Mon to Fri, 9 am to 11 am",
      timezone: "Asia/Kolkata",
      faculty: ["Faculty Farah"],
      seatLimit: 4,
      seatsLeft: 4,
      lateJoin: false,
      phase: "upcoming",
    });
    // 4 Nov 2030 is a Monday and 31 Jan 2031 a Friday: 13 full weeks of weekdays.
    expect(item.live!.classes).toBe(65);
    expect(item.live!.nextClass).toEqual({ date: "2030-11-04", startTime: "09:00:00", endTime: "11:00:00" });
  });

  it("says seats are few only when they are, and that a batch starts soon only within a week", () => {
    expect(fewSeatsLeft({ seatsLeft: 3, seatLimit: 8 })).toBe(true);
    expect(fewSeatsLeft({ seatsLeft: 5, seatLimit: 8 })).toBe(false);
    expect(fewSeatsLeft({ seatsLeft: 0, seatLimit: 8 })).toBe(false);
    expect(fewSeatsLeft({ seatsLeft: 10, seatLimit: 200 })).toBe(true);
    expect(fewSeatsLeft({ seatsLeft: 11, seatLimit: 200 })).toBe(false);
    expect(startsSoon({ phase: "upcoming", startsInDays: 7 })).toBe(true);
    expect(startsSoon({ phase: "upcoming", startsInDays: 8 })).toBe(false);
    expect(startsSoon({ phase: "running", startsInDays: -2 })).toBe(false);
  });
});

describe("listing a live batch", () => {
  it("lists an open batch with timings, at its own price, next to the course's recordings and other batches", async () => {
    const s = await setupCourse({ pricePaise: 900_000 });
    const recording = await addRecording(s);
    const second = await addBatch(s);
    const a = await listBatch(s, s.batch.id, { lateJoin: true });
    const b = await listBatch(s, second.id, { title: "Data Analytics, evenings" });
    expect(a).toMatchObject({ kind: "batch", courseId: s.course.id, batchId: s.batch.id, title: "Data Analytics", pricePaise: 500_000, lateJoin: true, status: "live" });
    expect(b.title).toBe("Data Analytics, evenings");
    // One course: its recordings and two live batches, all on sale.
    const m = await courseMarketplace(s.hod, s.course.id);
    expect(m.whole?.id).toBe(recording.id);
    expect(m.batches.map((l) => l.id)).toEqual([a.id, b.id]);
    expect(m.batches[0].batch).toMatchObject({ batchName: "Weekday morning", state: "on_sale", seatLimit: 20, seatsTaken: 0 });
    // The course price is untouched: it is the institute's own.
    const [course] = await systemDb().select().from(courses).where(eq(courses.id, s.course.id));
    expect(course.pricePaise).toBe(900_000);
    // A recording can still be listed for a course whose batches are on sale.
    const other = await setupCourse();
    await systemDb().insert(contentSections).values({ universityId: other.uni.id, courseId: other.course.id, title: "W1" });
    await listBatch(other, other.batch.id);
    expect((await listableBatches(other.hod)).map((x) => x.id)).toEqual([]);
    expect(await listableSources(other.hod)).toEqual([]);
  });

  it("refuses a batch listed already, and takes it again once that listing is removed", async () => {
    const s = await setupCourse();
    const first = await listBatch(s, s.batch.id);
    await expect(listBatch(s, s.batch.id)).rejects.toMatchObject({ code: "already_listed" });
    await removeBatchListing(s.hod, first.id);
    expect((await listableBatches(s.hod)).map((b) => b.id)).toEqual([s.batch.id]);
    const again = await listBatch(s, s.batch.id);
    expect(again.id).not.toBe(first.id);
    expect((await listListings(s.hod)).map((l) => l.id)).toEqual([again.id]);
  });

  it("refuses a recorded batch, a closed one, an ended one, one without timings and one that needs approval", async () => {
    const s = await setupCourse();
    const recording = await addRecording(s);
    await expect(listBatch(s, recording.batchId)).rejects.toThrow(/hidden batch behind a recorded course/);

    const closed = await addBatch(s);
    await patchBatch(closed.id, { status: "closed" });
    await expect(listBatch(s, closed.id)).rejects.toThrow(/Only an open batch can be listed/);

    const ended = await addBatch(s);
    await patchBatch(ended.id, { startDate: addDays(today, -40), endDate: addDays(today, -1) });
    await expect(listBatch(s, ended.id)).rejects.toThrow(/has ended/);

    const untimed = await addBatch(s);
    await systemDb().delete(batchSlots).where(eq(batchSlots.batchId, untimed.id));
    await expect(listBatch(s, untimed.id)).rejects.toThrow(/no class timings yet/);

    const gated = await addBatch(s, { approvalRequired: true });
    await expect(listBatch(s, gated.id)).rejects.toThrow(/Faculty accept each student/);

    // The admin sees each of them with its reason; ended and recorded batches aren't offered at all.
    const offered = await listableBatches(s.hod, s.course.id);
    const reason = (id: string) => offered.find((b) => b.id === id)?.problem;
    expect(reason(s.batch.id)).toBeNull();
    expect(reason(closed.id)).toMatch(/closed/);
    expect(reason(untimed.id)).toMatch(/timings/);
    expect(reason(gated.id)).toMatch(/Faculty accept each student/);
    expect(offered.map((b) => b.id)).not.toContain(ended.id);
    expect(offered.map((b) => b.id)).not.toContain(recording.batchId);
    // Each rule, on its own.
    const ok = { recorded: false, status: "open" as const, endDate: today, approvalRequired: false };
    expect(batchListingProblem(ok, 1, today)).toBeNull();
    expect(batchListingProblem({ ...ok, status: "draft" }, 1, today)).toMatch(/draft/);
    expect(batchListingProblem({ ...ok, endDate: addDays(today, -1) }, 1, today)).toMatch(/ended/);

    // A batch that ends today can still be listed, and one whose approval is switched off becomes listable.
    await updateBatch(s.hod, gated.id, { approvalRequired: false });
    await expect(listBatch(s, gated.id)).resolves.toMatchObject({ kind: "batch" });
  });

  it("needs course.update on the batch's course: its HOD and the admin may, another HOD, faculty and students may not", async () => {
    const s = await setupCourse();
    const otherDept = await makeDepartment(s.uni.id, "MKT", "Marketing");
    const otherHod = await (await person("Hod Mehul", "hod", { universityId: s.uni.id, departmentId: otherDept.id })).actor();
    const faculty = await loadActor(s.facultyUserId, s.uni.id);
    const student = await s.student("Student Riya");
    const outsider = await setupCourse();
    for (const who of [otherHod, faculty, student, outsider.admin]) {
      await expect(createBatchListing(who, { batchId: s.batch.id, description: "", pricePaise: 500_000 })).rejects.toMatchObject({ status: expect.any(Number) });
      if (who !== outsider.admin) expect(await listableBatches(who)).toEqual([]);
    }
    await expect(createBatchListing(otherHod, { batchId: s.batch.id, description: "", pricePaise: 500_000 })).rejects.toMatchObject({ status: 403 });
    // Another institute's admin can't even see the batch.
    await expect(createBatchListing(outsider.admin, { batchId: s.batch.id, description: "", pricePaise: 500_000 })).rejects.toMatchObject({ status: 404 });

    const listing = await createBatchListing(s.admin, { batchId: s.batch.id, description: "", pricePaise: 500_000 });
    for (const who of [otherHod, faculty, student]) {
      await expect(setListingStatus(who, listing.id, "paused")).rejects.toMatchObject({ status: 403 });
      await expect(removeBatchListing(who, listing.id)).rejects.toMatchObject({ status: 403 });
      await expect(updateListing(who, listing.id, { title: "Mine now", description: "", pricePaise: 100, lateJoin: true })).rejects.toMatchObject({ status: 403 });
    }
    await expect(setListingStatus(s.hod, listing.id, "paused")).resolves.toBeUndefined();
  });

  it("checks the price like every listing, and audits listing, pausing and removing", async () => {
    const s = await setupCourse();
    await expect(listBatch(s, s.batch.id, { pricePaise: 0 })).rejects.toThrow(/at least ₹1/);
    await expect(listBatch(s, s.batch.id, { compareAtPaise: 400_000 })).rejects.toThrow(/higher than the price/);
    const listing = await listBatch(s, s.batch.id);
    await updateListing(s.hod, listing.id, { title: "Data Analytics, mornings", description: "New words.", pricePaise: 450_000, lateJoin: true });
    expect(await getListing(s.hod, listing.id)).toMatchObject({ title: "Data Analytics, mornings", pricePaise: 450_000, lateJoin: true, buyers: 0 });
    // A plain save (no late-joining box on the form) leaves late joining as it is.
    await updateListing(s.hod, listing.id, { title: "Data Analytics, mornings", description: "", pricePaise: 450_000 });
    expect((await getListing(s.hod, listing.id)).lateJoin).toBe(true);
    await setListingStatus(s.hod, listing.id, "paused");
    expect((await getListing(s.hod, listing.id)).batch?.state).toBe("paused");
    expect(await listingDetail(listing.id, null)).toBeNull();
    await setListingStatus(s.hod, listing.id, "live");
    expect(await listingDetail(listing.id, null)).not.toBeNull();
    await removeBatchListing(s.hod, listing.id);
    await expect(getListing(s.hod, listing.id)).rejects.toMatchObject({ status: 404 });
    expect(await listingDetail(listing.id, null)).toBeNull();

    const trail = await withTenant(systemActorFor(s.uni.id), (tx) => tx.execute<{ action: string }>(`select action from audit_log where entity_id = '${listing.id}' order by at`));
    expect([...trail].map((r) => r.action)).toEqual(["marketplace.list", "marketplace.update", "marketplace.update", "marketplace.pause", "marketplace.resume", "marketplace.remove"]);
  });

  it("only removes live batches: a recorded listing is paused instead", async () => {
    const s = await setupCourse();
    const recording = await addRecording(s);
    await expect(removeBatchListing(s.hod, recording.id)).rejects.toThrow(/Only a live batch can be removed/);
  });
});

describe("buying a seat in a live batch", () => {
  it("enrols the buyer in that real batch as an individual learner, with an invoice, a library entry and a timetable", async () => {
    const s = await setupCourse();
    await patchBatch(s.batch.id, { startDate: addDays(today, -7), endDate: addDays(today, 60), meetingUrl: "https://meet.example/abc" });
    const listing = await listBatch(s, s.batch.id, { lateJoin: true });
    const buyer = await learner();
    const { orderId, outcome } = await pay(buyer, listing.id);
    expect(outcome).toMatchObject({ status: "enrolled", invoiceNumber: expect.any(String) });

    const [order] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
    // The marketplace price, not the course's; GST at the course's rate.
    expect(order).toMatchObject({ batchId: s.batch.id, courseId: s.course.id, basePaise: 500_000, gstPaise: 90_000, totalPaise: 590_000, status: "paid" });
    const [seat] = await systemDb().select().from(enrolments).where(eq(enrolments.id, order.enrolmentId!));
    expect(seat).toMatchObject({ userId: buyer, batchId: s.batch.id, status: "active" });
    const roles = await systemDb().select().from(roleAssignments).where(and(eq(roleAssignments.userId, buyer), eq(roleAssignments.universityId, s.uni.id)));
    expect(roles.map((r) => r.role)).toEqual(["individual_learner"]);

    const [mine] = await myLibrary(buyer);
    expect(mine).toMatchObject({ kind: "batch", listingId: listing.id, title: "Data Analytics", enrolmentId: seat.id, invoiceId: expect.any(String) });
    expect(mine.live).toMatchObject({ batchId: s.batch.id, batchName: "Weekday morning", timings: "Mon to Fri, 9 am to 11 am" });
    expect(mine.live!.nextClass).not.toBeNull();
    expect((await listingDetail(listing.id, buyer))!).toMatchObject({ ownedEnrolmentId: seat.id, ownedHere: true });

    // In the institute's learner app: a timetable with the class and its join link, and the right to join.
    const actor = await loadActor(buyer, s.uni.id);
    expect(await hasLiveSeat(buyer, s.uni.id)).toBe(true);
    const next = mine.live!.nextClass!;
    const week = await studentTimetable(actor, { from: next.date, to: next.date });
    expect(week.sessions).toEqual([expect.objectContaining({ batchId: s.batch.id, date: next.date, joinUrl: "https://meet.example/abc" })]);
    expect(can(actor, "self.join_class", { universityId: s.uni.id, ownerUserId: buyer })).toBe(true);
    // The institute's own catalogue stays closed to them.
    expect(can(actor, "catalog.browse", { universityId: s.uni.id })).toBe(false);
    await expect(holdSeat(actor, { batchId: s.batch.id })).rejects.toMatchObject({ status: 403 });

    // The seat counts once, and as a marketplace sale.
    expect(await getListing(s.hod, listing.id)).toMatchObject({ buyers: 1, batch: { seatsTaken: 1, seatLimit: 20 } });
    await expect(startPurchase(buyer, listing.id)).rejects.toMatchObject({ code: "already_enrolled" });
  });

  it("holds the seat while the buyer pays, shows a full batch as full, and frees the seat when the payment fails or the hold runs out", async () => {
    const s = await setupCourse({ seatLimit: 2 });
    const listing = await listBatch(s, s.batch.id);
    // One of the institute's own students has a seat: the limit is shared.
    await holdSeat(await s.student("Own Student"), { batchId: s.batch.id });
    const [first, second] = [await learner("First"), await learner("Second")];
    expect((await listingDetail(listing.id, null))!.live).toMatchObject({ seatsLeft: 1, seatLimit: 2 });

    const held = await startPurchase(first, listing.id);
    const [seat] = await systemDb().select().from(enrolments).innerJoin(orders, eq(orders.enrolmentId, enrolments.id)).where(eq(orders.id, held.orderId));
    expect(seat.enrolments.status).toBe("held");
    const minutes = (seat.enrolments.holdExpiresAt!.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);
    // Starting checkout again resumes the same hold instead of taking another seat.
    expect((await startPurchase(first, listing.id)).orderId).toBe(held.orderId);

    // Full: still on the shelf, but it can't be bought or put in a cart.
    expect((await browseLive({ institute: s.uni.slug })).map((i) => [i.id, i.live.seatsLeft])).toEqual([[listing.id, 0]]);
    await expect(startPurchase(second, listing.id)).rejects.toMatchObject({ code: "batch_full" });
    await expect(addToCart(second, listing.id)).rejects.toMatchObject({ code: "batch_full" });
    expect((await getListing(s.hod, listing.id)).batch?.state).toBe("full");
    // The seat isn't the buyer's yet: nothing in the library, no sale counted.
    expect(await myLibrary(first)).toEqual([]);
    expect((await getListing(s.hod, listing.id)).buyers).toBe(0);

    // A failed payment frees the seat at once.
    await failPayment(s.uni.id, held.orderId);
    expect((await listingDetail(listing.id, null))!.live!.seatsLeft).toBe(1);
    const again = await startPurchase(second, listing.id);

    // A hold that runs out frees it too.
    await systemDb().update(enrolments).set({ holdExpiresAt: new Date(Date.now() - 1000) }).where(eq(enrolments.userId, second));
    expect((await listingDetail(listing.id, null))!.live!.seatsLeft).toBe(1);
    const taken = await pay(first, listing.id);
    expect(taken.outcome.status).toBe("enrolled");
    // The second buyer pays after their hold ran out and the batch filled: refunded, never enrolled.
    expect(await confirmPayment(s.uni.id, { orderId: again.orderId, gatewayPaymentId: "pay_late" })).toMatchObject({ status: "refund_due" });
    expect(await myLibrary(second)).toEqual([]);
    expect((await myLibrary(first)).map((i) => i.listingId)).toEqual([listing.id]);
  });

  it("goes through the cart with recordings, each as its own order", async () => {
    const s = await setupCourse({ seatLimit: 5 });
    const other = await setupCourse();
    const recording = await addRecording(other);
    const listing = await listBatch(s, s.batch.id);
    const buyer = await learner();
    await addToCart(buyer, listing.id);
    await addToCart(buyer, recording.id);
    const cart = await cartView(buyer);
    expect(cart.lines.map((l) => [l.id, l.live?.batchName ?? null])).toEqual([
      [listing.id, "Weekday morning"],
      [recording.id, null],
    ]);
    expect(cart.totalPaise).toBe(590_000 + 118_000);
    const { orderIds } = await checkoutCart(buyer);
    expect(orderIds).toHaveLength(2);
    expect((await listingDetail(listing.id, null))!.live!.seatsLeft).toBe(4);
    for (const orderId of orderIds) {
      const [o] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
      await confirmPayment(o.universityId, { orderId, gatewayPaymentId: `pay_${orderId.slice(0, 8)}` });
    }
    expect((await myLibrary(buyer)).map((i) => i.kind).sort()).toEqual(["batch", "course"]);
    expect((await cartView(buyer)).lines).toEqual([]);
  });

  it("counts only seats sold through the marketplace, in the listing and in the sales summary", async () => {
    const s = await setupCourse();
    const listing = await listBatch(s, s.batch.id);
    await holdSeat(await s.student("Own One"), { batchId: s.batch.id });
    await holdSeat(await s.student("Own Two"), { batchId: s.batch.id });
    await pay(await learner(), listing.id);
    const [row] = await listListings(s.hod);
    expect(row).toMatchObject({ id: listing.id, buyers: 1, batch: { seatsTaken: 3, state: "on_sale" } });
    expect(await salesSummary(s.hod, today)).toMatchObject({ live: 1, paused: 0, buyers: 1, earnedPaise: 500_000 });
    // The institute's own students aren't marketplace buyers: nothing of theirs is in a library.
    const own = await systemDb().select().from(enrolments).where(and(eq(enrolments.batchId, s.batch.id), eq(enrolments.status, "active")));
    expect(own).toHaveLength(3);
    expect(await systemDb().select().from(mktSeatSales).where(eq(mktSeatSales.listingId, listing.id))).toHaveLength(1);
  });

  it("keeps a bought seat in the library when the listing is removed, and ends it on a full refund", async () => {
    const s = await setupCourse();
    const listing = await listBatch(s, s.batch.id);
    const [keeper, refunded] = [await learner("Keeper"), await learner("Refunded")];
    await pay(keeper, listing.id);
    const { orderId } = await pay(refunded, listing.id);
    await removeBatchListing(s.hod, listing.id);
    await listBatch(s, s.batch.id);
    // One entry each, from the listing they bought through.
    expect((await myLibrary(keeper)).map((i) => i.listingId)).toEqual([listing.id]);

    const sys = systemActorFor(s.uni.id);
    const refund = async (amountPaise: number) => {
      await systemDb().insert(payRefunds).values({ universityId: s.uni.id, orderId, amountPaise, reason: "Test", status: "processed", gateway: "mock" });
      const event = { id: crypto.randomUUID(), universityId: s.uni.id, type: "payment.refunded", payload: { orderId, userId: "", amountPaise: 0 }, actorUserId: null, occurredAt: new Date() };
      await withTenant(sys, (tx) => handlers[0].handle({ tx, actor: sys, event } as never));
    };
    await refund(90_000);
    expect(await myLibrary(refunded)).toHaveLength(1);
    await refund(500_000);
    expect(await myLibrary(refunded)).toEqual([]);
    expect(await hasLiveSeat(refunded, s.uni.id)).toBe(false);
    expect(await hasLiveSeat(keeper, s.uni.id)).toBe(true);
  });
});

describe("listings that stop being offered on their own", () => {
  const offered = async (listingId: string, slug: string) => ({
    shelf: (await browseLive({ institute: slug })).some((i) => i.id === listingId),
    page: (await listingDetail(listingId, null)) !== null,
  });

  it("drops a batch past its end date, a closed or archived one, and one that now needs approval", async () => {
    const s = await setupCourse();
    const listing = await listBatch(s, s.batch.id);
    const buyer = await learner();
    expect(await offered(listing.id, s.uni.slug)).toEqual({ shelf: true, page: true });

    // Its last day is still a day to buy on (with late joining); the day after is not.
    await updateListing(s.hod, listing.id, { title: "Data Analytics", description: "", pricePaise: 500_000, lateJoin: true });
    await patchBatch(s.batch.id, { startDate: addDays(today, -30), endDate: today });
    expect(await offered(listing.id, s.uni.slug)).toEqual({ shelf: true, page: true });
    await patchBatch(s.batch.id, { endDate: addDays(today, -1) });
    expect(await offered(listing.id, s.uni.slug)).toEqual({ shelf: false, page: false });
    expect((await getListing(s.hod, listing.id)).batch?.state).toBe("ended");
    await expect(startPurchase(buyer, listing.id)).rejects.toMatchObject({ status: 404 });
    await expect(addToCart(buyer, listing.id)).rejects.toMatchObject({ status: 404 });
    // Nothing was written: the listing is still "live", it just isn't offered.
    const [row] = await systemDb().select().from(mktListings).where(eq(mktListings.id, listing.id));
    expect(row.status).toBe("live");

    await patchBatch(s.batch.id, { endDate: addDays(today, 30) });
    expect((await offered(listing.id, s.uni.slug)).shelf).toBe(true);
    for (const status of ["closed", "archived", "draft"] as const) {
      await patchBatch(s.batch.id, { status });
      expect(await offered(listing.id, s.uni.slug)).toEqual({ shelf: false, page: false });
      expect((await getListing(s.hod, listing.id)).batch?.state).toBe("closed");
    }
    await patchBatch(s.batch.id, { status: "open", approvalRequired: true });
    expect(await offered(listing.id, s.uni.slug)).toEqual({ shelf: false, page: false });
    expect((await getListing(s.hod, listing.id)).batch?.state).toBe("needs_approval");
    await patchBatch(s.batch.id, { approvalRequired: false });
    expect(await offered(listing.id, s.uni.slug)).toEqual({ shelf: true, page: true });
  });

  it("drops a batch on its first day unless late joining is on", async () => {
    const s = await setupCourse();
    const listing = await listBatch(s, s.batch.id);
    await patchBatch(s.batch.id, { startDate: addDays(today, 1), endDate: addDays(today, 60) });
    expect((await listingDetail(listing.id, null))!.live).toMatchObject({ phase: "upcoming", startsInDays: 1 });
    await patchBatch(s.batch.id, { startDate: today });
    expect(await offered(listing.id, s.uni.slug)).toEqual({ shelf: false, page: false });
    expect((await getListing(s.hod, listing.id)).batch?.state).toBe("started");

    await updateListing(s.hod, listing.id, { title: "Data Analytics", description: "", pricePaise: 500_000, lateJoin: true });
    expect((await listingDetail(listing.id, null))!.live).toMatchObject({ phase: "running", startsInDays: 0, lateJoin: true });
    await expect(pay(await learner(), listing.id)).resolves.toMatchObject({ outcome: { status: "enrolled" } });
  });

  it("leaves a cart when it stops being offered", async () => {
    const s = await setupCourse();
    const listing = await listBatch(s, s.batch.id);
    const buyer = await learner();
    await addToCart(buyer, listing.id);
    await patchBatch(s.batch.id, { status: "closed" });
    expect(await cartView(buyer)).toMatchObject({ lines: [], dropped: 1 });
  });
});

describe("the institutes directory", () => {
  it("lists every active institute, sellers first with their counts, and never a suspended one", async () => {
    const tag = uniqueCode();
    const seller = await setupCourse({ name: `Dirtest ${tag} Seller` });
    await addRecording(seller);
    await listBatch(seller, seller.batch.id);
    await listBatch(seller, (await addBatch(seller)).id);
    const quiet = await setupCourse({ name: `Dirtest ${tag} Aardvark Quiet` });
    const suspended = await setupCourse({ name: `Dirtest ${tag} Suspended` });
    await listBatch(suspended, suspended.batch.id);
    await systemDb().update(universities).set({ status: "suspended" }).where(eq(universities.id, suspended.uni.id));

    const found = await marketplaceDirectory({ q: `dirtest ${tag}` });
    // The seller first though "Aardvark" sorts before it by name; the suspended one not at all.
    expect(found.map((i) => [i.slug, i.recorded, i.live, i.listings])).toEqual([
      [seller.uni.slug, 1, 2, 3],
      [quiet.uni.slug, 0, 0, 0],
    ]);
    expect((await marketplaceDirectory({ q: `${tag} seller` })).map((i) => i.slug)).toEqual([seller.uni.slug]);
    expect(await marketplaceDirectory({ q: `no-such-institute-${tag}` })).toEqual([]);
    const everyone = (await marketplaceDirectory()).map((i) => i.slug);
    expect(everyone).toEqual(expect.arrayContaining([seller.uni.slug, quiet.uni.slug]));
    expect(everyone).not.toContain(suspended.uni.slug);
    // Sellers come before everyone with nothing on sale.
    const all = await marketplaceDirectory();
    expect(all.findIndex((i) => i.listings === 0)).toBeGreaterThan(all.findIndex((i) => i.slug === seller.uni.slug));
    expect((await marketplaceInstitutes()).map((i) => i.slug)).not.toContain(quiet.uni.slug);

    // A suspended institute has no page, and what it listed isn't sold.
    expect(await marketplaceInstitute(suspended.uni.slug)).toBeNull();
    expect(await instituteShelves(suspended.uni.slug)).toBeNull();
    expect(await browseLive({ institute: suspended.uni.slug })).toEqual([]);
    expect(await marketplaceInstitute("Not A Slug!")).toBeNull();
  });
});

describe("an institute's page", () => {
  it("puts recordings, live batches and upcoming batches under the right tabs", async () => {
    const s = await setupCourse();
    const recording = await addRecording(s);
    const far = await listBatch(s, s.batch.id); // starts in 2030
    const nearBatch = await addBatch(s, { name: "Next week", startDate: addDays(today, 5) });
    const near = await listBatch(s, nearBatch.id);
    const runningBatch = await addBatch(s, { name: "Under way", startDate: addDays(today, -10) });
    const running = await listBatch(s, runningBatch.id, { lateJoin: true });
    const closedDoor = await addBatch(s, { name: "Under way, door shut", startDate: addDays(today, -10) });
    await listBatch(s, closedDoor.id, { lateJoin: false });
    const paused = await listBatch(s, (await addBatch(s, { name: "Paused" })).id);
    await setListingStatus(s.hod, paused.id, "paused");

    const page = (await instituteShelves(s.uni.slug))!;
    expect(page.institute).toMatchObject({ name: s.uni.name, slug: s.uni.slug });
    expect(page.recorded.map((i) => i.id)).toEqual([recording.id]);
    // Upcoming: the soonest first, with how far off it is.
    expect(page.upcoming.map((i) => [i.id, i.live.startsInDays])).toEqual([
      [near.id, 5],
      [far.id, expect.any(Number)],
    ]);
    // Live batches: the upcoming ones and the running one that still takes buyers. Not the one that started with its door shut, not the paused one.
    expect(page.live.map((i) => i.id)).toEqual([near.id, far.id, running.id]);
    expect(page.live.find((i) => i.id === running.id)!.live.phase).toBe("running");
    // Another institute's page shows nothing of this one's.
    const other = await setupCourse();
    expect(await instituteShelves(other.uni.slug)).toMatchObject({ recorded: [], live: [], upcoming: [] });
    expect(await instituteShelves("no-such-institute")).toBeNull();
  });
});

describe("tenant isolation", () => {
  it("mkt_seat_sales is isolated", () =>
    expectTenantIsolated(mktSeatSales, async (uni) => {
      const dept = await makeDepartment(uni.id, uniqueCode(), "Computer Science");
      const fac = await person("Faculty Farah", "permanent_faculty", { universityId: uni.id, departmentId: dept.id });
      const { createCourse } = await import("@/server/services/courses");
      const sys = await (await person("Hod Hema", "hod", { universityId: uni.id, departmentId: dept.id })).actor();
      const course = await createCourse(sys, { departmentId: dept.id, title: "Isolated course", pricePaise: 0 });
      const batch = await createBatch(sys, {
        courseId: course.id,
        name: "Isolated batch",
        startDate: addDays(today, 10),
        endDate: addDays(today, 40),
        seatLimit: 5,
        slots: slots(WEEKDAYS, "09:00", "10:00"),
        faculty: [{ userId: fac.user.id, role: "permanent_faculty" }],
      });
      const [listing] = await systemDb()
        .insert(mktListings)
        .values({ universityId: uni.id, courseId: course.id, batchId: batch.id, kind: "batch", title: "Isolated listing", pricePaise: 100_000 })
        .returning();
      const buyer = await person("Buyer", "individual_learner", { universityId: uni.id });
      const [order] = await systemDb()
        .insert(orders)
        .values({ universityId: uni.id, userId: buyer.user.id, courseId: course.id, batchId: batch.id, basePaise: 100_000, gstPaise: 18_000, totalPaise: 118_000 })
        .returning();
      return { universityId: uni.id, listingId: listing.id, orderId: order.id };
    }));
});
