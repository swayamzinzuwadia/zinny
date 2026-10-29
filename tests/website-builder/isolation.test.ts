import { afterAll, describe, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import {
  siteEnquiries,
  siteEnquiryNotes,
  siteFacultyProfiles,
  siteGallery,
  siteMedia,
  sitePages,
  sitePosts,
  siteProfiles,
  siteReviews,
  siteSubmissions,
  siteTeam,
  siteTestimonials,
  siteVideos,
} from "@/modules/website-builder/schema";
import { defaultSections } from "@/modules/website-builder/sections";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeUser, uniqueCode } from "../fixtures";

afterAll(closeDb);

type Uni = { id: string };

async function media(uni: Uni) {
  const [m] = await systemDb()
    .insert(siteMedia)
    .values({ universityId: uni.id, key: `${uni.id}/website-builder/media/${uniqueCode("m")}.webp`, kind: "gallery", contentType: "image/webp", size: 10, width: 10, height: 10 })
    .returning();
  return m;
}

/** CLAUDE.md rule 10: every site_ table keeps each university's rows to itself. */
describe("website-builder: tenant isolation of every table", () => {
  it("site_media", () => expectTenantIsolated(siteMedia, (u) => ({ universityId: u.id, key: `${u.id}/website-builder/media/x.webp`, kind: "logo" as const, contentType: "image/webp", size: 1, width: 1, height: 1 })));
  it("site_profiles", () => expectTenantIsolated(siteProfiles, (u) => ({ universityId: u.id, tagline: "Since 1998" })));
  it("site_pages", () => expectTenantIsolated(sitePages, (u) => ({ universityId: u.id, draft: defaultSections(), published: defaultSections() })));
  it("site_testimonials", () => expectTenantIsolated(siteTestimonials, (u) => ({ universityId: u.id, name: "Priya", quote: "Great teaching." })));
  it("site_team", () => expectTenantIsolated(siteTeam, (u) => ({ universityId: u.id, name: "Anita", title: "Registrar" })));
  it("site_reviews", () => expectTenantIsolated(siteReviews, (u) => ({ universityId: u.id, authorName: "Ravi", authorEmail: "ravi@example.com", rating: 5, body: "Excellent course." })));
  it("site_gallery", () => expectTenantIsolated(siteGallery, async (u) => ({ universityId: u.id, mediaId: (await media(u)).id, caption: "Campus" })));
  it("site_videos", () => expectTenantIsolated(siteVideos, (u) => ({ universityId: u.id, title: "Tour", youtubeId: "aircAruvnKk" })));
  it("site_posts", () => expectTenantIsolated(sitePosts, (u) => ({ universityId: u.id, title: "News", slug: uniqueCode("post").toLowerCase() })));
  it("site_enquiries", () => expectTenantIsolated(siteEnquiries, (u) => ({ universityId: u.id, name: "Karan", email: "karan@example.com" })));
  it("site_enquiry_notes", () =>
    expectTenantIsolated(siteEnquiryNotes, async (u) => {
      const [e] = await systemDb().insert(siteEnquiries).values({ universityId: u.id, name: "Karan", email: "karan@example.com" }).returning();
      return { universityId: u.id, enquiryId: e.id, body: "Called back." };
    }));
  it("site_faculty_profiles", () =>
    expectTenantIsolated(siteFacultyProfiles, async (u) => ({
      universityId: u.id,
      userId: (await makeUser("Faculty Iso")).id,
      draft: { headline: "Lecturer", bio: "Teaches.", subjects: [], photoMediaId: null },
    })));
  it("site_submissions", () => expectTenantIsolated(siteSubmissions, (u) => ({ universityId: u.id, kind: "enquiry" as const, fingerprint: "abc" })));
});
