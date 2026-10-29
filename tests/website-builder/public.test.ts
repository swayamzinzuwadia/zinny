import { afterAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { universities } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createPost, publishPost, unpublishPost, updatePost } from "@/modules/website-builder/blog";
import { discardDraft, getPage, moveSection, publishPage, setSectionVisible, updateSection } from "@/modules/website-builder/builder";
import { createTestimonial, setItemVisible } from "@/modules/website-builder/content";
import { submitEnquiry } from "@/modules/website-builder/enquiries";
import { approveFacultyProfile, saveFacultyProfile, setFacultyProfileVisible } from "@/modules/website-builder/faculty";
import { uploadImage } from "@/modules/website-builder/media";
import {
  previewHome,
  previewPost,
  publicCourse,
  publicFacultyProfile,
  publicHome,
  publicPost,
  publicPosts,
  siteBySlug,
  sitemapEntries,
} from "@/modules/website-builder/public";
import { moderateReview, submitReview } from "@/modules/website-builder/reviews";
import { createCourse, updateCourse } from "@/server/services/courses";
import { freshIp, png, siteFixture } from "./helpers";

afterAll(closeDb);

const BODY = "<p>Our graduates went to work at banks, start-ups and agencies across India this year, and here is how.</p>";

async function postReady(admin: Parameters<typeof uploadImage>[0], title: string, slug: string) {
  const p = await createPost(admin, { title });
  const cover = await uploadImage(admin, { kind: "post", bytes: await png() });
  await updatePost(admin, p.id, { title, slug, excerpt: "Summary", bodyHtml: BODY, coverMediaId: cover.id });
  return p;
}

describe("website-builder: drafts never appear on the public site", () => {
  it("nothing is public before the first publish; then only the published page, never later draft edits", async () => {
    const { uni, admin } = await siteFixture("Draft Page U");
    expect(await publicHome(uni.id, uni.slug)).toBeNull();
    expect((await siteBySlug(uni.slug))?.live).toBe(false);
    expect(await sitemapEntries(uni.id, uni.slug)).toEqual([]);

    await updateSection(admin, "hero", { heading: "Version one", intro: "" });
    await publishPage(admin);
    const live = await publicHome(uni.id, uni.slug);
    expect(live?.sections.find((s) => s.type === "hero")?.heading).toBe("Version one");

    // Edit, hide and move in the draft: the live page doesn't change.
    await updateSection(admin, "hero", { heading: "Secret version two", intro: "" });
    await setSectionVisible(admin, "courses", false);
    await moveSection(admin, "contact", "up");
    const still = await publicHome(uni.id, uni.slug);
    expect(JSON.stringify(still)).not.toContain("Secret version two");
    expect(still?.sections.some((s) => s.type === "courses")).toBe(true);
    expect(still?.sections.map((s) => s.type)).toEqual(live?.sections.map((s) => s.type));

    // The preview shows the draft to website managers.
    const preview = await previewHome(admin, uni.slug);
    expect(preview.sections.find((s) => s.type === "hero")?.heading).toBe("Secret version two");
    expect(preview.sections.some((s) => s.type === "courses")).toBe(false);
    expect((await getPage(admin)).hasChanges).toBe(true);

    // Discarding brings the draft back to the live page.
    await discardDraft(admin);
    expect((await getPage(admin)).hasChanges).toBe(false);
    expect((await getPage(admin)).draft.find((s) => s.type === "hero")?.heading).toBe("Version one");

    // Publishing replaces the live page.
    await updateSection(admin, "hero", { heading: "Version three", intro: "" });
    await publishPage(admin);
    expect((await publicHome(uni.id, uni.slug))?.sections.find((s) => s.type === "hero")?.heading).toBe("Version three");
  });

  it("draft posts are never public: not listed, not by slug, not in the sitemap; unpublishing takes a post down", async () => {
    const { uni, admin } = await siteFixture("Draft Post U");
    await publishPage(admin);
    const draft = await postReady(admin, "Draft only", "draft-only");
    const live = await postReady(admin, "Live news", "live-news");
    await publishPost(admin, live.id);

    expect(await publicPost(uni.id, uni.slug, "draft-only")).toBeNull();
    expect((await publicPost(uni.id, uni.slug, "live-news"))?.title).toBe("Live news");
    const list = await publicPosts(uni.id, uni.slug, 1);
    expect(list?.posts.map((p) => p.slug)).toEqual(["live-news"]);
    const home = await publicHome(uni.id, uni.slug);
    expect(home?.posts.map((p) => p.slug)).toEqual(["live-news"]);
    const paths = (await sitemapEntries(uni.id, uni.slug)).map((e) => e.path);
    expect(paths).toContain(`/site/${uni.slug}/blog/live-news`);
    expect(paths).not.toContain(`/site/${uni.slug}/blog/draft-only`);

    // The admin can still preview the draft.
    expect((await previewPost(admin, uni.slug, draft.id))?.isDraft).toBe(true);

    await unpublishPost(admin, live.id);
    expect(await publicPost(uni.id, uni.slug, "live-news")).toBeNull();
    expect((await publicPosts(uni.id, uni.slug, 1))?.posts).toEqual([]);
  });

  it("faculty profiles show only once approved, show the approved version while changes wait, and disappear when hidden", async () => {
    const { uni, admin, faculty } = await siteFixture("Draft Profile U");
    await publishPage(admin);
    const bio = "Farah teaches data analytics and has worked as an analyst at a bank for eight years.";
    const saved = await saveFacultyProfile(faculty, faculty.userId, { headline: "Senior Lecturer", bio, subjects: "SQL, Python" }, { submit: true });
    expect((await publicHome(uni.id, uni.slug))?.faculty).toEqual([]);
    expect(await publicFacultyProfile(uni.id, uni.slug, saved.id)).toBeNull();

    await approveFacultyProfile(admin, saved.id);
    const card = await publicFacultyProfile(uni.id, uni.slug, saved.id);
    expect(card?.headline).toBe("Senior Lecturer");
    expect(card?.subjects).toEqual(["SQL", "Python"]);
    expect(card?.courses.map((c) => c.title)).toEqual(["Data Analytics"]);

    // New changes wait for approval; the approved version stays public.
    await saveFacultyProfile(faculty, faculty.userId, { headline: "Unapproved headline", bio, subjects: "SQL" }, { submit: true });
    expect((await publicFacultyProfile(uni.id, uni.slug, saved.id))?.headline).toBe("Senior Lecturer");
    expect(JSON.stringify(await publicHome(uni.id, uni.slug))).not.toContain("Unapproved headline");

    await setFacultyProfileVisible(admin, saved.id, false);
    expect(await publicFacultyProfile(uni.id, uni.slug, saved.id)).toBeNull();
    expect((await publicHome(uni.id, uni.slug))?.faculty).toEqual([]);
  });

  it("reviews are public only once approved, never with the reviewer's email; hidden testimonials stay hidden", async () => {
    const { uni, admin, course } = await siteFixture("Draft Review U");
    await publishPage(admin);
    const a = await submitReview(uni.id, { name: "Asha Rao", email: "asha.secret@example.com", rating: 5, body: "Brilliant teaching and very practical projects.", courseId: course.id }, { ip: freshIp() });
    const b = await submitReview(uni.id, { name: "Spam Bot", email: "spam@example.com", rating: 1, body: "Buy followers cheap now, guaranteed results.", courseId: null }, { ip: freshIp() });
    const c = await submitReview(uni.id, { name: "Waiting Wendy", email: "w@example.com", rating: 4, body: "Good course, would recommend to friends.", courseId: null }, { ip: freshIp() });
    if (a.status !== "saved" || b.status !== "saved" || c.status !== "saved") throw new Error("not saved");
    expect((await publicHome(uni.id, uni.slug))?.reviews.count).toBe(0);

    await moderateReview(admin, a.id, "approve");
    await moderateReview(admin, b.id, "hide");
    const home = await publicHome(uni.id, uni.slug);
    expect(home?.reviews.items.map((r) => r.name)).toEqual(["Asha Rao"]);
    expect(home?.reviews.average).toBe(5);
    const text = JSON.stringify(home);
    expect(text).not.toContain("asha.secret@example.com");
    expect(text).not.toContain("Spam Bot");
    expect(text).not.toContain("Waiting Wendy");
    expect((await publicCourse(uni.id, uni.slug, course.id))?.reviews.map((r) => r.name)).toEqual(["Asha Rao"]);

    // Approved, then hidden again: gone.
    await moderateReview(admin, a.id, "hide");
    expect((await publicHome(uni.id, uni.slug))?.reviews.count).toBe(0);

    const t = await createTestimonial(admin, { name: "Hidden Hari", quote: "This should not be shown to visitors." });
    await setItemVisible(admin, "testimonials", t.id, false);
    expect(JSON.stringify(await publicHome(uni.id, uni.slug))).not.toContain("Hidden Hari");
  });

  it("enquiries are never part of anything public", async () => {
    const { uni, admin } = await siteFixture("Draft Enquiry U");
    await publishPage(admin);
    await submitEnquiry(uni.id, { name: "Private Priya", email: "private.priya@example.com", message: "Please call me" }, { ip: freshIp() });
    const text = JSON.stringify([await siteBySlug(uni.slug), await publicHome(uni.id, uni.slug), await sitemapEntries(uni.id, uni.slug)]);
    expect(text).not.toContain("Private Priya");
    expect(text).not.toContain("private.priya@example.com");
  });

  it("draft and archived courses have no public page; a suspended university has no site", async () => {
    const { uni, admin, hod, dept, course } = await siteFixture("Course Status U");
    await publishPage(admin);
    expect((await publicCourse(uni.id, uni.slug, course.id))?.title).toBe("Data Analytics");
    const draftCourse = await createCourse(hod, { departmentId: dept.id, title: "Unreleased course", pricePaise: 0 });
    expect(await publicCourse(uni.id, uni.slug, draftCourse.id)).toBeNull();
    expect((await publicHome(uni.id, uni.slug))?.courses.map((c) => c.title)).toEqual(["Data Analytics"]);

    await updateCourse(hod, course.id, { status: "archived" });
    expect(await publicCourse(uni.id, uni.slug, course.id)).toBeNull();
    expect((await publicHome(uni.id, uni.slug))?.courses).toEqual([]);

    await systemDb().update(universities).set({ status: "suspended" }).where(eq(universities.id, uni.id));
    expect(await siteBySlug(uni.slug)).toBeNull();
  });
});
