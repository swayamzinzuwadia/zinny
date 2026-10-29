/**
 * Route handlers for files (mounted under /[uni]/admin/products/assignments/ and
 * /[uni]/learn/assignments/). Pages never link to storage directly: they link to
 * `files/<fileId>`, which checks access on every click and redirects to a signed URL that
 * works for two minutes.
 *
 *   POST upload            { op: "start", purpose, courseId | assignmentId (+ batchId), fileName, size }
 *   POST upload?op=part&fileId=…&index=…   raw bytes of one part (up to 4 MB)
 *   POST upload            { op: "finish", fileId }
 *   GET  files/<fileId>    302 to a short-lived signed URL
 */
import { NextResponse } from "next/server";
import { AppError } from "@/server/errors";
import { spaceContext } from "@/server/context";
import { fileLink, finishUpload, PART_BYTES, putPart, startUpload, type StartUpload } from "./service/files";

type UploadParams = { params: Promise<{ uni: string }> };
type FileParams = { params: Promise<{ uni: string; fileId: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function failure(e: unknown) {
  if (e instanceof AppError) return json({ error: e.message }, e.status);
  console.error("[assignments-polls] upload failed:", e);
  return json({ error: "The upload failed. Check your connection and try again." }, 500);
}

/** Refuses posts from other sites (the session cookie is SameSite=Lax; this is a second line). */
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Reads the body, giving up (null) as soon as it is longer than `limit` bytes. */
async function readLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function uploadRoute(req: Request, { params }: UploadParams) {
  if (!sameOrigin(req)) return json({ error: "This upload came from another site." }, 403);
  const { uni } = await params;
  const { actor } = await spaceContext(uni);
  const url = new URL(req.url);
  try {
    if (url.searchParams.get("op") === "part") {
      const fileId = url.searchParams.get("fileId") ?? "";
      const index = Number(url.searchParams.get("index"));
      const length = Number(req.headers.get("content-length") ?? "0");
      if (length > PART_BYTES) return json({ error: "That part of the file is too large. Upload the file again." }, 413);
      const body = await readLimited(req, PART_BYTES);
      if (!body) return json({ error: "That part of the file is too large. Upload the file again." }, 413);
      await putPart(actor, fileId, index, body);
      return json({ ok: true });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return json({ error: "The upload request was empty. Try again." }, 400);
    if (body.op === "finish") return json(await finishUpload(actor, String(body.fileId ?? "")));
    if (body.op === "start") {
      const purpose = String(body.purpose ?? "");
      const common = { fileName: String(body.fileName ?? ""), size: Number(body.size ?? 0) };
      const input: StartUpload | null =
        purpose === "attachment"
          ? { purpose, courseId: String(body.courseId ?? ""), ...common }
          : purpose === "submission"
            ? { purpose, assignmentId: String(body.assignmentId ?? ""), ...common }
            : purpose === "returned"
              ? { purpose, assignmentId: String(body.assignmentId ?? ""), batchId: String(body.batchId ?? ""), ...common }
              : null;
      if (!input) return json({ error: "Unknown upload." }, 400);
      return json(await startUpload(actor, input));
    }
    return json({ error: "Unknown upload step." }, 400);
  } catch (e) {
    return failure(e);
  }
}

export async function fileRoute(req: Request, { params }: FileParams) {
  const { uni, fileId } = await params;
  const { actor } = await spaceContext(uni);
  try {
    const { url } = await fileLink(actor, fileId);
    return NextResponse.redirect(new URL(url, req.url), { status: 302, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  } catch (e) {
    if (e instanceof AppError) {
      return new NextResponse(e.status === 404 ? "This file doesn't exist or you don't have access to it." : e.message, {
        status: e.status,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      });
    }
    throw e;
  }
}
