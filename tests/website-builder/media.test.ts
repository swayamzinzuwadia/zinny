import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { storage } from "@/server/core";
import { addGalleryPhotos, deleteItem, listGallery, updateGalleryCaption } from "@/modules/website-builder/content";
import { MAX_UPLOAD_BYTES, mediaPath, processImage, uploadImage } from "@/modules/website-builder/media";
import { publicMedia } from "@/modules/website-builder/public";
import { siteMedia } from "@/modules/website-builder/schema";
import { png, siteFixture } from "./helpers";

afterAll(closeDb);

describe("website-builder: image uploads", () => {
  it("re-encodes to WebP, resizes for its use, strips metadata and stores under the university's key", async () => {
    const { uni, admin } = await siteFixture("Upload U");
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#0b5e4c" } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "Secret camera owner" } } })
      .toBuffer();
    const m = await uploadImage(admin, { kind: "gallery", bytes: big, alt: "Campus lawn" });
    expect(m).toMatchObject({ width: 2000, height: 1333, kind: "gallery", alt: "Campus lawn" });
    const [row] = await systemDb().select().from(siteMedia).where(eq(siteMedia.id, m.id));
    expect(row.key).toBe(`${uni.id}/website-builder/media/${m.id}.webp`);
    expect(row.contentType).toBe("image/webp");
    const file = await storage().get(row.key);
    const meta = await sharp(file!.body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(await publicMedia(uni.id, m.id)).toEqual({ key: row.key, contentType: "image/webp" });
    expect(mediaPath(uni.slug, m.id)).toBe(`/site/${uni.slug}/media/${m.id}`);

    // Small images are never enlarged.
    const small = await uploadImage(admin, { kind: "cover", bytes: await png(300, 200) });
    expect(small).toMatchObject({ width: 300, height: 200 });
  });

  it("refuses SVG, non-images, empty and oversized files", async () => {
    const { admin } = await siteFixture("Upload Bad U");
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>`);
    await expect(uploadImage(admin, { kind: "logo", bytes: svg })).rejects.toThrow(/isn't an image we can use/);
    await expect(uploadImage(admin, { kind: "logo", bytes: Buffer.from("%PDF-1.4 not an image") })).rejects.toThrow(/isn't an image we can use/);
    await expect(uploadImage(admin, { kind: "logo", bytes: Buffer.alloc(0) })).rejects.toThrow(/empty/);
    await expect(processImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1), "logo")).rejects.toThrow(/under 10 MB/);
    await expect(uploadImage(admin, { kind: "bogus" as never, bytes: await png() })).rejects.toThrow(/Unknown image use/);
    expect(await systemDb().select().from(siteMedia).where(eq(siteMedia.universityId, admin.universityId!))).toEqual([]);
  });

  it("gallery photos get captions (also their alt text); deleting one removes its file", async () => {
    const { admin } = await siteFixture("Gallery U");
    const a = await uploadImage(admin, { kind: "gallery", bytes: await png() });
    const b = await uploadImage(admin, { kind: "gallery", bytes: await png(50, 50, "#d4a72a") });
    const rows = await addGalleryPhotos(admin, [a.id, b.id, a.id]);
    expect(rows).toHaveLength(2);
    await updateGalleryCaption(admin, rows[0].id, "The library");
    const [m] = await systemDb().select().from(siteMedia).where(eq(siteMedia.id, a.id));
    expect(m.alt).toBe("The library");
    expect((await listGallery(admin)).map((g) => g.item.caption)).toEqual(["The library", ""]);

    await deleteItem(admin, "gallery", rows[0].id);
    expect(await systemDb().select().from(siteMedia).where(eq(siteMedia.id, a.id))).toEqual([]);
    expect(await storage().get(m.key)).toBeNull();
    await expect(addGalleryPhotos(admin, [])).rejects.toThrow(/at least one photo/);
  });
});
