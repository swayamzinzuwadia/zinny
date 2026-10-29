/**
 * Daily housekeeping for each university (runs as its system actor, under row-level security):
 *  - forget rate-limit records older than a week;
 *  - delete uploaded images that nothing uses any more (replaced logos, abandoned uploads),
 *    once they are a day old.
 */
import { and, inArray, lt } from "drizzle-orm";
import type { Job } from "@/contracts/module";
import { audit, storage, withTenant } from "@/server/core";
import {
  siteFacultyProfiles,
  siteGallery,
  siteMedia,
  sitePages,
  sitePosts,
  siteProfiles,
  siteSubmissions,
  siteTeam,
  siteTestimonials,
} from "./schema";
import { normaliseSections, sectionMediaIds } from "./sections";

const DAY = 86_400_000;

export const housekeeping: Job = {
  id: "website-builder.housekeeping",
  every: "day",
  async run(actor) {
    const now = Date.now();
    const removedKeys = await withTenant(actor, async (tx) => {
      await tx.delete(siteSubmissions).where(lt(siteSubmissions.createdAt, new Date(now - 7 * DAY)));

      const used = new Set<string>();
      const add = (id: string | null | undefined) => id && used.add(id);
      for (const p of await tx.select({ logo: siteProfiles.logoMediaId, cover: siteProfiles.coverMediaId }).from(siteProfiles)) {
        add(p.logo);
        add(p.cover);
      }
      for (const p of await tx.select({ draft: sitePages.draft, published: sitePages.published }).from(sitePages)) {
        sectionMediaIds(normaliseSections(p.draft)).forEach(add);
        if (p.published) sectionMediaIds(normaliseSections(p.published)).forEach(add);
      }
      for (const r of await tx.select({ id: siteTestimonials.photoMediaId }).from(siteTestimonials)) add(r.id);
      for (const r of await tx.select({ id: siteTeam.photoMediaId }).from(siteTeam)) add(r.id);
      for (const r of await tx.select({ id: siteGallery.mediaId }).from(siteGallery)) add(r.id);
      for (const r of await tx.select({ id: sitePosts.coverMediaId }).from(sitePosts)) add(r.id);
      for (const r of await tx.select({ draft: siteFacultyProfiles.draft, published: siteFacultyProfiles.published }).from(siteFacultyProfiles)) {
        add(r.draft?.photoMediaId);
        add(r.published?.photoMediaId);
      }

      const old = await tx.select({ id: siteMedia.id, key: siteMedia.key }).from(siteMedia).where(lt(siteMedia.createdAt, new Date(now - DAY)));
      const unused = old.filter((m) => !used.has(m.id)).slice(0, 500);
      if (unused.length === 0) return [];
      await tx.delete(siteMedia).where(and(inArray(siteMedia.id, unused.map((m) => m.id))));
      await audit(tx, actor, "site.remove_unused_images", "site_media", null, { count: unused.length });
      return unused.map((m) => m.key);
    });
    for (const key of removedKeys) await storage().delete(key).catch(() => {});
  },
};
