import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { createPost, publishPost, updatePost } from "@/modules/website-builder/blog";
import { publishPage } from "@/modules/website-builder/builder";
import { createTestimonial, deleteItem, moveItem, setItemVisible } from "@/modules/website-builder/content";
import { getEnquiry, setEnquiryStatus, submitEnquiry } from "@/modules/website-builder/enquiries";
import { approveFacultyProfile, saveFacultyProfile } from "@/modules/website-builder/faculty";
import { uploadImage } from "@/modules/website-builder/media";
import { saveProfile } from "@/modules/website-builder/profile";
import { publicCourse, publicFacultyProfile, publicHome, publicMedia, publicPost, sitemapEntries } from "@/modules/website-builder/public";
import { moderateReview, submitReview } from "@/modules/website-builder/reviews";
import { siteEnquiries, siteReviews } from "@/modules/website-builder/schema";
import { freshIp, png, siteFixture } from "./helpers";

afterAll(closeDb);

/** University B with a published site, a post, a live faculty profile, an image and a review. */
async function universityB() {
  const b = await siteFixture("Other University B");
  await publishPage(b.admin);
  const cover = await uploadImage(b.admin, { kind: "post", bytes: await png() });
  const post = await createPost(b.admin, { title: "B news" });
  await updatePost(b.admin, post.id, {
    title: "B news",
    slug: "b-news",
    excerpt: "",
    bodyHtml: "<p>Only university B's visitors should ever read this announcement about admissions.</p>",
    coverMediaId: cover.id,
  });
  await publishPost(b.admin, post.id);
  const profile = await saveFacultyProfile(
    b.faculty,
    b.faculty.userId,
    { headline: "B faculty", bio: "A faculty member of university B who teaches analytics.", subjects: "SQL" },
    { submit: true },
  );
  await approveFacultyProfile(b.admin, profile.id);
  await createTestimonial(b.admin, { name: "B Student", quote: "University B was a great place to study." });
  const review = await submitReview(b.uni.id, { name: "B Reviewer", email: "b@example.com", rating: 5, body: "University B review that A must never show." }, { ip: freshIp() });
  if (review.status !== "saved") throw new Error("review not saved");
  await moderateReview(b.admin, review.id, "approve");
  return { ...b, coverId: cover.id, profileId: profile.id, reviewId: review.id };
}

describe("website-builder: one university's site never shows another's content", () => {
  it("crafted ids and slugs from university B return nothing on university A's site", async () => {
    const a = await siteFixture("Home University A");
    await publishPage(a.admin);
    const b = await universityB();

    // Course pages: B's real, published course id under A's site.
    expect(await publicCourse(a.uni.id, a.uni.slug, b.course.id)).toBeNull();
    expect((await publicCourse(b.uni.id, b.uni.slug, b.course.id))?.title).toBe("Data Analytics");
    // Malformed ids are just "not found".
    expect(await publicCourse(a.uni.id, a.uni.slug, "not-a-uuid")).toBeNull();
    expect(await publicCourse(a.uni.id, a.uni.slug, "00000000-0000-0000-0000-000000000000")).toBeNull();

    expect(await publicPost(a.uni.id, a.uni.slug, "b-news")).toBeNull();
    expect(await publicFacultyProfile(a.uni.id, a.uni.slug, b.profileId)).toBeNull();
    expect(await publicMedia(a.uni.id, b.coverId)).toBeNull();
    expect(await publicMedia(b.uni.id, b.coverId)).not.toBeNull();

    const home = JSON.stringify(await publicHome(a.uni.id, a.uni.slug));
    for (const leak of [b.course.id, "B news", "B faculty", "B Student", "B Reviewer", b.coverId]) expect(home).not.toContain(leak);
    const sitemap = JSON.stringify(await sitemapEntries(a.uni.id, a.uni.slug));
    expect(sitemap).not.toContain(b.course.id);
    expect(sitemap).not.toContain("b-news");
  });

  it("an enquiry or review naming another university's course is saved without it", async () => {
    const a = await siteFixture("Home University A2");
    const b = await siteFixture("Other University B2");
    const e = await submitEnquiry(a.uni.id, { name: "Crafty Carl", email: "carl@example.com", courseId: b.course.id }, { ip: freshIp() });
    const r = await submitReview(a.uni.id, { name: "Crafty Carl", email: "carl@example.com", rating: 4, body: "Trying to attach another university's course.", courseId: b.course.id }, { ip: freshIp() });
    if (e.status !== "saved" || r.status !== "saved") throw new Error("not saved");
    const [enquiry] = await systemDb().select().from(siteEnquiries).where(eq(siteEnquiries.id, e.id));
    const [review] = await systemDb().select().from(siteReviews).where(eq(siteReviews.id, r.id));
    expect(enquiry.universityId).toBe(a.uni.id);
    expect(enquiry.courseId).toBeNull();
    expect(review.courseId).toBeNull();
    // A's own published course is kept.
    const ok = await submitEnquiry(a.uni.id, { name: "Honest Hina", email: "hina@example.com", courseId: a.course.id }, { ip: freshIp() });
    if (ok.status !== "saved") throw new Error("not saved");
    expect((await systemDb().select().from(siteEnquiries).where(eq(siteEnquiries.id, ok.id)))[0].courseId).toBe(a.course.id);
  });

  it("A's admin can't read or change B's records, or attach B's images", async () => {
    const a = await siteFixture("Admin University A3");
    const b = await universityB();
    const enquiry = await submitEnquiry(b.uni.id, { name: "B Enquirer", email: "be@example.com" }, { ip: freshIp() });
    if (enquiry.status !== "saved") throw new Error("not saved");
    const t = await createTestimonial(b.admin, { name: "B Only", quote: "University B testimonial text here." });

    await expect(getEnquiry(a.admin, enquiry.id)).rejects.toThrow(/not found/i);
    await expect(setEnquiryStatus(a.admin, enquiry.id, "closed")).rejects.toThrow(/not found/i);
    await expect(moderateReview(a.admin, b.reviewId, "hide")).rejects.toThrow(/not found/i);
    await expect(approveFacultyProfile(a.admin, b.profileId)).rejects.toThrow(/not found/i);
    await expect(setItemVisible(a.admin, "testimonials", t.id, false)).rejects.toThrow(/not found/i);
    await expect(moveItem(a.admin, "testimonials", t.id, "up")).rejects.toThrow(/not found/i);
    await expect(deleteItem(a.admin, "testimonials", t.id)).rejects.toThrow(/not found/i);
    await expect(saveProfile(a.admin, { logoMediaId: b.coverId })).rejects.toThrow(/not found/i);
    await expect(createTestimonial(a.admin, { name: "Thief", quote: "Using another university's photo.", photoMediaId: b.coverId })).rejects.toThrow(/not found/i);
    // An admin of A acting on B's university directly is refused by the permission check.
    await expect(saveProfile({ ...a.admin, universityId: b.uni.id }, { tagline: "Hijacked" })).rejects.toThrow(/access/);
  });
});
