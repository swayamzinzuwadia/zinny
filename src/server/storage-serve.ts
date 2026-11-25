/**
 * Serving files of the local-disk storage driver from the app's own origin (/api/storage).
 *
 * A stored file must never run as a page of the app:
 *   - only types a browser shows without running scripts (PDF, raster images, audio, video)
 *     open inline; anything else (HTML, SVG, XML, text, unknown) is always a download, sent
 *     as application/octet-stream;
 *   - every response carries nosniff, and everything but PDF, audio and video (which need
 *     the browser's own viewer or player) a sandboxing Content-Security-Policy.
 * In production links must be signed with a real secret (STORAGE_SIGNING_SECRET, or
 * CRON_SECRET): with neither set, the built-in development secret would let anyone forge a
 * link to any institute's files, so nothing is served.
 */
import { verifyLocal } from "@/contracts/storage";
import { storage } from "./messaging";

const INLINE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);

/** The stored type, if it is one that may open inline; null means "download only". */
export function inlineType(contentType: string): string | null {
  const t = contentType.split(";")[0].trim().toLowerCase();
  return INLINE_TYPES.has(t) ? t : null;
}

/** Whether signed links can be trusted: a real signing secret is set, or this isn't production. */
export function signingSecretConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" || !!(env.STORAGE_SIGNING_SECRET?.trim() || env.CRON_SECRET?.trim());
}

const headerSafe = (v: string) => v.replace(/["\\\r\n]/g, "").replace(/[^\x20-\x7e]/g, "_").slice(0, 200) || "file";

/** The headers a stored file is sent with. `downloadName` is the signed name, if any. */
export function fileHeaders(file: { contentType: string; size: number }, key: string, downloadName: string): Record<string, string> {
  const inline = inlineType(file.contentType);
  const headers: Record<string, string> = {
    "content-type": inline ?? "application/octet-stream",
    "content-length": String(file.size),
    "cache-control": "private, max-age=60",
    "x-content-type-options": "nosniff",
  };
  if (!inline || inline.startsWith("image/")) headers["content-security-policy"] = "default-src 'none'; sandbox";
  if (downloadName || !inline) headers["content-disposition"] = `attachment; filename="${headerSafe(downloadName || key.split("/").pop() || "file")}"`;
  return headers;
}

/** GET /api/storage/<key>?exp=…&sig=…[&name=…] */
export async function serveLocalFile(req: Request, parts: string[]): Promise<Response> {
  const s = storage();
  if (s.name !== "local") return new Response("not found", { status: 404 });
  if (!signingSecretConfigured()) {
    console.error("[storage] STORAGE_SIGNING_SECRET (or CRON_SECRET) is not set, so local files are not served.");
    return new Response("Files can't be opened right now. Ask the Zinny team to finish setting up file storage.", { status: 503 });
  }
  let key: string;
  try {
    key = parts.map(decodeURIComponent).join("/");
  } catch {
    return new Response("not found", { status: 404 });
  }
  const q = new URL(req.url).searchParams;
  const name = q.get("name") ?? "";
  if (!verifyLocal(key, Number(q.get("exp")), name, q.get("sig") ?? "")) {
    return new Response("This link has expired or isn't valid. Go back and open the file again.", { status: 403 });
  }
  let file;
  try {
    file = await s.get(key);
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (!file) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(file.body), { headers: fileHeaders(file, key, name) });
}
