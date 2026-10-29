/**
 * Image uploads for the Website section: POST multipart/form-data with `file`
 * (and optionally `alt`) to /<uni>/admin/website/upload?kind=<kind>.
 * Responds with { id, src, width, height } or { error }.
 *
 * A route handler rather than a server action, because server actions cap request bodies
 * at 1 MB and photos are often larger. The service checks permissions and re-encodes the image.
 */
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { spaceContext } from "@/server/context";
import { MAX_UPLOAD_BYTES, MEDIA_KINDS, mediaPath, uploadImage } from "@/modules/website-builder/media";
import type { MediaKind } from "@/modules/website-builder/schema";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: Request, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;

  // Same-site requests only (the session cookie is SameSite=Lax; this is a second check).
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return json({ error: "Uploads must come from this site." }, 403);

  const { actor } = await spaceContext(uni);
  const kind = new URL(req.url).searchParams.get("kind") as MediaKind | null;
  if (!kind || !MEDIA_KINDS.includes(kind)) return json({ error: "Unknown image use. Reload the page and try again." }, 400);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 64 * 1024) return json({ error: "The image is larger than 10 MB. Upload a smaller one." }, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "The upload didn't arrive. Check your connection and try again." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "Pick an image to upload." }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ error: "The image is larger than 10 MB. Upload a smaller one." }, 413);

  try {
    const media = await uploadImage(actor, { kind, bytes: Buffer.from(await file.arrayBuffer()), alt: String(form.get("alt") ?? "") });
    return json({ id: media.id, src: mediaPath(uni, media.id), width: media.width, height: media.height });
  } catch (e) {
    if (e instanceof ValidationError || e instanceof ConflictError) return json({ error: e.message }, 422);
    if (e instanceof ForbiddenError) return json({ error: e.message }, 403);
    if (e instanceof NotFoundError) return json({ error: e.message }, 404);
    console.error("[website-builder] upload failed:", e);
    return json({ error: "The upload failed. Try again in a moment." }, 500);
  }
}
