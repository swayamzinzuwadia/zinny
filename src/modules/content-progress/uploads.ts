/**
 * Lesson file uploads through `storage()` (video and PDF lessons).
 *
 * The browser sends a file in parts of at most 4 MB (each request stays under serverless
 * body limits). Parts are stored under `<uni>/content-progress/uploads/<id>/part-<n>`; when
 * the last part arrives they are joined into `<uni>/content-progress/lessons/<lessonId>/…`,
 * the parts are deleted and the lesson points at the new file (the old file is deleted).
 * The real file type is read from the first bytes; the browser's claim is never trusted.
 * Every step checks `content.manage` on the lesson's course again.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { assertCan, audit, courseTarget, storage, withTenant, type Actor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { isUuid, loadLesson, uni } from "./internal";
import { MAX_BYTES, PART_SIZE, formatBytes, partCount, partLength, safeFileName, sniffType, type UploadKind } from "./lib/files";
import { contentUploads } from "./schema";
import { afterCommit, storeContent, type AfterCommit } from "./service";

const partKey = (universityId: string, uploadId: string, n: number) => `${universityId}/content-progress/uploads/${uploadId}/part-${n}`;

export type StartUpload = { lessonId: string; fileName: string; size: number; durationSeconds?: number | null };

/** Starts an upload for a video or PDF lesson. Returns how to send the parts. */
export async function startUpload(actor: Actor, input: StartUpload) {
  if (!isUuid(input.lessonId)) throw new NotFoundError("Lesson");
  const size = Number(input.size);
  if (!Number.isInteger(size) || size <= 0) throw new ValidationError("The file is empty. Pick another file.");
  return withTenant(actor, async (tx) => {
    const lesson = await loadLesson(tx, input.lessonId);
    assertCan(actor, "content.manage", await courseTarget(tx, uni(actor), lesson.courseId));
    if (lesson.kind !== "video" && lesson.kind !== "pdf") {
      throw new ConflictError("Only video and PDF lessons take a file. Change the lesson type first.", "wrong_kind");
    }
    const kind: UploadKind = lesson.kind;
    if (size > MAX_BYTES[kind]) {
      throw new ValidationError(
        kind === "video"
          ? `Videos can be up to ${formatBytes(MAX_BYTES.video)}. Compress it, or upload it to YouTube or Vimeo and paste the link.`
          : `PDFs can be up to ${formatBytes(MAX_BYTES.pdf)}. Compress it or split it into two lessons.`,
      );
    }
    const name = safeFileName(input.fileName, kind === "pdf" ? "notes.pdf" : "video.mp4");
    const duration = Number(input.durationSeconds);
    const [u] = await tx
      .insert(contentUploads)
      .values({
        universityId: uni(actor),
        lessonId: lesson.id,
        kind,
        fileName: name,
        contentType: kind === "pdf" ? "application/pdf" : "video/mp4",
        size,
        partSize: PART_SIZE,
        partCount: partCount(size),
        durationSeconds: kind === "video" && Number.isFinite(duration) && duration > 0 && duration < 24 * 3600 ? Math.round(duration) : null,
        createdBy: actor.userId || null,
      })
      .returning();
    await audit(tx, actor, "content.upload_start", "lesson", lesson.id, { uploadId: u.id, fileName: name, size });
    return { uploadId: u.id, partSize: u.partSize, partCount: u.partCount };
  });
}

/** Loads an upload the actor may write to (the person who started it, still allowed to edit the course). */
async function ownUpload(actor: Actor, uploadId: string) {
  if (!isUuid(uploadId)) throw new NotFoundError("Upload");
  return withTenant(actor, async (tx) => {
    const [u] = await tx.select().from(contentUploads).where(eq(contentUploads.id, uploadId));
    if (!u) throw new NotFoundError("Upload");
    const lesson = await loadLesson(tx, u.lessonId);
    assertCan(actor, "content.manage", await courseTarget(tx, uni(actor), lesson.courseId));
    if (u.createdBy !== (actor.userId || null)) throw new ForbiddenError("This upload was started by someone else. Start your own upload.");
    return u;
  });
}

/** Stores one part. Parts may arrive again (a retry); the last copy wins. */
export async function uploadPart(actor: Actor, uploadId: string, n: number, body: Uint8Array) {
  const u = await ownUpload(actor, uploadId);
  if (!Number.isInteger(n) || n < 0 || n >= u.partCount) throw new ValidationError("That part number is outside the file.");
  if (body.byteLength !== partLength(u.size, n, u.partSize)) {
    throw new ValidationError("A part of the file arrived incomplete. Try the upload again.");
  }
  if (n === 0) {
    const type = sniffType(u.kind, body.subarray(0, 16));
    if (!type) {
      throw new ValidationError(u.kind === "pdf" ? "This file isn't a PDF. Pick a .pdf file." : "This file isn't a video we can play. Use MP4, WebM or MOV.");
    }
    if (type !== u.contentType) await withTenant(actor, (tx) => tx.update(contentUploads).set({ contentType: type }).where(eq(contentUploads.id, u.id)));
  }
  await storage().put({ key: partKey(uni(actor), u.id, n), body, contentType: "application/octet-stream" });
  await withTenant(actor, (tx) =>
    tx
      .update(contentUploads)
      .set({ receivedParts: sql`(select array_agg(distinct x order by x) from unnest(array_append(${contentUploads.receivedParts}, ${n}::int)) as x)` })
      .where(eq(contentUploads.id, u.id)),
  );
  return { received: n };
}

/** Joins the parts into the lesson's file and points the lesson at it. */
export async function finishUpload(actor: Actor, uploadId: string) {
  const u = await ownUpload(actor, uploadId);
  const missing = Array.from({ length: u.partCount }, (_, i) => i).filter((i) => !u.receivedParts.includes(i));
  if (missing.length) throw new ConflictError("Some parts of the file haven't arrived. Try the upload again.", "incomplete");

  const s = storage();
  const file = Buffer.allocUnsafe(u.size);
  let offset = 0;
  for (let i = 0; i < u.partCount; i++) {
    const part = await s.get(partKey(uni(actor), u.id, i));
    if (!part || part.size !== partLength(u.size, i, u.partSize)) throw new ConflictError("A part of the file went missing. Start the upload again.", "incomplete");
    part.body.copy(file, offset);
    offset += part.size;
  }
  if (sniffType(u.kind, file.subarray(0, 16)) !== u.contentType) throw new ValidationError("This file's type changed while it uploaded. Start again.");

  const key = `${uni(actor)}/content-progress/lessons/${u.lessonId}/${u.id.slice(0, 8)}-${u.fileName}`;
  await s.put({ key, body: file, contentType: u.contentType });

  const content =
    u.kind === "pdf"
      ? { key, fileName: u.fileName, size: u.size }
      : { source: "upload", key, fileName: u.fileName, contentType: u.contentType, size: u.size, ...(u.durationSeconds ? { durationSeconds: u.durationSeconds } : {}) };
  const later: AfterCommit = { deleteKeys: [], finished: [] };
  try {
    await withTenant(actor, async (tx) => {
      // Lock the upload so a double "finish" stores the file once.
      const [row] = await tx.select().from(contentUploads).where(eq(contentUploads.id, u.id)).for("update");
      if (!row) throw new ConflictError("This upload has already finished.", "finished");
      await storeContent(actor, u.lessonId, { expect: u.kind, content, action: u.kind === "pdf" ? "content.lesson_pdf" : "content.lesson_video_upload", tx, later });
      await tx.delete(contentUploads).where(eq(contentUploads.id, u.id));
    });
  } catch (e) {
    await s.delete(key).catch(() => {});
    throw e;
  }
  await afterCommit(uni(actor), later);
  await deleteParts(uni(actor), u.id, u.partCount);
  return { key, fileName: u.fileName, size: u.size };
}

async function deleteParts(universityId: string, uploadId: string, count: number) {
  for (let i = 0; i < count; i++) {
    await storage()
      .delete(partKey(universityId, uploadId, i))
      .catch(() => {});
  }
}

/** Abandoned uploads (older than a day) and their parts are removed. Runs daily per university. */
export async function cleanAbandonedUploads(systemActor: Actor, now = new Date()) {
  const cutoff = new Date(now.getTime() - 24 * 3600 * 1000);
  const stale = await withTenant(systemActor, async (tx) => {
    const rows = await tx.delete(contentUploads).where(and(lt(contentUploads.createdAt, cutoff))).returning();
    if (rows.length) await audit(tx, systemActor, "content.upload_cleanup", "university", uni(systemActor), { removed: rows.length });
    return rows;
  });
  for (const u of stale) await deleteParts(uni(systemActor), u.id, u.partCount);
  return stale.length;
}
