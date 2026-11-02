import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { orders } from "@/db/schema";
import { signUpMarketplaceLearner } from "@/modules/identity/auth";
import { contentLessons, contentSections } from "@/modules/content-progress/schema";
import { addToCart, cartCount, cartView, checkoutCart, inCart, removeFromCart } from "@/modules/marketplace/cart";
import { createCode, createListing, setListingStatus } from "@/modules/marketplace/listings";
import { mktCartItems } from "@/modules/marketplace/schema";
import { payBundleInTestMode, startBundle } from "@/modules/payments/bundles";
import { person, setupCourse, uniqueCode } from "../fixtures";

afterAll(() => closeDb());

const PW = "a quiet green field";

async function learner() {
  const r = await signUpMarketplaceLearner({
    name: "Cart Learner",
    email: `cart.${uniqueCode("").toLowerCase()}@market.test`,
    password: PW,
    confirm: PW,
    ip: `10.3.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
  if (r.status !== "created") throw new Error("Sign-up was limited.");
  return r.userId;
}

/** An institute selling one course (₹1,000 before GST) and one of its lectures (₹200). */
async function shop(name = "Cart College") {
  const s = await setupCourse({ name });
  const [section] = await systemDb().insert(contentSections).values({ universityId: s.uni.id, courseId: s.course.id, title: "Week 1" }).returning();
  const [lesson] = await systemDb()
    .insert(contentLessons)
    .values({ universityId: s.uni.id, courseId: s.course.id, sectionId: section.id, title: "Intro", kind: "video", content: { source: "youtube", videoId: "abc123", url: "https://youtu.be/abc123" }, ready: true, durationMinutes: 10 })
    .returning();
  const course = await createListing(s.hod, { kind: "course", sourceId: s.course.id, title: "Whole course", description: "", pricePaise: 100_000 });
  const lecture = await createListing(s.hod, { kind: "lecture", sourceId: lesson.id, title: "One lecture", description: "", pricePaise: 20_000 });
  return { ...s, course, lecture };
}

describe("the cart", () => {
  it("adds once, counts, shows GST per course, and removes", async () => {
    const s = await shop();
    const me = await learner();
    expect(await addToCart(me, s.course.id)).toEqual({ count: 1 });
    expect(await addToCart(me, s.course.id)).toEqual({ count: 1 });
    await addToCart(me, s.lecture.id);
    expect(await inCart(me, s.lecture.id)).toBe(true);
    const v = await cartView(me);
    expect(v).toMatchObject({ subtotalPaise: 120_000, gstPaise: 21_600, totalPaise: 141_600, dropped: 0 });
    expect(v.lines.map((l) => l.title)).toEqual(["Whole course", "One lecture"]);
    expect(await removeFromCart(me, s.lecture.id)).toEqual({ count: 1 });
  });

  it("keeps out staff, and drops listings that go off sale", async () => {
    const s = await shop();
    const staff = await person("Cart Staff", "permanent_faculty", { universityId: s.uni.id, departmentId: s.dept.id });
    await expect(addToCart(staff.user.id, s.course.id)).rejects.toMatchObject({ status: 403 });
    const me = await learner();
    await addToCart(me, s.course.id);
    await addToCart(me, s.lecture.id);
    await setListingStatus(s.hod, s.lecture.id, "paused");
    const v = await cartView(me);
    expect(v.lines.map((l) => l.id)).toEqual([s.course.id]);
    expect(v.dropped).toBe(1);
    expect(await systemDb().select().from(mktCartItems).where(eq(mktCartItems.userId, me))).toHaveLength(1);
  });

  it("checks out every course as its own order, with the code only where it fits, then empties itself once paid", async () => {
    const s = await shop();
    const other = await shop("Other Cart College");
    const me = await learner();
    await addToCart(me, s.course.id);
    await addToCart(me, other.lecture.id);
    const code = `CART${uniqueCode()}`;
    await createCode(s.admin, { code, kind: "percent", value: 50 });

    const { orderIds, codeApplied } = await checkoutCart(me, code.toLowerCase());
    expect(codeApplied).toBe(1);
    const rows = await Promise.all(orderIds.map(async (id) => (await systemDb().select().from(orders).where(eq(orders.id, id)))[0]));
    expect(rows.map((o) => o.basePaise).sort((a, b) => a - b)).toEqual([20_000, 50_000]);
    expect(new Set(rows.map((o) => o.universityId)).size).toBe(2);

    const { bundleId } = await startBundle(me, orderIds);
    await payBundleInTestMode(me, bundleId);
    expect(await cartCount(me)).toBe(0);
    expect((await cartView(me)).lines).toEqual([]);
    await expect(addToCart(me, s.course.id)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses a code that fits nothing in the cart", async () => {
    const s = await shop();
    const me = await learner();
    await addToCart(me, s.course.id);
    await expect(checkoutCart(me, "NOT-A-CODE")).rejects.toThrow(/doesn't work on anything/);
    await expect(checkoutCart(await learner())).rejects.toThrow(/empty/);
  });
});
