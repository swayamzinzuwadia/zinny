import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { createPost, publishPost, updatePost } from "@/modules/website-builder/blog";
import { contrast, CREAM, isReadableBrand, normaliseHex, sitePalette, ZINNY_GREEN } from "@/modules/website-builder/branding";
import { discardDraft, getPage, moveSection, publishPage, setSectionVisible, updateSection } from "@/modules/website-builder/builder";
import { createTestimonial, createVideo, listTestimonials, moveItem, updateVideo } from "@/modules/website-builder/content";
import { describeSlots, formatINR } from "@/modules/website-builder/format";
import { uploadImage } from "@/modules/website-builder/media";
import { getProfile, saveProfile } from "@/modules/website-builder/profile";
import { publicCourse, publicHome, siteBySlug } from "@/modules/website-builder/public";
import { defaultSections, normaliseSections, SECTION_TYPES } from "@/modules/website-builder/sections";
import { cleanSlug, cleanUrl, slugify } from "@/modules/website-builder/validate";
import { youtubeId } from "@/modules/website-builder/youtube";
import { png, siteFixture } from "./helpers";

afterAll(closeDb);

describe("website-builder: the home page builder", () => {
  it("starts with every section once, in a sensible order, as an unpublished draft", async () => {
    const { admin } = await siteFixture("Builder Start U");
    const page = await getPage(admin);
    expect(page.draft.map((s) => s.type)).toEqual([...SECTION_TYPES]);
    expect(page.published).toBeNull();
    expect(page.hasChanges).toBe(true);
  });

  it("moves, hides and edits sections in the draft, and every change is audited", async () => {
    const { uni, admin } = await siteFixture("Builder Edit U");
    await moveSection(admin, "contact", "up");
    await moveSection(admin, "hero", "up"); // already first: no change
    await setSectionVisible(admin, "videos", false);
    await updateSection(admin, "about", {
      heading: "Our story",
      intro: "Since 1998",
      body: "We teach.",
      highlights: [
        { value: "1998", label: "Founded" },
        { value: "", label: "" },
      ],
    });
    await updateSection(admin, "courses", { heading: "Courses", intro: "", limit: 6 });
    await updateSection(admin, "gallery", { heading: "Campus", intro: "", limit: 7 }); // not an option: falls back
    const page = await getPage(admin);
    expect(page.draft.map((s) => s.type).slice(-2)).toEqual(["contact", "enquiry"]);
    expect(page.draft[0].type).toBe("hero");
    expect(page.draft.find((s) => s.type === "videos")?.visible).toBe(false);
    expect(page.draft.find((s) => s.type === "about")).toMatchObject({ heading: "Our story", body: "We teach.", highlights: [{ value: "1998", label: "Founded" }] });
    expect(page.draft.find((s) => s.type === "courses")?.limit).toBe(6);
    expect(page.draft.find((s) => s.type === "gallery")?.limit).toBe(12);

    await expect(updateSection(admin, "hero", { heading: "  " })).rejects.toThrow(/heading/);
    await expect(updateSection(admin, "nonsense", { heading: "x" })).rejects.toThrow(/doesn't exist/);
    await expect(updateSection(admin, "about", { heading: "x", highlights: [{ value: "1998", label: "" }] })).rejects.toThrow(/figure and a label/);

    const actions = (await systemDb().select().from(auditLog).where(eq(auditLog.universityId, uni.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["site.move_section", "site.hide_section", "site.edit_section"]));
  });

  it("publishing needs at least one visible section; discarding needs something published", async () => {
    const { admin } = await siteFixture("Builder Publish U");
    await expect(discardDraft(admin)).rejects.toThrow(/Nothing is published/);
    for (const t of SECTION_TYPES) await setSectionVisible(admin, t, false);
    await expect(publishPage(admin)).rejects.toThrow(/at least one section/);
    await setSectionVisible(admin, "hero", true);
    const state = await publishPage(admin);
    expect(state.hasChanges).toBe(false);
    expect(state.published?.filter((s) => s.visible).map((s) => s.type)).toEqual(["hero"]);
  });

  it("cleans whatever is stored: unknown sections dropped, duplicates removed, missing ones added hidden", () => {
    const [hero, about] = defaultSections();
    const out = normaliseSections([{ ...about, heading: "x".repeat(500) }, { type: "bogus" }, hero, hero, null, "junk"]);
    expect(out.map((s) => s.type).slice(0, 2)).toEqual(["about", "hero"]);
    expect(out).toHaveLength(SECTION_TYPES.length);
    expect(out[0].heading).toHaveLength(120);
    expect(out.slice(2).every((s) => !s.visible)).toBe(true);
    expect(normaliseSections(undefined)).toHaveLength(SECTION_TYPES.length);
  });

  it("the courses section fills itself from published courses with their next batch and seats", async () => {
    const { uni, admin, course, student } = await siteFixture("Builder Courses U");
    await publishPage(admin);
    const { holdSeat } = await import("@/server/services/enrolment");
    const { batches } = await import("@/db/schema");
    const [b] = await systemDb().select().from(batches).where(eq(batches.courseId, course.id));
    await holdSeat(await student("Seat Taker"), { batchId: b.id });
    const home = await publicHome(uni.id, uni.slug);
    expect(home?.courses).toEqual([
      expect.objectContaining({ id: course.id, title: "Data Analytics", openBatches: 1, seatsLeft: 19, nextBatch: expect.objectContaining({ name: "Weekday morning", startDate: "2030-11-04", started: false }) }),
    ]);
    expect(home?.hero.nextBatch).toMatchObject({ courseId: course.id, startDate: "2030-11-04" });
    const page = await publicCourse(uni.id, uni.slug, course.id);
    expect(page?.batches).toEqual([
      expect.objectContaining({ name: "Weekday morning", timings: "Mon to Fri, 9 am to 11 am", seatsLeft: 19, seatLimit: 20, faculty: [{ name: "Faculty Farah", profileId: null }] }),
    ]);
    expect(page?.enrolHref).toBe(`/${uni.slug}/learn/courses/${course.id}`);
  });
});

describe("website-builder: the institute profile", () => {
  it("saves contact details, social links and images, and the site uses them", async () => {
    const { uni, admin } = await siteFixture("Profile U");
    expect((await getProfile(admin)).profile.tagline).toBe("");
    const logo = await uploadImage(admin, { kind: "logo", bytes: await png() });
    await saveProfile(admin, {
      tagline: "Practical courses since 1998",
      about: "We teach.",
      foundedYear: "1998",
      address: "Plot 14\nVashi",
      city: "Navi Mumbai",
      phone: "+91 22 4000 1234",
      email: "Admissions@Example.edu",
      social: { instagram: "instagram.com/demo", website: "" },
      primaryColor: "#17365D",
      logoMediaId: logo.id,
    });
    const site = await siteBySlug(uni.slug);
    expect(site).toMatchObject({
      tagline: "Practical courses since 1998",
      foundedYear: 1998,
      email: "admissions@example.edu",
      social: { instagram: "https://instagram.com/demo" },
      logo: { id: logo.id, src: `/site/${uni.slug}/media/${logo.id}` },
    });
    expect(site?.palette.primary).toBe("#17365d");
    // Leaving the images out keeps them; an empty value removes one.
    await saveProfile(admin, { tagline: "Still here" });
    expect((await siteBySlug(uni.slug))?.logo?.id).toBe(logo.id);
    await saveProfile(admin, { logoMediaId: "" });
    expect((await siteBySlug(uni.slug))?.logo).toBeNull();
  });

  it("refuses bad input with a message that says how to fix it", async () => {
    const { admin } = await siteFixture("Profile Bad U");
    await expect(saveProfile(admin, { primaryColor: "#f7eccb" })).rejects.toThrow(/too light.*darker shade, like #/);
    await expect(saveProfile(admin, { primaryColor: "blue" })).rejects.toThrow(/hex code/);
    await expect(saveProfile(admin, { foundedYear: "98" })).rejects.toThrow(/four digits/);
    await expect(saveProfile(admin, { email: "nope" })).rejects.toThrow(/email/);
    await expect(saveProfile(admin, { mapUrl: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await expect(saveProfile(admin, { social: { x: "not a link" } })).rejects.toThrow(/valid link/);
  });

  it("colours: the university's colour within Zinny's palette rules", () => {
    expect(normaliseHex("#ABC")).toBe("#aabbcc");
    expect(normaliseHex("red")).toBeNull();
    expect(isReadableBrand(ZINNY_GREEN)).toBe(true);
    expect(isReadableBrand("#d4a72a")).toBe(false);
    // Nothing set: Zinny green. A too-light branding colour is darkened until it reads on cream.
    expect(sitePalette(null, null).primary).toBe(ZINNY_GREEN);
    const p = sitePalette(null, "#f0c419");
    expect(contrast(p.primary, CREAM)).toBeGreaterThanOrEqual(4.5);
    expect(sitePalette("#17365d", "#0b5e4c").primary).toBe("#17365d");
  });
});

describe("website-builder: lists, videos and posts", () => {
  it("testimonials keep the order the admin sets", async () => {
    const { admin } = await siteFixture("Order U");
    const a = await createTestimonial(admin, { name: "First", quote: "First quote here." });
    const b = await createTestimonial(admin, { name: "Second", quote: "Second quote here." });
    const c = await createTestimonial(admin, { name: "Third", quote: "Third quote here." });
    await moveItem(admin, "testimonials", c.id, "up");
    await moveItem(admin, "testimonials", a.id, "up"); // already first
    expect((await listTestimonials(admin)).map((t) => t.id)).toEqual([a.id, c.id, b.id]);
  });

  it("videos accept any YouTube link and nothing else", async () => {
    const { admin } = await siteFixture("Video U");
    for (const url of [
      "https://www.youtube.com/watch?v=aircAruvnKk&t=30s",
      "youtu.be/aircAruvnKk",
      "https://m.youtube.com/watch?v=aircAruvnKk",
      "https://www.youtube.com/shorts/aircAruvnKk",
      "https://www.youtube.com/embed/aircAruvnKk",
      "https://www.youtube-nocookie.com/embed/aircAruvnKk",
      "aircAruvnKk",
    ]) {
      expect(youtubeId(url), url).toBe("aircAruvnKk");
    }
    for (const url of ["https://vimeo.com/123", "https://evil.example/watch?v=aircAruvnKk", "https://youtube.com/watch?v=short", ""]) expect(youtubeId(url), url).toBeNull();
    const v = await createVideo(admin, { title: "Tour", url: "https://youtu.be/aircAruvnKk" });
    await expect(updateVideo(admin, v.id, { title: "Tour", url: "https://vimeo.com/1" })).rejects.toThrow(/YouTube link/);
  });

  it("posts get a unique web address and need a cover image and some text to publish", async () => {
    const { admin } = await siteFixture("Post U");
    const a = await createPost(admin, { title: "Placements 2026: where we went!" });
    const b = await createPost(admin, { title: "Placements 2026: where we went!" });
    expect(a.slug).toBe("placements-2026-where-we-went");
    expect(b.slug).toBe("placements-2026-where-we-went-2");
    await expect(updatePost(admin, b.id, { title: "B", slug: a.slug })).rejects.toThrow(/at least 3/);
    await expect(updatePost(admin, b.id, { title: "Bee", slug: a.slug })).rejects.toThrow(/already uses/);
    await expect(publishPost(admin, a.id)).rejects.toThrow(/cover image/);
    const cover = await uploadImage(admin, { kind: "post", bytes: await png() });
    await updatePost(admin, a.id, { title: a.title, slug: a.slug, coverMediaId: cover.id, bodyHtml: "<p>Short.</p>" });
    await expect(publishPost(admin, a.id)).rejects.toThrow(/few sentences/);
    expect(slugify("Ünïcode & Friends — 2026")).toBe("unicode-and-friends-2026");
    expect(() => cleanSlug("page")).toThrow(/reserved/);
    expect(() => cleanSlug("Bad Slug")).toThrow(/lowercase/);
    expect(cleanUrl("example.com/x", "Link")).toBe("https://example.com/x");
  });

  it("formats money and timings the way the rest of Zinny does", () => {
    expect(formatINR(12_000_00)).toBe("₹12,000");
    expect(formatINR(1_234_56)).toBe("₹1,234.56");
    expect(describeSlots([1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00:00", endTime: "11:00:00" })))).toBe("Mon to Fri, 9 am to 11 am");
    expect(describeSlots([{ weekday: 6, startTime: "10:00", endTime: "13:00" }, { weekday: 7, startTime: "10:00", endTime: "13:00" }])).toBe("Sat and Sun, 10 am to 1 pm");
    expect(describeSlots([])).toBe("Timings to be announced");
  });
});
