/**
 * Cached reads for the public site pages. Pages are rendered statically and kept until
 * something on the site changes: every admin change calls `revalidateTag(siteTag(slug))`,
 * which drops the cached data and the pages built from it. Time-based revalidation is the
 * safety net for changes made outside this module (new courses, seats taken).
 */
import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { publicCourse, publicFacultyProfile, publicHome, publicPost, publicPosts, siteBySlug, sitemapEntries } from "./public";

export const siteTag = (slug: string) => `website-builder:site:${slug}`;

/** Seconds. The home page shows seats and next batches, so it refreshes every few minutes. */
export const REVALIDATE = { site: 600, home: 300, course: 60, blog: 3600 } as const;

const opts = (slug: string, revalidate: number) => ({ tags: [siteTag(slug)], revalidate });

export const getSite = cache((slug: string) => unstable_cache(() => siteBySlug(slug), ["website-builder", "site", slug], opts(slug, REVALIDATE.site))());

export const getHome = cache((slug: string, universityId: string) =>
  unstable_cache(() => publicHome(universityId, slug), ["website-builder", "home", universityId, slug], opts(slug, REVALIDATE.home))(),
);

export const getCourse = cache((slug: string, universityId: string, courseId: string) =>
  unstable_cache(() => publicCourse(universityId, slug, courseId), ["website-builder", "course", universityId, slug, courseId], opts(slug, REVALIDATE.course))(),
);

export const getPosts = cache((slug: string, universityId: string, page: number) =>
  unstable_cache(() => publicPosts(universityId, slug, page), ["website-builder", "posts", universityId, slug, String(page)], opts(slug, REVALIDATE.blog))(),
);

export const getPost = cache((slug: string, universityId: string, postSlug: string) =>
  unstable_cache(() => publicPost(universityId, slug, postSlug), ["website-builder", "post", universityId, slug, postSlug], opts(slug, REVALIDATE.blog))(),
);

export const getFacultyProfile = cache((slug: string, universityId: string, profileId: string) =>
  unstable_cache(() => publicFacultyProfile(universityId, slug, profileId), ["website-builder", "faculty", universityId, slug, profileId], opts(slug, REVALIDATE.blog))(),
);

export const getSitemap = (slug: string, universityId: string) =>
  unstable_cache(() => sitemapEntries(universityId, slug), ["website-builder", "sitemap", universityId, slug], opts(slug, REVALIDATE.blog))();
