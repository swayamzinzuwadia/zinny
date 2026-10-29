/** Counts for the Website sections hub and the dashboard card. */
import { eq, sql } from "drizzle-orm";
import { withTenant, type Actor } from "@/server/core";
import { assertManage } from "./access";
import { pageRow, pageState } from "./builder";
import {
  siteEnquiries,
  siteFacultyProfiles,
  siteGallery,
  sitePosts,
  siteReviews,
  siteTeam,
  siteTestimonials,
  siteVideos,
} from "./schema";

export type SiteOverview = {
  enquiries: { new: number; contacted: number; mineOpen: number };
  reviews: { pending: number; approved: number };
  profilesPending: number;
  testimonials: { shown: number; total: number };
  team: { shown: number; total: number };
  gallery: { shown: number; total: number };
  videos: { shown: number; total: number };
  posts: { published: number; drafts: number };
  page: { live: boolean; hasChanges: boolean; publishedAt: Date | null };
};

const shownTotal = (t: typeof siteTestimonials | typeof siteTeam | typeof siteGallery | typeof siteVideos) =>
  ({ shown: sql<number>`count(*) filter (where ${t.visible})::int`, total: sql<number>`count(*)::int` });

export async function siteOverview(actor: Actor): Promise<SiteOverview> {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => {
    const [enq] = await tx
      .select({
        new: sql<number>`count(*) filter (where ${siteEnquiries.status} = 'new')::int`,
        contacted: sql<number>`count(*) filter (where ${siteEnquiries.status} = 'contacted')::int`,
        mineOpen: sql<number>`count(*) filter (where ${siteEnquiries.status} <> 'closed' and ${siteEnquiries.assigneeUserId} = ${actor.userId || null})::int`,
      })
      .from(siteEnquiries);
    const [rev] = await tx
      .select({
        pending: sql<number>`count(*) filter (where ${siteReviews.status} = 'pending')::int`,
        approved: sql<number>`count(*) filter (where ${siteReviews.status} = 'approved')::int`,
      })
      .from(siteReviews);
    const [prof] = await tx.select({ n: sql<number>`count(*)::int` }).from(siteFacultyProfiles).where(eq(siteFacultyProfiles.status, "pending"));
    const [testimonials] = await tx.select(shownTotal(siteTestimonials)).from(siteTestimonials);
    const [team] = await tx.select(shownTotal(siteTeam)).from(siteTeam);
    const [gallery] = await tx.select(shownTotal(siteGallery)).from(siteGallery);
    const [videos] = await tx.select(shownTotal(siteVideos)).from(siteVideos);
    const [posts] = await tx
      .select({
        published: sql<number>`count(*) filter (where ${sitePosts.status} = 'published')::int`,
        drafts: sql<number>`count(*) filter (where ${sitePosts.status} = 'draft')::int`,
      })
      .from(sitePosts);
    const page = pageState(await pageRow(tx, universityId));
    return {
      enquiries: enq,
      reviews: rev,
      profilesPending: prof.n,
      testimonials,
      team,
      gallery,
      videos,
      posts,
      page: { live: !!page.published, hasChanges: page.hasChanges, publishedAt: page.publishedAt },
    };
  });
}

/** Just what needs attention, for the tab counts on every Website sections page. */
export async function attentionCounts(actor: Actor): Promise<{ enquiries: number; reviews: number }> {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const [e] = await tx.select({ n: sql<number>`count(*)::int` }).from(siteEnquiries).where(eq(siteEnquiries.status, "new"));
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(siteReviews).where(eq(siteReviews.status, "pending"));
    return { enquiries: e.n, reviews: r.n };
  });
}
