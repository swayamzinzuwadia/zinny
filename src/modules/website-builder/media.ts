/**
 * Image uploads for the website (logo, cover, gallery, blog covers, people's photos).
 *
 * Every upload is decoded and re-encoded with sharp: rotated upright, resized to a sensible
 * maximum for its use, saved as WebP, and stripped of metadata (camera details, GPS). Only
 * JPEG, PNG, WebP, AVIF and GIF are accepted; SVG and anything else is refused. Files are
 * stored through core storage() under `<universityId>/website-builder/media/<id>.webp` and
 * served by the public site at /site/<uni>/media/<id>.
 */
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit, storage, withTenant, type Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { assertManage, assertOwnProfile } from "./access";
import { siteMedia, type MediaKind } from "./schema";
import { isUuid } from "./validate";

export const MEDIA_KINDS: readonly MediaKind[] = ["logo", "cover", "hero", "gallery", "post", "team", "testimonial", "faculty"];

/** Largest file accepted before processing. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Longest side after processing, per use. */
const MAX_SIDE: Record<MediaKind, number> = {
  logo: 640,
  cover: 2400,
  hero: 2400,
  gallery: 2000,
  post: 1800,
  team: 900,
  testimonial: 600,
  faculty: 900,
};

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "avif", "gif", "heif"]);

export type MediaInfo = { id: string; width: number; height: number; kind: MediaKind; alt: string };

export const mediaPath = (uni: string, mediaId: string) => `/site/${uni}/media/${mediaId}`;

/** Decode, check and re-encode an image. Exported for tests and the seed. */
export async function processImage(bytes: Buffer, kind: MediaKind) {
  if (bytes.length === 0) throw new ValidationError("The file is empty. Pick the image again.");
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new ValidationError(`The image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB. Upload one under 10 MB.`);
  }
  let format: string | undefined;
  try {
    format = (await sharp(bytes, { limitInputPixels: 60_000_000 }).metadata()).format;
  } catch {
    format = undefined;
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    throw new ValidationError("This file isn't an image we can use. Upload a JPG, PNG or WebP picture.");
  }
  try {
    const side = MAX_SIDE[kind];
    const { data, info } = await sharp(bytes, { limitInputPixels: 60_000_000, animated: false })
      .rotate()
      .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
      .webp({ quality: kind === "logo" ? 90 : 82, alphaQuality: 90 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, contentType: "image/webp" };
  } catch {
    throw new ValidationError("We couldn't read this image. It may be damaged; try exporting it again as JPG or PNG.");
  }
}

/**
 * Upload an image. Faculty photos need only your own profile access (`self.profile`);
 * everything else needs `website.manage`.
 */
export async function uploadImage(actor: Actor, input: { kind: MediaKind; bytes: Buffer; alt?: string }): Promise<MediaInfo> {
  if (!MEDIA_KINDS.includes(input.kind)) throw new ValidationError("Unknown image use.");
  const universityId = input.kind === "faculty" ? assertOwnProfile(actor, actor.userId) : assertManage(actor);
  const img = await processImage(input.bytes, input.kind);
  const id = randomUUID();
  const key = `${universityId}/website-builder/media/${id}.webp`;
  const alt = (input.alt ?? "").trim().slice(0, 200);
  await storage().put({ key, body: img.data, contentType: img.contentType });
  try {
    await withTenant(actor, async (tx) => {
      await tx.insert(siteMedia).values({
        id,
        universityId,
        key,
        kind: input.kind,
        contentType: img.contentType,
        size: img.data.length,
        width: img.width,
        height: img.height,
        alt,
        uploadedBy: actor.userId || null,
      });
      await audit(tx, actor, "site.upload_image", "site_media", id, { kind: input.kind, width: img.width, height: img.height });
    });
  } catch (e) {
    await storage().delete(key).catch(() => {});
    throw e;
  }
  return { id, width: img.width, height: img.height, kind: input.kind, alt };
}

/** An image of this university, for checks before it is attached to something. */
export async function assertMediaOf(tx: Tx, mediaId: string | null | undefined, kinds?: MediaKind[]) {
  if (!mediaId) return null;
  if (!isUuid(mediaId)) throw new NotFoundError("Image");
  const [m] = await tx.select().from(siteMedia).where(eq(siteMedia.id, mediaId));
  if (!m) throw new NotFoundError("Image");
  if (kinds && !kinds.includes(m.kind)) throw new ValidationError("That image was uploaded for something else. Upload it again here.");
  return m;
}
