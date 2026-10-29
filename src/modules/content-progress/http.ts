/**
 * Responses for this module's route handlers. Routes only build the actor (spaceContext)
 * and call these, so the rules are tested here without a running server.
 */
import { unstable_rethrow } from "next/navigation";
import type { Actor } from "@/server/core";
import { AppError, ValidationError } from "@/server/errors";
import { lessonFileUrl, parseVideoReport, reportVideoProgress } from "./learn";
import { staffLessonFileUrl } from "./service";
import { finishUpload, startUpload, uploadPart } from "./uploads";

const NO_STORE = { "cache-control": "no-store" };

/** Runs a handler and turns known errors into JSON with the right status. */
export async function respond(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return Response.json({ error: e.message, code: e.code }, { status: e.status, headers: NO_STORE });
    console.error("[content-progress]", e);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500, headers: NO_STORE });
  }
}

/** Writes must come from our own pages (the session cookie is SameSite=Lax; this is a second check). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new AppError("This request came from another site.", "cross_site", 403);
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    // fall through
  }
  if (originHost !== host) throw new AppError("This request came from another site.", "cross_site", 403);
}

function redirectTo(url: string) {
  return new Response(null, { status: 302, headers: { location: url, ...NO_STORE, "referrer-policy": "no-referrer" } });
}

/** GET /[uni]/learn/lessons/[lessonId]/file: a fresh signed URL, only for learners the lesson is open to. */
export function learnerFileResponse(actor: Actor, lessonId: string, req: Request) {
  return respond(async () => {
    const download = new URL(req.url).searchParams.get("download") === "1";
    return redirectTo(await lessonFileUrl(actor, lessonId, { download }));
  });
}

/** GET /[uni]/admin/products/content/lessons/[lessonId]/file: staff preview (course.view). */
export function staffFileResponse(actor: Actor, lessonId: string, req: Request) {
  return respond(async () => {
    const download = new URL(req.url).searchParams.get("download") === "1";
    return redirectTo(await staffLessonFileUrl(actor, lessonId, { download }));
  });
}

async function readJson(req: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new ValidationError("The request is too large.");
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new ValidationError("The request isn't valid JSON.");
  }
}

/** POST /[uni]/learn/lessons/[lessonId]/progress: the video player's watched parts. */
export function videoProgressResponse(actor: Actor, lessonId: string, req: Request) {
  return respond(async () => {
    assertSameOrigin(req);
    const result = await reportVideoProgress(actor, lessonId, parseVideoReport(await readJson(req)));
    return Response.json(result, { headers: NO_STORE });
  });
}

/** POST /[uni]/admin/products/content/uploads: starts an upload. */
export function startUploadResponse(actor: Actor, req: Request) {
  return respond(async () => {
    assertSameOrigin(req);
    const body = (await readJson(req)) as Record<string, unknown>;
    const r = await startUpload(actor, {
      lessonId: String(body.lessonId ?? ""),
      fileName: String(body.fileName ?? ""),
      size: Number(body.size),
      durationSeconds: body.durationSeconds === undefined || body.durationSeconds === null ? null : Number(body.durationSeconds),
    });
    return Response.json(r, { headers: NO_STORE });
  });
}

/** PUT /[uni]/admin/products/content/uploads/[uploadId]?part=n: one part (raw bytes). */
export function uploadPartResponse(actor: Actor, uploadId: string, req: Request) {
  return respond(async () => {
    assertSameOrigin(req);
    const n = Number(new URL(req.url).searchParams.get("part"));
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > 5 * 1024 * 1024) throw new ValidationError("Each part of an upload can be up to 4 MB.");
    const body = new Uint8Array(await req.arrayBuffer());
    return Response.json(await uploadPart(actor, uploadId, n, body), { headers: NO_STORE });
  });
}

/** POST /[uni]/admin/products/content/uploads/[uploadId]: joins the parts into the lesson's file. */
export function finishUploadResponse(actor: Actor, uploadId: string, req: Request) {
  return respond(async () => {
    assertSameOrigin(req);
    return Response.json(await finishUpload(actor, uploadId), { headers: NO_STORE });
  });
}
