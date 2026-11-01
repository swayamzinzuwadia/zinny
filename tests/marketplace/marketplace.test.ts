import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { batches, courses, enrolments, orders, universities } from "@/db/schema";
import { homeSpacesFor } from "@/server/auth/session";
import { loadActor, systemActorFor } from "@/server/actor";
import { storage } from "@/server/core";
import { withTenant } from "@/server/tenant";
import { listBatches } from "@/server/services/batches";
import { listCourses } from "@/server/services/courses";
import { batchOptions, browseCatalog, confirmPayment, failPayment, holdSeat } from "@/server/services/enrolment";
import { graduate } from "@/server/services/users";
import { landingAfterSignIn, signUpMarketplaceLearner } from "@/modules/identity/auth";
import { learnerOutline } from "@/modules/content-progress/learn";
import { contentLessons, contentSections } from "@/modules/content-progress/schema";
import { deleteLesson } from "@/modules/content-progress/service";
import { handlers } from "@/modules/marketplace/events";
import { createListing, getListing, listableSources, listListings, setListingStatus, updateListing } from "@/modules/marketplace/listings";
import { mktLearners, mktListings } from "@/modules/marketplace/schema";
import { browseMarketplace, listingDetail, marketplaceAccess, myLibrary, startPurchase } from "@/modules/marketplace/service";
import { payRefunds } from "@/modules/payments/schema";
import { grant, makeDepartment, person, setupCourse, uniqueCode } from "../fixtures";
import { expectTenantIsolated } from "../helpers/isolation";

afterAll(() => closeDb());

const PW = "a quiet green field";
const email = (name: string) => `${name}.${uniqueCode("").toLowerCase()}@market.test`;
const ip = () => `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

async function learner(name = "neha") {
  const r = await signUpMarketplaceLearner({ name: "Neha Kulkarni", email: email(name), password: PW, confirm: PW, ip: ip() });
  if (r.status !== "created") throw new Error("Sign-up was limited.");
  return r.userId;
}

async function addLesson(universityId: string, courseId: string, title: string, over: Partial<typeof contentLessons.$inferInsert> = {}) {
  const [section] = await systemDb().insert(contentSections).values({ universityId, courseId, title: "Week 1" }).returning();
  const [lesson] = await systemDb()
    .insert(contentLessons)
    .values({
      universityId,
      courseId,
      sectionId: section.id,
      title,
      kind: "video",
      content: { source: "youtube", videoId: "abc123", url: "https://youtu.be/abc123" },
      ready: true,
      durationMinutes: 12,
      ...over,
    })
    .returning();
  return lesson;
}

/** An institute selling its one course, with two video lessons and a live class. */
async function shop(opts: { name?: string } = {}) {
  const s = await setupCourse({ pricePaise: 500_000, name: opts.name });
  const intro = await addLesson(s.uni.id, s.course.id, "Introduction");
  const deep = await addLesson(s.uni.id, s.course.id, "Going deeper");
  await addLesson(s.uni.id, s.course.id, "Live revision", { kind: "live", content: {} });
  const listing = await createListing(s.hod, { kind: "course", sourceId: s.course.id, title: "Data Analytics, recorded", description: "All of it.", pricePaise: 100_000 });
  return { ...s, intro, deep, listing };
}

async function buy(userId: string, listingId: string) {
  const { slug, orderId } = await startPurchase(userId, listingId);
  const [order] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
  await confirmPayment(order.universityId, { orderId, gatewayPaymentId: `pay_${orderId.slice(0, 8)}` });
  return { slug, orderId, universityId: order.universityId };
}

describe("signing up on your own", () => {
  it("creates a marketplace learner who belongs to no institute", async () => {
    const r = await signUpMarketplaceLearner({ name: "Isha Kapoor", email: email("isha"), password: PW, confirm: PW, ip: ip() });
    expect(r).toMatchObject({ status: "created", landing: "/marketplace" });
    if (r.status !== "created") return;
    expect(await homeSpacesFor(r.userId)).toEqual([]);
    expect(await landingAfterSignIn(r.userId, null)).toBe("/marketplace");
    expect((await marketplaceAccess(r.userId)).canShop).toBe(true);
  });

  it("never takes over an email that already has an account", async () => {
    const address = email("taken");
    await signUpMarketplaceLearner({ name: "First Person", email: address, password: PW, confirm: PW, ip: ip() });
    await expect(signUpMarketplaceLearner({ name: "Second Person", email: address, password: PW, confirm: PW, ip: ip() })).rejects.toMatchObject({ code: "email_taken" });
  });
});

describe("who may shop", () => {
  it("lets independent learners and alumni in, and keeps current students and staff out", async () => {
    const s = await setupCourse();
    const student = await person("Current Student", "student", { universityId: s.uni.id });
    const alumnus = await person("Past Student", "alumni", { universityId: s.uni.id });
    const staff = await person("Staff Member", "permanent_faculty", { universityId: s.uni.id, departmentId: s.dept.id });
    expect((await marketplaceAccess(await learner())).canShop).toBe(true);
    expect((await marketplaceAccess(alumnus.user.id)).canShop).toBe(true);
    expect((await marketplaceAccess(student.user.id)).canShop).toBe(false);
    expect((await marketplaceAccess(staff.user.id)).canShop).toBe(false);
  });

  it("opens up the moment a student graduates", async () => {
    const s = await setupCourse();
    const student = await person("Graduating Student", "student", { universityId: s.uni.id });
    expect((await marketplaceAccess(student.user.id)).canShop).toBe(false);
    await graduate(s.admin, student.user.id);
    expect((await marketplaceAccess(student.user.id)).canShop).toBe(true);
  });

  it("refuses a purchase from a current student", async () => {
    const { uni, listing } = await shop();
    const student = await person("Keen Student", "student", { universityId: uni.id });
    await expect(startPurchase(student.user.id, listing.id)).rejects.toMatchObject({ status: 403 });
  });

  it("keeps what you bought if you later join an institute", async () => {
    const { listing } = await shop();
    const elsewhere = await setupCourse();
    const buyer = await learner();
    await buy(buyer, listing.id);
    await grant(buyer, "student", { universityId: elsewhere.uni.id });
    expect((await marketplaceAccess(buyer)).canShop).toBe(false);
    expect(await myLibrary(buyer)).toHaveLength(1);
  });
});

describe("institutes listing what they sell", () => {
  it("lets a HOD list their own department's course, and nobody else's", async () => {
    const s = await setupCourse({ pricePaise: 1000 });
    await addLesson(s.uni.id, s.course.id, "Lesson one");
    const other = await makeDepartment(s.uni.id, uniqueCode(), "Commerce");
    const otherHod = await (await person("Other Hod", "hod", { universityId: s.uni.id, departmentId: other.id })).actor();
    const faculty = await loadActor(s.facultyUserId, s.uni.id);
    const input = { kind: "course" as const, sourceId: s.course.id, title: "Recorded", description: "", pricePaise: 50_000 };
    await expect(createListing(otherHod, input)).rejects.toMatchObject({ status: 403 });
    await expect(createListing(faculty, input)).rejects.toMatchObject({ status: 403 });
    await expect(createListing(s.hod, input)).resolves.toMatchObject({ status: "live", kind: "course" });
  });

  it("only sells courses that have a ready video, at a real price", async () => {
    const s = await setupCourse();
    const input = { kind: "course" as const, sourceId: s.course.id, title: "Recorded", description: "", pricePaise: 50_000 };
    await expect(createListing(s.hod, input)).rejects.toThrow(/video lesson/);
    await addLesson(s.uni.id, s.course.id, "Lesson one");
    await expect(createListing(s.hod, { ...input, pricePaise: 0 })).rejects.toThrow(/at least ₹1/);
    await expect(createListing(s.hod, { ...input, title: "x" })).rejects.toThrow(/title/);
  });

  it("won't list the same course or lecture twice", async () => {
    const { hod, course, intro } = await shop();
    await expect(createListing(hod, { kind: "course", sourceId: course.id, title: "Again", description: "", pricePaise: 50_000 })).rejects.toMatchObject({ code: "already_listed" });
    await createListing(hod, { kind: "lecture", sourceId: intro.id, title: "Intro", description: "", pricePaise: 10_000 });
    await expect(createListing(hod, { kind: "lecture", sourceId: intro.id, title: "Intro again", description: "", pricePaise: 10_000 })).rejects.toMatchObject({ code: "already_listed" });
    const sources = await listableSources(hod);
    expect(sources.flatMap((c) => c.lectures).map((l) => l.id)).not.toContain(intro.id);
  });

  it("keeps the recorded batch out of everything the institute's students see", async () => {
    const { hod, course, listing, student, uni } = await shop();
    const s = await student("Institute Student");
    expect((await batchOptions(s, course.id)).options.map((o) => o.batchId)).not.toContain(listing.batchId);
    expect((await listBatches(hod, course.id)).map((b) => b.batchId)).not.toContain(listing.batchId);
    expect((await listCourses(hod)).find((c) => c.id === course.id)?.batchCount).toBe(1);
    const [batch] = await systemDb().select().from(batches).where(eq(batches.id, listing.batchId));
    expect(batch).toMatchObject({ universityId: uni.id, recorded: true, status: "closed" });
  });

  it("counts buyers, and lets the price change for new buyers only", async () => {
    const { hod, listing } = await shop();
    const first = await learner();
    const { orderId } = await buy(first, listing.id);
    await updateListing(hod, listing.id, { title: "Renamed", description: "New", pricePaise: 200_000 });
    expect((await getListing(hod, listing.id)).pricePaise).toBe(200_000);
    expect((await listListings(hod)).find((l) => l.id === listing.id)?.buyers).toBe(1);
    const [order] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
    expect(order.basePaise).toBe(100_000);
  });
});

describe("the catalogue", () => {
  it("shows live listings of active institutes, with GST in the price", async () => {
    const { listing, course } = await shop();
    const item = (await browseMarketplace()).find((i) => i.id === listing.id);
    expect(item).toMatchObject({ pricePaise: 100_000, totalPaise: 118_000, lessons: 2, minutes: 24 });
    expect(item?.courseId).toBe(course.id);
  });

  it("hides paused listings and suspended institutes", async () => {
    const { hod, listing, uni } = await shop();
    await setListingStatus(hod, listing.id, "paused");
    expect((await browseMarketplace()).map((i) => i.id)).not.toContain(listing.id);
    await setListingStatus(hod, listing.id, "live");
    await systemDb().update(universities).set({ status: "suspended" }).where(eq(universities.id, uni.id));
    expect((await browseMarketplace()).map((i) => i.id)).not.toContain(listing.id);
  });

  it("searches titles and institutes, treating % and _ as plain text", async () => {
    const name = `Riverbend ${uniqueCode()}`;
    const { listing } = await shop({ name });
    expect((await browseMarketplace({ q: name })).map((i) => i.id)).toEqual([listing.id]);
    expect((await browseMarketplace({ q: "%%%" })).map((i) => i.id)).not.toContain(listing.id);
    expect((await browseMarketplace({ q: name, kind: "lecture" })).map((i) => i.id)).toEqual([]);
  });

  it("lists lessons by title and never lists a live class", async () => {
    const { listing } = await shop();
    const detail = await listingDetail(listing.id, await learner());
    const titles = detail!.outline.sections.flatMap((s) => s.lessons.map((l) => l.title));
    expect(titles).toEqual(["Introduction", "Going deeper"]);
    expect(JSON.stringify(detail!.outline)).not.toContain("youtu.be");
  });
});

describe("buying", () => {
  it("shows nothing in My library until the payment is confirmed", async () => {
    const { listing } = await shop();
    const buyer = await learner();
    const { orderId } = await startPurchase(buyer, listing.id);
    const [order] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
    expect(order).toMatchObject({ status: "pending", basePaise: 100_000, totalPaise: 118_000 });
    expect(await myLibrary(buyer)).toEqual([]);

    await confirmPayment(order.universityId, { orderId, gatewayPaymentId: "pay_ok" });
    const library = await myLibrary(buyer);
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ title: "Data Analytics, recorded", kind: "course", completed: false });
    expect(library[0].invoiceId).toBeTruthy();
  });

  it("never mistakes fees for a live batch of the same course for a purchase", async () => {
    const { batch, student } = await shop();
    const s = await student("Paying Student");
    const held = await holdSeat(s, { batchId: batch.id });
    if (held.status !== "held") throw new Error("Expected a paid seat.");
    await confirmPayment(s.universityId!, { orderId: held.orderId, gatewayPaymentId: "pay_fees" });
    expect(await myLibrary(s.userId)).toEqual([]);
  });

  it("shows nothing after a failed payment, and lets the person try again", async () => {
    const { listing } = await shop();
    const buyer = await learner();
    const first = await startPurchase(buyer, listing.id);
    const [order] = await systemDb().select().from(orders).where(eq(orders.id, first.orderId));
    await failPayment(order.universityId, first.orderId);
    expect(await myLibrary(buyer)).toEqual([]);
    const second = await startPurchase(buyer, listing.id);
    expect(second.orderId).not.toBe(first.orderId);
  });

  it("resumes the same checkout, and refuses to sell the same thing twice", async () => {
    const { listing } = await shop();
    const buyer = await learner();
    const first = await startPurchase(buyer, listing.id);
    expect((await startPurchase(buyer, listing.id)).orderId).toBe(first.orderId);
    const [order] = await systemDb().select().from(orders).where(eq(orders.id, first.orderId));
    await confirmPayment(order.universityId, { orderId: first.orderId, gatewayPaymentId: "pay_once" });
    await expect(startPurchase(buyer, listing.id)).rejects.toMatchObject({ code: "already_enrolled" });
  });

  it("lets alumni buy from another institute", async () => {
    const { listing } = await shop();
    const home = await setupCourse();
    const alumnus = await person("Past Student", "alumni", { universityId: home.uni.id });
    await buy(alumnus.user.id, listing.id);
    expect(await myLibrary(alumnus.user.id)).toHaveLength(1);
    expect((await homeSpacesFor(alumnus.user.id)).map((s) => s.id)).toEqual([home.uni.id]);
  });

  it("gives a buyer the course and nothing else of the institute", async () => {
    const { listing, uni, batch, hod } = await shop();
    const buyer = await learner();
    await buy(buyer, listing.id);
    const actor = await loadActor(buyer, uni.id);
    await expect(browseCatalog(actor)).rejects.toMatchObject({ status: 403 });
    await expect(holdSeat(actor, { batchId: batch.id })).rejects.toMatchObject({ status: 403 });
    expect(await homeSpacesFor(buyer)).toEqual([]);
    expect(await landingAfterSignIn(buyer, null)).toBe("/marketplace");
    expect((await listListings(hod)).find((l) => l.id === listing.id)?.buyers).toBe(1);
  });

  it("counts only what a buyer can watch toward their progress", async () => {
    const { listing, uni } = await shop();
    const buyer = await learner();
    await buy(buyer, listing.id);
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.userId, buyer));
    const { outline } = await learnerOutline(await loadActor(buyer, uni.id), e.id);
    expect(outline.lessons.map((l) => l.title)).toEqual(["Introduction", "Going deeper"]);
    expect(outline.total).toBe(2);
  });
});

describe("selling a single lecture", () => {
  it("opens that lecture and nothing else of the course", async () => {
    const { hod, intro, uni, course } = await shop();
    const listing = await createListing(hod, { kind: "lecture", sourceId: intro.id, title: "Just the introduction", description: "", pricePaise: 20_000 });
    expect(listing.courseId).not.toBe(course.id);
    const [lectureCourse] = await systemDb().select().from(courses).where(eq(courses.id, listing.courseId));
    expect(lectureCourse).toMatchObject({ status: "archived", certificateEnabled: false, gstRateBp: course.gstRateBp });

    const buyer = await learner();
    await buy(buyer, listing.id);
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.userId, buyer));
    const { outline } = await learnerOutline(await loadActor(buyer, uni.id), e.id);
    expect(outline.lessons.map((l) => l.title)).toEqual(["Introduction"]);
    expect((await myLibrary(buyer))[0]).toMatchObject({ kind: "lecture", title: "Just the introduction" });
  });

  it("only sells ready video lessons", async () => {
    const { hod, uni, course } = await shop();
    const draft = await addLesson(uni.id, course.id, "Not filmed yet", { ready: false });
    await expect(createListing(hod, { kind: "lecture", sourceId: draft.id, title: "Not filmed", description: "", pricePaise: 20_000 })).rejects.toThrow(/video/);
  });

  it("keeps the shared video when the original lesson is deleted", async () => {
    const { hod, uni, course } = await shop();
    const key = `${uni.id}/content-progress/shared-${uniqueCode()}.mp4`;
    await storage().put({ key, body: Buffer.from("video"), contentType: "video/mp4" });
    const lesson = await addLesson(uni.id, course.id, "Filmed lesson", {
      content: { source: "upload", key, fileName: "lesson.mp4", contentType: "video/mp4", size: 5 },
    });
    await createListing(hod, { kind: "lecture", sourceId: lesson.id, title: "Filmed lesson", description: "", pricePaise: 20_000 });
    await deleteLesson(hod, lesson.id);
    expect(await storage().get(key)).not.toBeNull();
  });
});

describe("refunds", () => {
  const refundEvent = (universityId: string, orderId: string) => ({
    id: crypto.randomUUID(),
    universityId,
    type: "payment.refunded",
    payload: { orderId, userId: "", amountPaise: 0 },
    actorUserId: null,
    occurredAt: new Date(),
  });

  async function refund(universityId: string, orderId: string, amountPaise: number) {
    await systemDb().insert(payRefunds).values({ universityId, orderId, amountPaise, reason: "Test", status: "processed", gateway: "mock" });
    const sys = systemActorFor(universityId);
    await withTenant(sys, (tx) => handlers[0].handle({ tx, actor: sys, event: refundEvent(universityId, orderId) } as never));
  }

  it("ends access on a full refund, and not on a partial one", async () => {
    const { listing, uni } = await shop();
    const buyer = await learner();
    const { orderId } = await buy(buyer, listing.id);
    await refund(uni.id, orderId, 18_000);
    expect(await myLibrary(buyer)).toHaveLength(1);

    await refund(uni.id, orderId, 100_000);
    await systemDb().update(orders).set({ status: "refunded" }).where(eq(orders.id, orderId));
    expect(await myLibrary(buyer)).toEqual([]);
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.userId, buyer));
    expect(e.status).toBe("cancelled");
  });
});

describe("tenant isolation", () => {
  it("mkt_listings is isolated", () =>
    expectTenantIsolated(mktListings, async (uni) => {
      const dept = await makeDepartment(uni.id, uniqueCode(), "Commerce");
      const [course] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Course" }).returning();
      const [batch] = await systemDb()
        .insert(batches)
        .values({ universityId: uni.id, courseId: course.id, departmentId: dept.id, name: "Buyers", startDate: "2000-01-01", endDate: "2099-12-31", seatLimit: 1000, recorded: true, status: "closed" })
        .returning();
      return { universityId: uni.id, courseId: course.id, batchId: batch.id, kind: "course" as const, title: "Listing", pricePaise: 1000 };
    }));

  it("keeps mkt_learners away from the app's database role", async () => {
    const s = await setupCourse();
    await expect(withTenant(s.admin, (tx) => tx.select().from(mktLearners))).rejects.toThrow();
    await expect(withTenant(s.admin, (tx) => tx.execute(sql`select 1 from mkt_learners`))).rejects.toThrow();
  });
});
