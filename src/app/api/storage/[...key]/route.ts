import { verifyLocal } from "@/contracts/storage";
import { storage } from "@/server/core";

/**
 * Serves files for the local-disk storage driver through short-lived signed URLs made by
 * storage().signedUrl(). With the S3 driver, signed URLs point at the bucket instead.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const s = storage();
  if (s.name !== "local") return new Response("not found", { status: 404 });
  const { key: parts } = await params;
  const key = parts.map(decodeURIComponent).join("/");
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
  const headers: Record<string, string> = {
    "content-type": file.contentType,
    "content-length": String(file.size),
    "cache-control": "private, max-age=60",
    "x-content-type-options": "nosniff",
  };
  if (name) headers["content-disposition"] = `attachment; filename="${name.replace(/["\\\r\n]/g, "")}"`;
  return new Response(new Uint8Array(file.body), { headers });
}
