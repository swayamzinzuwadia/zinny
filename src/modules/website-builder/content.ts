/**
 * Website sections that are simple ordered lists: testimonials, team, gallery and videos.
 * Each item can be shown or hidden and moved up or down; shown items appear on the public
 * site straight away (in their section, if that section is on the published page).
 */
import { asc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit, storage, withTenant, type Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { assertManage } from "./access";
import { assertMediaOf } from "./media";
import { siteGallery, siteMedia, siteTeam, siteTestimonials, siteVideos } from "./schema";
import { cleanUrl, isUuid, optionalText, requireText } from "./validate";
import { youtubeId } from "./youtube";

export type Collection = "testimonials" | "team" | "gallery" | "videos";

const TABLES = { testimonials: siteTestimonials, team: siteTeam, gallery: siteGallery, videos: siteVideos } as const;
const ENTITY: Record<Collection, string> = { testimonials: "site_testimonial", team: "site_team", gallery: "site_gallery", videos: "site_video" };
const NOUN: Record<Collection, string> = { testimonials: "Testimonial", team: "Team member", gallery: "Photo", videos: "Video" };

/** The four tables share id, position and created_at; this view of them is enough for ordering. */
const ordered = (c: Collection) => TABLES[c] as unknown as typeof siteTestimonials;

async function nextPosition(tx: Tx, c: Collection) {
  const t = ordered(c);
  const [{ n }] = await tx.select({ n: sql<number>`coalesce(max(${t.position}) + 1, 0)::int` }).from(t);
  return n;
}

async function findIn(tx: Tx, c: Collection, id: string) {
  if (!isUuid(id)) throw new NotFoundError(NOUN[c]);
  const t = ordered(c);
  const [row] = await tx.select({ id: t.id }).from(t).where(eq(t.id, id));
  if (!row) throw new NotFoundError(NOUN[c]);
}

/** Move an item one place up or down; positions are renumbered 0…n-1. */
export async function moveItem(actor: Actor, c: Collection, id: string, direction: "up" | "down") {
  assertManage(actor);
  await withTenant(actor, async (tx) => {
    await findIn(tx, c, id);
    const t = ordered(c);
    const rows = await tx.select({ id: t.id }).from(t).orderBy(asc(t.position), asc(t.createdAt));
    const ids = rows.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
    for (const [pos, rowId] of ids.entries()) await tx.update(t).set({ position: pos }).where(eq(t.id, rowId));
    await audit(tx, actor, `site.move_${c}`, ENTITY[c], id, { direction });
  });
}

export async function setItemVisible(actor: Actor, c: Collection, id: string, visible: boolean) {
  assertManage(actor);
  await withTenant(actor, async (tx) => {
    await findIn(tx, c, id);
    const t = ordered(c);
    await tx.update(t).set({ visible }).where(eq(t.id, id));
    await audit(tx, actor, visible ? `site.show_${c}` : `site.hide_${c}`, ENTITY[c], id, {});
  });
}

export async function deleteItem(actor: Actor, c: Collection, id: string) {
  assertManage(actor);
  const removedKey = await withTenant(actor, async (tx) => {
    await findIn(tx, c, id);
    let key: string | null = null;
    if (c === "gallery") {
      // The photo belongs to the gallery only: remove the file as well.
      const [g] = await tx.select({ mediaId: siteGallery.mediaId, key: siteMedia.key }).from(siteGallery).innerJoin(siteMedia, eq(siteMedia.id, siteGallery.mediaId)).where(eq(siteGallery.id, id));
      await tx.delete(siteGallery).where(eq(siteGallery.id, id));
      if (g) {
        await tx.delete(siteMedia).where(eq(siteMedia.id, g.mediaId));
        key = g.key;
      }
    } else {
      const t = ordered(c);
      await tx.delete(t).where(eq(t.id, id));
    }
    await audit(tx, actor, `site.delete_${c}`, ENTITY[c], id, {});
    return key;
  });
  if (removedKey) await storage().delete(removedKey).catch(() => {});
}

/* ─────────────── Lists for the admin ─────────────── */

export async function listTestimonials(actor: Actor) {
  assertManage(actor);
  return withTenant(actor, (tx) => tx.select().from(siteTestimonials).orderBy(asc(siteTestimonials.position), asc(siteTestimonials.createdAt)));
}

export async function listTeam(actor: Actor) {
  assertManage(actor);
  return withTenant(actor, (tx) => tx.select().from(siteTeam).orderBy(asc(siteTeam.position), asc(siteTeam.createdAt)));
}

export async function listVideos(actor: Actor) {
  assertManage(actor);
  return withTenant(actor, (tx) => tx.select().from(siteVideos).orderBy(asc(siteVideos.position), asc(siteVideos.createdAt)));
}

export async function listGallery(actor: Actor) {
  assertManage(actor);
  return withTenant(actor, (tx) =>
    tx
      .select({ item: siteGallery, media: { id: siteMedia.id, width: siteMedia.width, height: siteMedia.height } })
      .from(siteGallery)
      .innerJoin(siteMedia, eq(siteMedia.id, siteGallery.mediaId))
      .orderBy(asc(siteGallery.position), asc(siteGallery.createdAt)),
  );
}

/* ─────────────── Testimonials ─────────────── */

export type TestimonialInput = { name?: string; byline?: string; quote?: string; photoMediaId?: string | null; visible?: boolean };

function cleanTestimonial(input: TestimonialInput) {
  return {
    name: requireText(input.name, "The name", { min: 2, max: 80 }),
    byline: optionalText(input.byline, "The course or role", 120),
    quote: requireText(input.quote, "The quote", { min: 10, max: 600 }),
  };
}

export async function createTestimonial(actor: Actor, input: TestimonialInput) {
  const universityId = assertManage(actor);
  const values = cleanTestimonial(input);
  return withTenant(actor, async (tx) => {
    await assertMediaOf(tx, input.photoMediaId || null);
    const [row] = await tx
      .insert(siteTestimonials)
      .values({ universityId, ...values, photoMediaId: input.photoMediaId || null, visible: input.visible ?? true, position: await nextPosition(tx, "testimonials") })
      .returning();
    await audit(tx, actor, "site.create_testimonials", ENTITY.testimonials, row.id, { name: row.name });
    return row;
  });
}

export async function updateTestimonial(actor: Actor, id: string, input: TestimonialInput) {
  assertManage(actor);
  const values = cleanTestimonial(input);
  return withTenant(actor, async (tx) => {
    await findIn(tx, "testimonials", id);
    const photo = input.photoMediaId === undefined ? {} : { photoMediaId: input.photoMediaId || null };
    if (input.photoMediaId) await assertMediaOf(tx, input.photoMediaId);
    const [row] = await tx.update(siteTestimonials).set({ ...values, ...photo, updatedAt: new Date() }).where(eq(siteTestimonials.id, id)).returning();
    await audit(tx, actor, "site.update_testimonials", ENTITY.testimonials, id, { name: row.name });
    return row;
  });
}

/* ─────────────── Team ─────────────── */

export type TeamInput = { name?: string; title?: string; bio?: string; linkedinUrl?: string; photoMediaId?: string | null; visible?: boolean };

function cleanTeam(input: TeamInput) {
  return {
    name: requireText(input.name, "The name", { min: 2, max: 80 }),
    title: requireText(input.title, "The role", { min: 2, max: 100 }),
    bio: optionalText(input.bio, "The short bio", 600),
    linkedinUrl: cleanUrl(input.linkedinUrl, "The LinkedIn link"),
  };
}

export async function createTeamMember(actor: Actor, input: TeamInput) {
  const universityId = assertManage(actor);
  const values = cleanTeam(input);
  return withTenant(actor, async (tx) => {
    await assertMediaOf(tx, input.photoMediaId || null);
    const [row] = await tx
      .insert(siteTeam)
      .values({ universityId, ...values, photoMediaId: input.photoMediaId || null, visible: input.visible ?? true, position: await nextPosition(tx, "team") })
      .returning();
    await audit(tx, actor, "site.create_team", ENTITY.team, row.id, { name: row.name });
    return row;
  });
}

export async function updateTeamMember(actor: Actor, id: string, input: TeamInput) {
  assertManage(actor);
  const values = cleanTeam(input);
  return withTenant(actor, async (tx) => {
    await findIn(tx, "team", id);
    const photo = input.photoMediaId === undefined ? {} : { photoMediaId: input.photoMediaId || null };
    if (input.photoMediaId) await assertMediaOf(tx, input.photoMediaId);
    const [row] = await tx.update(siteTeam).set({ ...values, ...photo, updatedAt: new Date() }).where(eq(siteTeam.id, id)).returning();
    await audit(tx, actor, "site.update_team", ENTITY.team, id, { name: row.name });
    return row;
  });
}

/* ─────────────── Videos ─────────────── */

export type VideoInput = { title?: string; url?: string; description?: string; visible?: boolean };

function cleanVideo(input: VideoInput) {
  const id = youtubeId(input.url ?? "");
  if (!id) throw new ValidationError("Paste a YouTube link, like https://www.youtube.com/watch?v=… or https://youtu.be/….");
  return {
    youtubeId: id,
    title: requireText(input.title, "The title", { min: 2, max: 120 }),
    description: optionalText(input.description, "The description", 400),
  };
}

export async function createVideo(actor: Actor, input: VideoInput) {
  const universityId = assertManage(actor);
  const values = cleanVideo(input);
  return withTenant(actor, async (tx) => {
    const [row] = await tx
      .insert(siteVideos)
      .values({ universityId, ...values, visible: input.visible ?? true, position: await nextPosition(tx, "videos") })
      .returning();
    await audit(tx, actor, "site.create_videos", ENTITY.videos, row.id, { youtubeId: row.youtubeId });
    return row;
  });
}

export async function updateVideo(actor: Actor, id: string, input: VideoInput) {
  assertManage(actor);
  const values = cleanVideo(input);
  return withTenant(actor, async (tx) => {
    await findIn(tx, "videos", id);
    const [row] = await tx.update(siteVideos).set(values).where(eq(siteVideos.id, id)).returning();
    await audit(tx, actor, "site.update_videos", ENTITY.videos, id, { youtubeId: row.youtubeId });
    return row;
  });
}

/* ─────────────── Gallery ─────────────── */

/** Add uploaded photos to the end of the gallery, shown. */
export async function addGalleryPhotos(actor: Actor, mediaIds: string[], caption = "") {
  const universityId = assertManage(actor);
  const ids = [...new Set(mediaIds)].filter(Boolean);
  if (ids.length === 0) throw new ValidationError("Pick at least one photo to upload.");
  if (ids.length > 30) throw new ValidationError("Add up to 30 photos at a time.");
  const text = optionalText(caption, "The caption", 160);
  return withTenant(actor, async (tx) => {
    let pos = await nextPosition(tx, "gallery");
    const out = [];
    for (const mediaId of ids) {
      await assertMediaOf(tx, mediaId);
      const [row] = await tx.insert(siteGallery).values({ universityId, mediaId, caption: text, position: pos++ }).returning();
      out.push(row);
    }
    await audit(tx, actor, "site.add_gallery", "site_gallery", null, { count: out.length });
    return out;
  });
}

export async function updateGalleryCaption(actor: Actor, id: string, caption: string) {
  assertManage(actor);
  const text = optionalText(caption, "The caption", 160);
  return withTenant(actor, async (tx) => {
    await findIn(tx, "gallery", id);
    const [row] = await tx.update(siteGallery).set({ caption: text }).where(eq(siteGallery.id, id)).returning();
    // The caption doubles as the photo's alternative text.
    await tx.update(siteMedia).set({ alt: text }).where(eq(siteMedia.id, row.mediaId));
    await audit(tx, actor, "site.update_gallery", ENTITY.gallery, id, {});
    return row;
  });
}
