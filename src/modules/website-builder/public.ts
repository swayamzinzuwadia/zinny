/**
 * What the public site reads. Allowed exception (brief): public pages have no signed-in
 * person, so after resolving the slug they read with withTenant(systemActorFor(universityId)).
 * Row-level security still limits every query to that one university, and these functions
 * only ever return published content: the published home page (never the draft), published
 * posts, approved and visible faculty profiles, approved reviews (without emails), shown
 * testimonials, team, gallery and videos, and published courses with open batches.
 *
 * Results are plain JSON (dates as strings) so pages can cache them.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batchSlots, batches, courses, departments, enrolments, roleAssignments, universities } from "@/db/schema";
import { peopleLite, systemActorFor, todayFor, withTenant, type Actor } from "@/server/core";
import { universityBySlug } from "@/server/context";
import { assertManage } from "./access";
import { pageRow, pageState } from "./builder";
import { sitePalette, type SitePalette } from "./branding";
import { describeSlots } from "./format";
import { mediaPath } from "./media";
import { readingMinutes, textOf } from "./sanitize";
import {
  siteFacultyProfiles,
  siteGallery,
  siteMedia,
  sitePages,
  sitePosts,
  siteProfiles,
  siteReviews,
  siteTeam,
  siteTestimonials,
  siteVideos,
  type SocialLinks,
} from "./schema";
import { normaliseSections, type PageSection, type SectionType } from "./sections";
import { isUuid } from "./validate";

export type MediaRef = { id: string; src: string; width: number; height: number; alt: string };

export type SiteInfo = {
  universityId: string;
  slug: string;
  name: string;
  timezone: string;
  tagline: string;
  about: string;
  foundedYear: number | null;
  address: string;
  city: string;
  mapUrl: string;
  phone: string;
  email: string;
  whatsapp: string;
  social: SocialLinks;
  logo: MediaRef | null;
  cover: MediaRef | null;
  /** Fallback logo from the university's branding (set by the Zinny team). */
  brandingLogoUrl: string | null;
  palette: SitePalette;
  /** The home page has been published at least once. */
  live: boolean;
  /** Anchors for the header, from the published page's visible sections. */
  nav: { href: string; label: string }[];
  /** For sitemaps and "last updated". */
  publishedAt: string | null;
};

const asSystem = <T>(universityId: string, fn: (tx: Tx) => Promise<T>) => withTenant(systemActorFor(universityId), fn);

async function mediaRefs(tx: Tx, slug: string, ids: (string | null | undefined)[]): Promise<Map<string, MediaRef>> {
  const list = [...new Set(ids.filter((id): id is string => !!id && isUuid(id)))];
  if (list.length === 0) return new Map();
  const rows = await tx.select().from(siteMedia).where(inArray(siteMedia.id, list));
  return new Map(rows.map((m) => [m.id, { id: m.id, src: mediaPath(slug, m.id), width: m.width, height: m.height, alt: m.alt }]));
}

const NAV_LABELS: Partial<Record<SectionType, string>> = {
  about: "About",
  courses: "Courses",
  faculty: "Faculty",
  gallery: "Campus",
  blog: "Blog",
  contact: "Contact",
};

/* ───────────────────────────── The site ───────────────────────────── */

/** The university behind a slug, with its public profile; null if there is none (or it isn't active). */
export async function siteBySlug(slug: string): Promise<SiteInfo | null> {
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) return null;
  const u = await universityBySlug(slug);
  if (!u) return null;
  return asSystem(u.id, async (tx) => {
    const [row] = await tx.select({ status: universities.status }).from(universities).where(eq(universities.id, u.id));
    if (!row || row.status !== "active") return null;
    const [profile] = await tx.select().from(siteProfiles).where(eq(siteProfiles.universityId, u.id));
    const [page] = await tx.select().from(sitePages).where(eq(sitePages.universityId, u.id));
    const published = page?.published ? normaliseSections(page.published) : null;
    const media = await mediaRefs(tx, u.slug, [profile?.logoMediaId, profile?.coverMediaId]);
    const nav = (published ?? [])
      .filter((s) => s.visible && NAV_LABELS[s.type])
      .map((s) => ({ href: `/site/${u.slug}#${s.type}`, label: NAV_LABELS[s.type]! }));
    if ((published ?? []).some((s) => s.visible && s.type === "blog")) {
      const i = nav.findIndex((n) => n.label === "Blog");
      if (i >= 0) nav[i] = { href: `/site/${u.slug}/blog`, label: "Blog" };
    }
    return {
      universityId: u.id,
      slug: u.slug,
      name: u.name,
      timezone: u.timezone,
      tagline: profile?.tagline ?? "",
      about: profile?.about ?? "",
      foundedYear: profile?.foundedYear ?? null,
      address: profile?.address ?? "",
      city: profile?.city ?? "",
      mapUrl: profile?.mapUrl ?? "",
      phone: profile?.phone ?? "",
      email: profile?.email ?? "",
      whatsapp: profile?.whatsapp ?? "",
      social: profile?.social ?? {},
      logo: profile?.logoMediaId ? (media.get(profile.logoMediaId) ?? null) : null,
      cover: profile?.coverMediaId ? (media.get(profile.coverMediaId) ?? null) : null,
      brandingLogoUrl: u.branding?.logoUrl && /^https:\/\//.test(u.branding.logoUrl) ? u.branding.logoUrl : null,
      palette: sitePalette(profile?.primaryColor, u.branding?.primaryColor),
      live: !!published,
      nav,
      publishedAt: page?.publishedAt?.toISOString() ?? null,
    };
  });
}

/* ───────────────────────────── Courses ───────────────────────────── */

export type PublicBatch = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timings: string;
  seatLimit: number;
  seatsLeft: number;
  started: boolean;
  faculty: { name: string; profileId: string | null }[];
};

export type PublicCourseCard = {
  id: string;
  title: string;
  description: string;
  departmentName: string;
  pricePaise: number;
  gstRateBp: number;
  openBatches: number;
  seatsLeft: number;
  /** The soonest batch that hasn't started yet, else the one running now. */
  nextBatch: { name: string; startDate: string; started: boolean; timings: string } | null;
};

async function seatsTakenByBatch(tx: Tx, batchIds: string[]): Promise<Map<string, number>> {
  if (batchIds.length === 0) return new Map();
  const rows = await tx
    .select({ batchId: enrolments.batchId, n: sql<number>`count(*)::int` })
    .from(enrolments)
    .where(
      and(
        inArray(enrolments.batchId, batchIds),
        or(eq(enrolments.status, "active"), and(eq(enrolments.status, "held"), gt(enrolments.holdExpiresAt, sql`now()`))),
      ),
    )
    .groupBy(enrolments.batchId);
  return new Map(rows.map((r) => [r.batchId, r.n]));
}

async function openBatchesOf(tx: Tx, courseIds: string[], today: string) {
  if (courseIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(batches)
    .where(and(inArray(batches.courseId, courseIds), eq(batches.status, "open"), gte(batches.endDate, today)))
    .orderBy(asc(batches.startDate), asc(batches.name));
  const ids = rows.map((b) => b.id);
  const slots = ids.length ? await tx.select().from(batchSlots).where(inArray(batchSlots.batchId, ids)) : [];
  const taken = await seatsTakenByBatch(tx, ids);
  return rows.map((b) => {
    const mine = slots.filter((s) => s.batchId === b.id);
    return {
      ...b,
      timings: describeSlots(mine),
      earliest: mine.map((s) => s.startTime).sort()[0] ?? "99:99",
      seatsLeft: Math.max(0, b.seatLimit - (taken.get(b.id) ?? 0)),
      started: b.startDate <= today,
    };
  });
}

/** Published courses as cards, ordered by title. */
async function courseCards(tx: Tx, today: string): Promise<PublicCourseCard[]> {
  const rows = await tx
    .select({ course: courses, departmentName: departments.name })
    .from(courses)
    .innerJoin(departments, eq(departments.id, courses.departmentId))
    .where(eq(courses.status, "published"))
    .orderBy(asc(courses.title));
  const open = await openBatchesOf(tx, rows.map((r) => r.course.id), today);
  return rows.map(({ course, departmentName }) => {
    const mine = open.filter((b) => b.courseId === course.id).sort((a, b) => a.startDate.localeCompare(b.startDate) || a.earliest.localeCompare(b.earliest));
    const withSeats = mine.filter((b) => b.seatsLeft > 0);
    const next = withSeats.find((b) => !b.started) ?? withSeats[0] ?? null;
    return {
      id: course.id,
      title: course.title,
      description: course.description,
      departmentName,
      pricePaise: course.pricePaise,
      gstRateBp: course.gstRateBp,
      openBatches: mine.length,
      seatsLeft: mine.reduce((n, b) => n + b.seatsLeft, 0),
      nextBatch: next ? { name: next.name, startDate: next.startDate, started: next.started, timings: next.timings } : null,
    };
  });
}

/** Faculty on each batch right now, linked to their public profile when it is live. */
async function batchFaculty(tx: Tx, batchIds: string[]) {
  if (batchIds.length === 0) return new Map<string, { name: string; profileId: string | null }[]>();
  const now = new Date();
  const rows = (
    await tx
      .select()
      .from(roleAssignments)
      .where(and(inArray(roleAssignments.batchId, batchIds), isNull(roleAssignments.revokedAt), inArray(roleAssignments.role, ["permanent_faculty", "visiting_faculty"])))
  ).filter((r) => r.startsAt <= now && (!r.endsAt || r.endsAt > now));
  const people = await peopleLite(tx, rows.map((r) => r.userId));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const profiles = await liveProfiles(tx, rows.map((r) => r.userId));
  const out = new Map<string, { name: string; profileId: string | null }[]>();
  for (const r of rows) {
    const list = out.get(r.batchId!) ?? [];
    if (!list.some((f) => f.name === nameOf.get(r.userId))) list.push({ name: nameOf.get(r.userId) ?? "Faculty", profileId: profiles.get(r.userId)?.id ?? null });
    out.set(r.batchId!, list);
  }
  return out;
}

export type PublicCourse = PublicCourseCard & { batches: PublicBatch[]; reviews: PublicReview[]; enrolHref: string };

/**
 * One published course of this university, with its open batches. A course id from
 * another university, a draft or archived course, or a malformed id → null.
 */
export async function publicCourse(universityId: string, slug: string, courseId: string): Promise<PublicCourse | null> {
  if (!isUuid(courseId)) return null;
  return asSystem(universityId, async (tx) => {
    const [row] = await tx
      .select({ course: courses, departmentName: departments.name })
      .from(courses)
      .innerJoin(departments, eq(departments.id, courses.departmentId))
      .where(and(eq(courses.id, courseId), eq(courses.status, "published"), eq(courses.universityId, universityId)));
    if (!row) return null;
    const today = await todayFor(tx);
    const card = (await courseCards(tx, today)).find((c) => c.id === courseId)!;
    const open = await openBatchesOf(tx, [courseId], today);
    const faculty = await batchFaculty(tx, open.map((b) => b.id));
    const reviews = await approvedReviews(tx, { courseId, limit: 6 });
    return {
      ...card,
      batches: open
        .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.earliest.localeCompare(b.earliest) || a.name.localeCompare(b.name))
        .map((b) => ({
          id: b.id,
          name: b.name,
          startDate: b.startDate,
          endDate: b.endDate,
          timings: b.timings,
          seatLimit: b.seatLimit,
          seatsLeft: b.seatsLeft,
          started: b.started,
          faculty: faculty.get(b.id) ?? [],
        })),
      reviews: reviews.items,
      enrolHref: `/${slug}/learn/courses/${courseId}`,
    };
  });
}

/* ───────────────────────────── People ───────────────────────────── */

export type PublicFacultyCard = { id: string; name: string; headline: string; subjects: string[]; photo: MediaRef | null; bio: string };

/** Live faculty profiles (approved and visible) by user id. */
async function liveProfiles(tx: Tx, userIds?: string[]) {
  const rows = await tx
    .select()
    .from(siteFacultyProfiles)
    .where(
      and(
        eq(siteFacultyProfiles.visible, true),
        sql`${siteFacultyProfiles.published} is not null`,
        userIds ? (userIds.length ? inArray(siteFacultyProfiles.userId, userIds) : sql`false`) : undefined,
      ),
    );
  return new Map(rows.map((r) => [r.userId, r]));
}

async function facultyCards(tx: Tx, slug: string): Promise<PublicFacultyCard[]> {
  const profiles = [...(await liveProfiles(tx)).values()];
  const people = await peopleLite(tx, profiles.map((p) => p.userId));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const media = await mediaRefs(tx, slug, profiles.map((p) => p.published!.photoMediaId));
  return profiles
    .filter((p) => nameOf.has(p.userId))
    .map((p) => ({
      id: p.id,
      name: nameOf.get(p.userId)!,
      headline: p.published!.headline,
      subjects: p.published!.subjects,
      bio: p.published!.bio,
      photo: p.published!.photoMediaId ? (media.get(p.published!.photoMediaId) ?? null) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PublicFacultyProfile = PublicFacultyCard & { courses: { id: string; title: string }[] };

export async function publicFacultyProfile(universityId: string, slug: string, profileId: string): Promise<PublicFacultyProfile | null> {
  if (!isUuid(profileId)) return null;
  return asSystem(universityId, async (tx) => {
    const card = (await facultyCards(tx, slug)).find((c) => c.id === profileId);
    if (!card) return null;
    const [p] = await tx.select({ userId: siteFacultyProfiles.userId }).from(siteFacultyProfiles).where(eq(siteFacultyProfiles.id, profileId));
    const now = new Date();
    const batchIds = (
      await tx
        .select()
        .from(roleAssignments)
        .where(and(eq(roleAssignments.userId, p.userId), isNull(roleAssignments.revokedAt), eq(roleAssignments.scopeType, "batch")))
    )
      .filter((r) => r.startsAt <= now && (!r.endsAt || r.endsAt > now))
      .map((r) => r.batchId!);
    const taught = batchIds.length
      ? await tx
          .selectDistinct({ id: courses.id, title: courses.title })
          .from(batches)
          .innerJoin(courses, eq(courses.id, batches.courseId))
          .where(and(inArray(batches.id, batchIds), eq(courses.status, "published")))
          .orderBy(asc(courses.title))
      : [];
    return { ...card, courses: taught };
  });
}

/* ───────────────────────────── Reviews ───────────────────────────── */

export type PublicReview = { id: string; name: string; rating: number; body: string; courseTitle: string | null; date: string };
export type ReviewSummary = { items: PublicReview[]; count: number; average: number | null; distribution: Record<1 | 2 | 3 | 4 | 5, number> };

async function approvedReviews(tx: Tx, opts: { courseId?: string; limit: number }): Promise<ReviewSummary> {
  const where = and(eq(siteReviews.status, "approved"), opts.courseId ? eq(siteReviews.courseId, opts.courseId) : undefined);
  const rows = await tx
    .select({ r: siteReviews, courseTitle: courses.title })
    .from(siteReviews)
    .leftJoin(courses, and(eq(courses.id, siteReviews.courseId), eq(courses.status, "published")))
    .where(where)
    .orderBy(desc(siteReviews.createdAt))
    .limit(opts.limit);
  const dist = await tx.select({ rating: siteReviews.rating, n: sql<number>`count(*)::int` }).from(siteReviews).where(where).groupBy(siteReviews.rating);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
  for (const d of dist) distribution[d.rating as 1 | 2 | 3 | 4 | 5] = d.n;
  const count = dist.reduce((n, d) => n + d.n, 0);
  const average = count ? dist.reduce((n, d) => n + d.rating * d.n, 0) / count : null;
  return {
    // Only what may be public: never the reviewer's email.
    items: rows.map(({ r, courseTitle }) => ({ id: r.id, name: r.authorName, rating: r.rating, body: r.body, courseTitle, date: r.createdAt.toISOString() })),
    count,
    average,
    distribution,
  };
}

/* ───────────────────────────── Blog ───────────────────────────── */

export type PublicPostCard = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover: MediaRef | null;
  authorName: string | null;
  publishedAt: string;
  updatedAt: string;
  minutes: number;
};
export type PublicPost = PublicPostCard & { bodyHtml: string; authorProfileId: string | null; related: PublicPostCard[]; isDraft: boolean };

async function postCards(tx: Tx, slug: string, rows: (typeof sitePosts.$inferSelect)[]): Promise<PublicPostCard[]> {
  const people = await peopleLite(tx, rows.flatMap((r) => (r.authorUserId ? [r.authorUserId] : [])));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const media = await mediaRefs(tx, slug, rows.map((r) => r.coverMediaId));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt || textOf(r.bodyHtml).slice(0, 220),
    cover: r.coverMediaId ? (media.get(r.coverMediaId) ?? null) : null,
    authorName: r.authorUserId ? (nameOf.get(r.authorUserId) ?? null) : null,
    publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    minutes: readingMinutes(r.bodyHtml),
  }));
}

export const POSTS_PER_PAGE = 12;

export async function publicPosts(universityId: string, slug: string, page = 1) {
  return asSystem(universityId, async (tx) => {
    const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(sitePosts).where(eq(sitePosts.status, "published"));
    const pages = Math.max(1, Math.ceil(total / POSTS_PER_PAGE));
    if (!Number.isInteger(page) || page < 1 || page > pages) return null;
    const rows = await tx
      .select()
      .from(sitePosts)
      .where(eq(sitePosts.status, "published"))
      .orderBy(desc(sitePosts.publishedAt), desc(sitePosts.createdAt))
      .limit(POSTS_PER_PAGE)
      .offset((page - 1) * POSTS_PER_PAGE);
    return { posts: await postCards(tx, slug, rows), total, page, pages };
  });
}

async function postWithExtras(tx: Tx, slug: string, post: typeof sitePosts.$inferSelect): Promise<PublicPost> {
  const [card] = await postCards(tx, slug, [post]);
  const profiles = post.authorUserId ? await liveProfiles(tx, [post.authorUserId]) : new Map();
  const relatedRows = await tx
    .select()
    .from(sitePosts)
    .where(and(eq(sitePosts.status, "published"), ne(sitePosts.id, post.id)))
    .orderBy(desc(sitePosts.publishedAt))
    .limit(2);
  return {
    ...card,
    bodyHtml: post.bodyHtml,
    isDraft: post.status !== "published",
    authorProfileId: post.authorUserId ? (profiles.get(post.authorUserId)?.id ?? null) : null,
    related: await postCards(tx, slug, relatedRows),
  };
}

/** A published post by its web address; drafts and unknown slugs → null. */
export async function publicPost(universityId: string, slug: string, postSlug: string): Promise<PublicPost | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(postSlug)) return null;
  return asSystem(universityId, async (tx) => {
    const [post] = await tx.select().from(sitePosts).where(and(eq(sitePosts.slug, postSlug), eq(sitePosts.status, "published")));
    return post ? postWithExtras(tx, slug, post) : null;
  });
}

/* ───────────────────────────── Home page ───────────────────────────── */

export type HomeData = {
  sections: PageSection[];
  hero: { image: MediaRef | null; nextBatch: { courseId: string; courseTitle: string; batchName: string; startDate: string } | null };
  courses: PublicCourseCard[];
  faculty: PublicFacultyCard[];
  testimonials: { id: string; name: string; byline: string; quote: string; photo: MediaRef | null }[];
  reviews: ReviewSummary;
  gallery: { id: string; caption: string; image: MediaRef }[];
  videos: { id: string; title: string; youtubeId: string; description: string }[];
  posts: PublicPostCard[];
  team: { id: string; name: string; title: string; bio: string; linkedinUrl: string; photo: MediaRef | null }[];
  /** For the course pickers on the enquiry and review forms. */
  courseOptions: { id: string; title: string }[];
};

/** Everything the given sections need. Only visible sections are filled. */
async function homeData(tx: Tx, slug: string, sections: PageSection[], cover: string | null): Promise<HomeData> {
  const visible = sections.filter((s) => s.visible);
  const want = (t: SectionType) => visible.find((s) => s.type === t);
  const today = await todayFor(tx);
  const cards = await courseCards(tx, today);
  const data: HomeData = {
    sections: visible,
    hero: { image: null, nextBatch: null },
    courses: [],
    faculty: [],
    testimonials: [],
    reviews: { items: [], count: 0, average: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } },
    gallery: [],
    videos: [],
    posts: [],
    team: [],
    courseOptions: cards.map((c) => ({ id: c.id, title: c.title })),
  };
  const hero = want("hero");
  if (hero) {
    const media = await mediaRefs(tx, slug, [hero.imageMediaId, cover]);
    data.hero.image = media.get(hero.imageMediaId ?? "") ?? media.get(cover ?? "") ?? null;
    if (hero.showNextBatch) {
      const upcoming = cards
        .filter((c) => c.nextBatch && !c.nextBatch.started)
        .sort((a, b) => a.nextBatch!.startDate.localeCompare(b.nextBatch!.startDate))[0];
      if (upcoming) data.hero.nextBatch = { courseId: upcoming.id, courseTitle: upcoming.title, batchName: upcoming.nextBatch!.name, startDate: upcoming.nextBatch!.startDate };
    }
  }
  const courseSection = want("courses");
  if (courseSection) data.courses = courseSection.limit ? cards.slice(0, courseSection.limit) : cards;
  if (want("faculty")) data.faculty = await facultyCards(tx, slug);
  if (want("testimonials")) {
    const rows = await tx.select().from(siteTestimonials).where(eq(siteTestimonials.visible, true)).orderBy(asc(siteTestimonials.position), asc(siteTestimonials.createdAt));
    const media = await mediaRefs(tx, slug, rows.map((r) => r.photoMediaId));
    data.testimonials = rows.map((r) => ({ id: r.id, name: r.name, byline: r.byline, quote: r.quote, photo: r.photoMediaId ? (media.get(r.photoMediaId) ?? null) : null }));
  }
  if (want("reviews")) data.reviews = await approvedReviews(tx, { limit: 6 });
  const gallerySection = want("gallery");
  if (gallerySection) {
    const rows = await tx
      .select({ item: siteGallery })
      .from(siteGallery)
      .where(eq(siteGallery.visible, true))
      .orderBy(asc(siteGallery.position), asc(siteGallery.createdAt))
      .limit(gallerySection.limit ?? 12);
    const media = await mediaRefs(tx, slug, rows.map((r) => r.item.mediaId));
    data.gallery = rows.flatMap(({ item }) => {
      const image = media.get(item.mediaId);
      return image ? [{ id: item.id, caption: item.caption, image: { ...image, alt: item.caption || image.alt } }] : [];
    });
  }
  if (want("videos")) {
    const rows = await tx.select().from(siteVideos).where(eq(siteVideos.visible, true)).orderBy(asc(siteVideos.position), asc(siteVideos.createdAt));
    data.videos = rows.map((r) => ({ id: r.id, title: r.title, youtubeId: r.youtubeId, description: r.description }));
  }
  const blogSection = want("blog");
  if (blogSection) {
    const rows = await tx.select().from(sitePosts).where(eq(sitePosts.status, "published")).orderBy(desc(sitePosts.publishedAt)).limit(blogSection.limit ?? 3);
    data.posts = await postCards(tx, slug, rows);
  }
  if (want("team")) {
    const rows = await tx.select().from(siteTeam).where(eq(siteTeam.visible, true)).orderBy(asc(siteTeam.position), asc(siteTeam.createdAt));
    const media = await mediaRefs(tx, slug, rows.map((r) => r.photoMediaId));
    data.team = rows.map((r) => ({ id: r.id, name: r.name, title: r.title, bio: r.bio, linkedinUrl: r.linkedinUrl, photo: r.photoMediaId ? (media.get(r.photoMediaId) ?? null) : null }));
  }
  return data;
}

/** The live home page: the published sections only. Null when nothing is published yet. */
export async function publicHome(universityId: string, slug: string): Promise<HomeData | null> {
  return asSystem(universityId, async (tx) => {
    const [page] = await tx.select().from(sitePages).where(eq(sitePages.universityId, universityId));
    if (!page?.published) return null;
    const [profile] = await tx.select({ cover: siteProfiles.coverMediaId }).from(siteProfiles).where(eq(siteProfiles.universityId, universityId));
    return homeData(tx, slug, normaliseSections(page.published), profile?.cover ?? null);
  });
}

/** The draft home page, for the preview. Needs `website.manage`. */
export async function previewHome(actor: Actor, slug: string): Promise<HomeData> {
  const universityId = assertManage(actor);
  return withTenant(actor, async (tx) => {
    const page = pageState(await pageRow(tx, universityId));
    const [profile] = await tx.select({ cover: siteProfiles.coverMediaId }).from(siteProfiles).where(eq(siteProfiles.universityId, universityId));
    return homeData(tx, slug, page.draft, profile?.cover ?? null);
  });
}

/** Any post (draft or published), as it would look, for the preview. Needs `website.manage`. */
export async function previewPost(actor: Actor, slug: string, postId: string): Promise<PublicPost | null> {
  assertManage(actor);
  if (!isUuid(postId)) return null;
  return withTenant(actor, async (tx) => {
    const [post] = await tx.select().from(sitePosts).where(eq(sitePosts.id, postId));
    return post ? postWithExtras(tx, slug, post) : null;
  });
}

/* ───────────────────────────── Media and sitemap ───────────────────────────── */

/** An uploaded image of this university, for the media route. */
export async function publicMedia(universityId: string, mediaId: string) {
  if (!isUuid(mediaId)) return null;
  return asSystem(universityId, async (tx) => {
    const [m] = await tx.select({ key: siteMedia.key, contentType: siteMedia.contentType }).from(siteMedia).where(eq(siteMedia.id, mediaId));
    return m ?? null;
  });
}

export type SitemapEntry = { path: string; lastModified: string | null; priority: number };

export async function sitemapEntries(universityId: string, slug: string): Promise<SitemapEntry[]> {
  return asSystem(universityId, async (tx) => {
    const [page] = await tx.select().from(sitePages).where(eq(sitePages.universityId, universityId));
    if (!page?.published) return [];
    const base = `/site/${slug}`;
    const out: SitemapEntry[] = [{ path: base, lastModified: page.publishedAt?.toISOString() ?? null, priority: 1 }];
    const posts = await tx.select({ slug: sitePosts.slug, updatedAt: sitePosts.updatedAt }).from(sitePosts).where(eq(sitePosts.status, "published")).orderBy(desc(sitePosts.publishedAt));
    if (posts.length) {
      out.push({ path: `${base}/blog`, lastModified: posts[0].updatedAt.toISOString(), priority: 0.7 });
      const pages = Math.ceil(posts.length / POSTS_PER_PAGE);
      for (let p = 2; p <= pages; p++) out.push({ path: `${base}/blog/page/${p}`, lastModified: null, priority: 0.3 });
      for (const p of posts) out.push({ path: `${base}/blog/${p.slug}`, lastModified: p.updatedAt.toISOString(), priority: 0.6 });
    }
    const cs = await tx.select({ id: courses.id }).from(courses).where(eq(courses.status, "published")).orderBy(asc(courses.title));
    for (const c of cs) out.push({ path: `${base}/courses/${c.id}`, lastModified: null, priority: 0.8 });
    for (const f of (await liveProfiles(tx)).values()) out.push({ path: `${base}/faculty/${f.id}`, lastModified: f.updatedAt.toISOString(), priority: 0.5 });
    return out;
  });
}
