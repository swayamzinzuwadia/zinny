/**
 * What the public marketplace pages rely on: the "On offer" filter keeps only listings with a
 * deal, and checkout names each line by its marketplace listing, not by the course behind it.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { signUpMarketplaceLearner } from "@/modules/identity/auth";
import { contentLessons, contentSections } from "@/modules/content-progress/schema";
import { addToCart, checkoutCart } from "@/modules/marketplace/cart";
import { createListing, updateListing } from "@/modules/marketplace/listings";
import { browseMarketplace, listingTitlesByBatch } from "@/modules/marketplace/service";
import { bundleView, startBundle } from "@/modules/payments/bundles";
import { setupCourse, uniqueCode } from "../fixtures";

afterAll(() => closeDb());

const PW = "a quiet green field";

async function learner() {
  const r = await signUpMarketplaceLearner({
    name: "Shelf Learner",
    email: `shelf.${uniqueCode("").toLowerCase()}@market.test`,
    password: PW,
    confirm: PW,
    ip: `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
  if (r.status !== "created") throw new Error("Sign-up was limited.");
  return r.userId;
}

/** An institute selling its course (with a deal) and one lecture (without). */
async function shop(name: string) {
  const s = await setupCourse({ name });
  const [section] = await systemDb().insert(contentSections).values({ universityId: s.uni.id, courseId: s.course.id, title: "Week 1" }).returning();
  const [lesson] = await systemDb()
    .insert(contentLessons)
    .values({ universityId: s.uni.id, courseId: s.course.id, sectionId: section.id, title: "Intro", kind: "video", content: { source: "youtube", videoId: "abc123", url: "https://youtu.be/abc123" }, ready: true, durationMinutes: 10 })
    .returning();
  const course = await createListing(s.hod, { kind: "course", sourceId: s.course.id, title: "The full recordings", description: "", pricePaise: 100_000 });
  await updateListing(s.hod, course.id, { title: "The full recordings", description: "", pricePaise: 100_000, compareAtPaise: 150_000 });
  const lecture = await createListing(s.hod, { kind: "lecture", sourceId: lesson.id, title: "One lecture", description: "", pricePaise: 20_000 });
  return { ...s, course, lecture };
}

describe("the On offer filter", () => {
  it("keeps only listings with a deal running, and works with the other filters", async () => {
    const name = `Offerwell ${uniqueCode()}`;
    const s = await shop(name);
    expect((await browseMarketplace({ q: name })).map((i) => i.id).sort()).toEqual([s.course.id, s.lecture.id].sort());
    expect((await browseMarketplace({ q: name, onOffer: true })).map((i) => i.id)).toEqual([s.course.id]);
    expect((await browseMarketplace({ institute: s.uni.slug, onOffer: true, kind: "lecture" })).map((i) => i.id)).toEqual([]);
    expect((await browseMarketplace({ institute: s.uni.slug, onOffer: true })).every((i) => (i.percentOff ?? 0) > 0)).toBe(true);
  });
});

describe("checkout titles", () => {
  it("finds each order's listing title by its batch, where the order itself only knows the course", async () => {
    const s = await shop(`Titlewell ${uniqueCode()}`);
    const me = await learner();
    await addToCart(me, s.course.id);
    const { orderIds } = await checkoutCart(me);
    const { bundleId } = await startBundle(me, orderIds);
    const view = await bundleView(me, bundleId);
    expect(view.items).toHaveLength(1);
    expect(view.items[0].title).toBe("Data Analytics");
    const titles = await listingTitlesByBatch(view.items.map((i) => i.batchId));
    expect(titles.get(view.items[0].batchId)).toBe("The full recordings");
  });

  it("ignores ids that aren't listings, and asks for nothing when given none", async () => {
    expect((await listingTitlesByBatch([])).size).toBe(0);
    expect((await listingTitlesByBatch(["not-an-id", "00000000-0000-0000-0000-000000000000"])).size).toBe(0);
  });
});
