import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { batches, courses, enrolments, orders, universities, users } from "@/db/schema";
import { homeSpacesFor } from "@/server/auth/session";
import { loadActor, systemActorFor } from "@/server/actor";
import { storage } from "@/server/core";
import { withTenant } from "@/server/tenant";
import { listBatches } from "@/server/services/batches";
import { listCourses } from "@/server/services/courses";
import { batchOptions, browseCatalog, confirmPayment, failPayment, holdSeat } from "@/server/services/enrolment";
import { graduate } from "@/server/services/users";
import { availableDemoAccounts, landingAfterSignIn, signUpMarketplaceLearner } from "@/modules/identity/auth";
import { learnerOutline } from "@/modules/content-progress/learn";
import { contentLessons, contentSections } from "@/modules/content-progress/schema";
import { deleteLesson } from "@/modules/content-progress/service";
import { handlers } from "@/modules/marketplace/events";
import {
  comboSources,
  courseMarketplace,
  createCode,
  createCombo,
  createListing,
  getListing,
  listableSources,
  listCodes,
  listListings,
  salesSummary,
  setCodeStatus,
  setListingStatus,
  updateListing,
} from "@/modules/marketplace/listings";
import { mktCodes, mktComboCourses, mktLearners, mktListings, mktRedemptions } from "@/modules/marketplace/schema";
import { browseMarketplace, listingDetail, marketplaceAccess, marketplaceInstitute, marketplaceInstitutes, myLibrary, quoteCode, startPurchase } from "@/modules/marketplace/service";
import { todayIn } from "@/server/core";
import { createCourse } from "@/server/services/courses";
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

describe("demo accounts on the sign-in page", () => {
  it("offers only the accounts this database has", async () => {
    await systemDb().insert(users).values({ email: "neha@zinny.demo", name: "Neha Kulkarni" }).onConflictDoNothing();
    expect((await availableDemoAccounts()).map(([, email]) => email)).toEqual(["neha@zinny.demo"]);
  });
});

describe("who may shop", () => {
  it("lets every learner in, current students included, and keeps staff out", async () => {
    const s = await setupCourse();
    const student = await person("Current Student", "student", { universityId: s.uni.id });
    const alumnus = await person("Past Student", "alumni", { universityId: s.uni.id });
    const staff = await person("Staff Member", "permanent_faculty", { universityId: s.uni.id, departmentId: s.dept.id });
    expect((await marketplaceAccess(await learner())).canShop).toBe(true);
    expect((await marketplaceAccess(alumnus.user.id)).canShop).toBe(true);
    expect((await marketplaceAccess(student.user.id)).canShop).toBe(true);
    expect((await marketplaceAccess(staff.user.id)).canShop).toBe(false);
    await expect(startPurchase(staff.user.id, (await shop()).listing.id)).rejects.toMatchObject({ status: 403 });
  });

  it("lets a student buy from another institute without becoming its student", async () => {
    const { listing } = await shop();
    const home = await setupCourse({ name: "Home College" });
    const student = await person("Curious Student", "student", { universityId: home.uni.id });
    await buy(student.user.id, listing.id);
    expect((await myLibrary(student.user.id)).map((i) => i.title)).toEqual(["Data Analytics, recorded"]);
    expect((await homeSpacesFor(student.user.id)).map((s) => s.slug)).toEqual([home.uni.slug]);
  });

  it("lets a student buy recordings from their own institute", async () => {
    const { uni, listing } = await shop();
    const student = await person("Own Student", "student", { universityId: uni.id });
    await buy(student.user.id, listing.id);
    expect(await myLibrary(student.user.id)).toHaveLength(1);
  });

  it("keeps shopping open after a student graduates, and keeps what they bought", async () => {
    const { listing } = await shop();
    const s = await setupCourse();
    const student = await person("Graduating Student", "student", { universityId: s.uni.id });
    await buy(student.user.id, listing.id);
    await graduate(s.admin, student.user.id);
    expect((await marketplaceAccess(student.user.id)).canShop).toBe(true);
    expect(await myLibrary(student.user.id)).toHaveLength(1);
  });

  it("keeps what you bought if you later join an institute", async () => {
    const { listing } = await shop();
    const elsewhere = await setupCourse();
    const buyer = await learner();
    await buy(buyer, listing.id);
    await grant(buyer, "student", { universityId: elsewhere.uni.id });
    expect((await marketplaceAccess(buyer)).canShop).toBe(true);
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

  it("sums sales for the dashboard, only across listings the viewer manages", async () => {
    const { uni, hod, admin, listing, facultyUserId } = await shop();
    await buy(await learner(), listing.id);
    const today = new Date().toISOString().slice(0, 10);
    const expected = { live: 1, paused: 0, buyers: 1, earnedPaise: 100_000, earnedThisMonthPaise: 100_000 };
    expect(await salesSummary(hod, today)).toEqual(expected);
    expect(await salesSummary(admin, today)).toEqual(expected);

    const other = await makeDepartment(uni.id, uniqueCode(), "Commerce");
    const otherHod = await (await person("Other Hod", "hod", { universityId: uni.id, departmentId: other.id })).actor();
    const none = { live: 0, paused: 0, buyers: 0, earnedPaise: 0, earnedThisMonthPaise: 0 };
    expect(await salesSummary(otherHod, today)).toEqual(none);
    expect(await salesSummary(await loadActor(facultyUserId, uni.id), today)).toEqual(none);
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

  it("narrows to one institute by its slug, and shows a listing to someone signed out", async () => {
    const a = await shop();
    const b = await shop();
    expect((await browseMarketplace({ institute: a.uni.slug })).map((i) => i.id)).toEqual([a.listing.id]);
    expect((await browseMarketplace({ institute: a.uni.slug, q: "nothing like this" })).map((i) => i.id)).toEqual([]);
    expect((await browseMarketplace()).map((i) => i.id)).toEqual(expect.arrayContaining([a.listing.id, b.listing.id]));
    expect(await marketplaceInstitute(a.uni.slug)).toEqual({ name: a.uni.name, slug: a.uni.slug });
    expect((await listingDetail(a.listing.id, null))?.ownedEnrolmentId).toBeNull();

    await systemDb().update(universities).set({ status: "suspended" }).where(eq(universities.id, b.uni.id));
    expect(await marketplaceInstitute(b.uni.slug)).toBeNull();
    expect(await browseMarketplace({ institute: b.uni.slug })).toEqual([]);
  });

  it("sorts by price or discount, and lists the institutes with something on sale", async () => {
    const name = `Sortwell ${uniqueCode()}`;
    const { hod, listing } = await shop({ name });
    const second = await createListing(hod, { kind: "lecture", sourceId: (await listableSources(hod))[0].lectures[0].id, title: "Cheap lecture", description: "", pricePaise: 5_000 });
    await updateListing(hod, listing.id, { title: "Dear course", description: "", pricePaise: 100_000, compareAtPaise: 400_000 });
    const mine = async (sort: "new" | "price-low" | "price-high" | "deals") => (await browseMarketplace({ q: name, sort })).map((i) => i.title);
    expect(await mine("price-low")).toEqual(["Cheap lecture", "Dear course"]);
    expect(await mine("price-high")).toEqual(["Dear course", "Cheap lecture"]);
    expect(await mine("deals")).toEqual(["Dear course", "Cheap lecture"]);
    expect(second.id).toBeTruthy();
    expect((await marketplaceInstitutes()).find((i) => i.name === name)?.listings).toBe(2);
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

describe("deals: compare-at prices", () => {
  it("shows the usual price struck through and the share saved, and only accepts a higher usual price", async () => {
    const { hod, listing } = await shop();
    await updateListing(hod, listing.id, { title: "On offer", description: "", pricePaise: 100_000, compareAtPaise: 200_000 });
    const item = (await browseMarketplace()).find((i) => i.id === listing.id);
    // The marketplace shows prices before GST; checkout adds it.
    expect(item).toMatchObject({ pricePaise: 100_000, compareAtPaise: 200_000, totalPaise: 118_000, percentOff: 50 });
    await expect(updateListing(hod, listing.id, { title: "On offer", description: "", pricePaise: 100_000, compareAtPaise: 100_000 })).rejects.toMatchObject({ status: 422 });
    await updateListing(hod, listing.id, { title: "No offer", description: "", pricePaise: 100_000, compareAtPaise: null });
    expect((await browseMarketplace()).find((i) => i.id === listing.id)).toMatchObject({ compareAtPaise: null, percentOff: null });
  });
});

describe("combos", () => {
  /** A second course in the same department, with two recorded lessons and a live class. */
  async function secondCourse(s: Awaited<ReturnType<typeof shop>>) {
    const course = await createCourse(s.hod, { departmentId: s.dept.id, title: "Excel for Analysts", pricePaise: 0 });
    await addLesson(s.uni.id, course.id, "Pivot tables");
    await addLesson(s.uni.id, course.id, "Charts that explain");
    await addLesson(s.uni.id, course.id, "Live doubt clearing", { kind: "live", content: {} });
    return course;
  }

  it("sells several courses as one course, a section for each, without their live classes", async () => {
    const s = await shop();
    const excel = await secondCourse(s);
    const combo = await createCombo(s.hod, {
      courseIds: [s.course.id, excel.id],
      title: "Analyst starter pack",
      description: "",
      pricePaise: 150_000,
      compareAtPaise: 300_000,
    });
    expect(combo.kind).toBe("combo");
    const detail = await listingDetail(combo.id, null);
    expect(detail?.includes).toEqual(["Data Analytics", "Excel for Analysts"]);
    expect(detail?.outline.sections.map((x) => [x.title, x.lessons.map((l) => l.title)])).toEqual([
      ["Data Analytics", ["Introduction", "Going deeper"]],
      ["Excel for Analysts", ["Pivot tables", "Charts that explain"]],
    ]);
    expect((await listListings(s.hod)).find((l) => l.id === combo.id)?.includes).toEqual(["Data Analytics", "Excel for Analysts"]);

    const buyer = await learner();
    await buy(buyer, combo.id);
    expect((await myLibrary(buyer)).map((i) => [i.kind, i.title])).toEqual([["combo", "Analyst starter pack"]]);
  });

  it("needs two courses with recordings, all within the person's own departments", async () => {
    const s = await shop();
    const excel = await secondCourse(s);
    const base = { title: "Pack", description: "", pricePaise: 50_000 };
    await expect(createCombo(s.hod, { ...base, courseIds: [s.course.id] })).rejects.toMatchObject({ status: 422 });
    const empty = await createCourse(s.hod, { departmentId: s.dept.id, title: "Nothing recorded", pricePaise: 0 });
    await expect(createCombo(s.hod, { ...base, courseIds: [s.course.id, empty.id] })).rejects.toMatchObject({ status: 422 });

    const other = await makeDepartment(s.uni.id, uniqueCode(), "Commerce");
    const otherHod = await (await person("Other Hod", "hod", { universityId: s.uni.id, departmentId: other.id })).actor();
    await expect(createCombo(otherHod, { ...base, courseIds: [s.course.id, excel.id] })).rejects.toMatchObject({ status: 403 });
    expect((await comboSources(s.hod)).map((c) => c.title).sort()).toEqual(["Data Analytics", "Excel for Analysts"]);
    expect(await comboSources(otherHod)).toEqual([]);
  });
});

describe("discount codes", () => {
  const today = () => todayIn("Asia/Kolkata");
  const shift = (days: number) => new Date(Date.parse(`${today()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

  it("takes a percentage or an amount off the price before GST, never below ₹1", async () => {
    const { admin, listing } = await shop();
    const code = `SAVE${uniqueCode()}`;
    await createCode(admin, { code: code.toLowerCase(), kind: "percent", value: 20 });
    expect(await quoteCode(listing.id, ` ${code.toLowerCase()} `)).toEqual({ pricePaise: 80_000, savedPaise: 20_000 });

    const buyer = await learner();
    const { orderId } = await startPurchase(buyer, listing.id, code);
    const [order] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
    expect(order.basePaise).toBe(80_000);
    const [used] = await systemDb().select().from(mktRedemptions).where(eq(mktRedemptions.orderId, orderId));
    expect(used.discountPaise).toBe(20_000);

    const huge = `HUGE${uniqueCode()}`;
    await createCode(admin, { code: huge, kind: "amount", value: 500_000 });
    expect((await quoteCode(listing.id, huge)).pricePaise).toBe(100);
  });

  it("refuses codes for another listing, outside their dates, used up or paused", async () => {
    const { admin, hod, listing } = await shop();
    const lecture = await createListing(hod, { kind: "lecture", sourceId: (await listableSources(hod))[0].lectures[0].id, title: "One lecture", description: "", pricePaise: 20_000 });
    const make = async (over: Partial<Parameters<typeof createCode>[1]>) => {
      const code = `C${uniqueCode()}`;
      return createCode(admin, { code, kind: "percent", value: 10, ...over });
    };
    const other = await make({ listingId: lecture.id });
    await expect(quoteCode(listing.id, other.code)).rejects.toThrow(/different course/);
    await expect(quoteCode(lecture.id, other.code)).resolves.toBeTruthy();
    await expect(quoteCode(listing.id, (await make({ endsOn: shift(-1) })).code)).rejects.toThrow(/ended/);
    await expect(quoteCode(listing.id, (await make({ startsOn: shift(1) })).code)).rejects.toThrow(/started/);
    await expect(quoteCode(listing.id, (await make({ startsOn: today(), endsOn: today() })).code)).resolves.toBeTruthy();
    await expect(quoteCode(listing.id, "NOPE-NOT-A-CODE")).rejects.toThrow(/isn't a code/);

    const once = await make({ maxUses: 1 });
    await startPurchase(await learner(), listing.id, once.code);
    await expect(startPurchase(await learner(), listing.id, once.code)).rejects.toThrow(/used up/);
    expect((await listCodes(admin)).find((c) => c.id === once.id)?.uses).toBe(1);

    const paused = await make({});
    await setCodeStatus(admin, paused.id, "paused");
    await expect(quoteCode(listing.id, paused.code)).rejects.toThrow(/isn't a code/);
  });

  it("swaps a checkout started at the full price for one at the code's price", async () => {
    const { admin, listing } = await shop();
    const code = `LATE${uniqueCode()}`;
    await createCode(admin, { code, kind: "percent", value: 50 });
    const buyer = await learner();
    const first = await startPurchase(buyer, listing.id);
    const second = await startPurchase(buyer, listing.id, code);
    expect(second.orderId).not.toBe(first.orderId);
    const [old] = await systemDb().select().from(orders).where(eq(orders.id, first.orderId));
    expect(old.status).toBe("expired");
    expect((await startPurchase(buyer, listing.id, code)).orderId).toBe(second.orderId);
  });

  it("lets a HOD make codes for their own listings only, and an admin for everything", async () => {
    const { uni, hod, admin, listing } = await shop();
    await expect(createCode(hod, { code: `ALL${uniqueCode()}`, kind: "percent", value: 10 })).rejects.toMatchObject({ status: 403 });
    const mine = await createCode(hod, { code: `HOD${uniqueCode()}`, kind: "percent", value: 10, listingId: listing.id });
    const other = await makeDepartment(uni.id, uniqueCode(), "Commerce");
    const otherHod = await (await person("Other Hod", "hod", { universityId: uni.id, departmentId: other.id })).actor();
    await expect(createCode(otherHod, { code: `X${uniqueCode()}`, kind: "percent", value: 10, listingId: listing.id })).rejects.toMatchObject({ status: 403 });
    await expect(setCodeStatus(otherHod, mine.id, "paused")).rejects.toMatchObject({ status: 403 });
    expect((await listCodes(otherHod)).map((c) => c.id)).not.toContain(mine.id);
    expect((await listCodes(admin)).map((c) => c.id)).toContain(mine.id);
    await expect(createCode(admin, { code: mine.code, kind: "percent", value: 5 })).rejects.toMatchObject({ status: 409 });
    await expect(createCode(admin, { code: "x", kind: "percent", value: 5 })).rejects.toMatchObject({ status: 422 });
    await expect(createCode(admin, { code: `BIG${uniqueCode()}`, kind: "percent", value: 95 })).rejects.toMatchObject({ status: 422 });
  });
});

describe("the course editor's Marketplace tab", () => {
  it("shows how a course is sold, to people who can edit it", async () => {
    const s = await shop();
    // A paid seat in one of the course's live batches is a student, not a marketplace buyer.
    const seat = await holdSeat(await s.student("Batch Student"), { batchId: s.batch.id });
    if (seat.status !== "held") throw new Error("Expected a held seat.");
    await confirmPayment(s.uni.id, { orderId: seat.orderId, gatewayPaymentId: `pay_${seat.orderId.slice(0, 8)}` });
    await buy(await learner(), s.listing.id);
    const m = await courseMarketplace(s.hod, s.course.id);
    expect(m.whole?.id).toBe(s.listing.id);
    expect(m.whole?.buyers).toBe(1);
    expect(m.videos).toBe(2);
    expect(m.unlistedLectures.map((l) => l.title)).toEqual(["Introduction", "Going deeper"]);
    await createListing(s.hod, { kind: "lecture", sourceId: s.intro.id, title: "Intro only", description: "", pricePaise: 10_000 });
    const after = await courseMarketplace(s.hod, s.course.id);
    expect(after.lectures.map((l) => l.title)).toEqual(["Intro only"]);
    expect(after.unlistedLectures.map((l) => l.title)).toEqual(["Going deeper"]);
    await expect(courseMarketplace(await loadActor(s.facultyUserId, s.uni.id), s.course.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("tenant isolation", () => {
  /** A listing to hang codes and combo rows on, in its own institute. */
  async function listingIn(uni: { id: string }) {
    const dept = await makeDepartment(uni.id, uniqueCode(), "Commerce");
    const [course] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Course" }).returning();
    const [batch] = await systemDb()
      .insert(batches)
      .values({ universityId: uni.id, courseId: course.id, departmentId: dept.id, name: "Buyers", startDate: "2000-01-01", endDate: "2099-12-31", seatLimit: 1000, recorded: true, status: "closed" })
      .returning();
    const [listing] = await systemDb().insert(mktListings).values({ universityId: uni.id, courseId: course.id, batchId: batch.id, kind: "combo", title: "Listing", pricePaise: 1000 }).returning();
    return { course, batch, listing };
  }

  it("mkt_codes is isolated", () =>
    expectTenantIsolated(mktCodes, async (uni) => ({ universityId: uni.id, code: `C${uniqueCode()}`, kind: "percent" as const, value: 10 })));

  it("mkt_combo_courses is isolated", () =>
    expectTenantIsolated(mktComboCourses, async (uni) => {
      const { course, listing } = await listingIn(uni);
      return { universityId: uni.id, listingId: listing.id, courseId: course.id };
    }));

  it("mkt_redemptions is isolated", () =>
    expectTenantIsolated(mktRedemptions, async (uni) => {
      const { course, batch } = await listingIn(uni);
      const buyer = await person("Buyer", "student", { universityId: uni.id });
      const [code] = await systemDb().insert(mktCodes).values({ universityId: uni.id, code: `R${uniqueCode()}`, kind: "percent", value: 10 }).returning();
      const [order] = await systemDb()
        .insert(orders)
        .values({ universityId: uni.id, userId: buyer.user.id, courseId: course.id, batchId: batch.id, basePaise: 900, gstPaise: 162, totalPaise: 1062 })
        .returning();
      return { universityId: uni.id, codeId: code.id, orderId: order.id, discountPaise: 100 };
    }));

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
