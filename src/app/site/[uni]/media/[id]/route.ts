/**
 * Public images of a university's website: /site/<uni>/media/<id>.
 * Only images uploaded for that university are served (row-level security plus the slug).
 * Images never change under an id (a replaced image gets a new id), so they are cached for a year.
 */
import { storage } from "@/server/core";
import { getSite } from "@/modules/website-builder/cached";
import { publicMedia } from "@/modules/website-builder/public";

export async function GET(_req: Request, { params }: { params: Promise<{ uni: string; id: string }> }) {
  const { uni, id } = await params;
  const site = await getSite(uni);
  const media = site ? await publicMedia(site.universityId, id) : null;
  if (!media) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
  const file = await storage().get(media.key);
  if (!file) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "content-type": media.contentType,
      "content-length": String(file.size),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
