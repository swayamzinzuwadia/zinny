import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { seedDemo } from "@/db/seed";
import { setTestModules } from "@/server/registry";
import websiteBuilder from "@/modules/website-builder";
import { listEnquiries } from "@/modules/website-builder/enquiries";
import { listFacultyProfiles } from "@/modules/website-builder/faculty";
import { listPosts } from "@/modules/website-builder/blog";
import { publicHome, publicPosts, siteBySlug, sitemapEntries } from "@/modules/website-builder/public";
import { listReviews } from "@/modules/website-builder/reviews";

afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

describe("website-builder: demo seed", () => {
  it("builds a complete, published site for the Demo University", { timeout: 180_000 }, async () => {
    setTestModules([websiteBuilder], { only: true });
    const quiet = console.log;
    console.log = () => {};
    let ctx;
    try {
      ctx = await seedDemo();
    } finally {
      console.log = quiet;
    }
    const site = await siteBySlug("demo");
    expect(site).toMatchObject({ name: "Demo University", live: true, city: "Navi Mumbai", email: "admissions@demo.edu" });
    expect(site?.logo).not.toBeNull();
    expect(site?.cover).not.toBeNull();
    expect(site?.palette.primary).toBe("#17365d");

    const home = await publicHome(ctx.universityId, "demo");
    expect(home?.sections.map((s) => s.type)).toEqual(["hero", "about", "courses", "faculty", "testimonials", "gallery", "reviews", "videos", "blog", "team", "enquiry", "contact"]);
    expect(home?.courses.map((c) => c.title).sort()).toEqual(["Data Analytics", "Digital Marketing", "Machine Learning Foundations", "Python Basics"]);
    expect(home?.faculty.map((f) => f.name)).toEqual(["Farah Faculty", "Hema Head", "Mehul Head"]);
    expect(home?.testimonials).toHaveLength(4);
    expect(home?.gallery).toHaveLength(6);
    expect(home?.gallery.every((g) => g.caption)).toBe(true);
    expect(home?.videos).toHaveLength(3);
    expect(home?.team).toHaveLength(5);
    expect(home?.posts).toHaveLength(3);
    expect(home?.reviews.count).toBe(5);
    expect(home?.hero.image).not.toBeNull();
    expect((await publicPosts(ctx.universityId, "demo", 1))?.total).toBe(3);
    expect((await sitemapEntries(ctx.universityId, "demo")).length).toBeGreaterThan(10);

    const asha = await ctx.actorFor("asha@demo.edu");
    expect((await listPosts(asha)).map((p) => p.status).sort()).toEqual(["draft", "published", "published", "published"]);
    expect((await listFacultyProfiles(asha, "pending")).rows.map((r) => r.name)).toEqual(["Neel Faculty"]);
    expect((await listReviews(asha, "pending")).rows).toHaveLength(2);
    expect((await listReviews(asha, "hidden")).rows).toHaveLength(1);
    const enquiries = await listEnquiries(asha, { status: "all" });
    expect(enquiries.counts).toEqual({ new: 3, contacted: 1, closed: 1 });
  });
});
