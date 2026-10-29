/**
 * Files for assignments: attachments (staff), submitted work (students) and files returned
 * with a grade (staff).
 *
 * Uploading happens in up to 4 MB parts through a route handler, because server actions
 * accept 1 MB and Vercel functions about 4.5 MB per request:
 *   1. startUpload   checks who may upload what, and the file's kind and size; records a staged file
 *   2. putPart       stores each part under <uni>/assignments-polls/staging/<fileId>/
 *   3. finishUpload  joins the parts into the final object and marks the file stored
 * A form then claims its staged files (claimFiles). Unclaimed files are removed by the daily job.
 *
 * Opening a file always goes through fileLink, which checks access and returns a signed URL
 * that works for two minutes. Students open only their own work; staff open work of batches
 * they can grade (that batch's faculty, the HOD, admins).
 */
import { and, eq, inArray, isNull, isNotNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit, can, getCourseLite, storage, withTenant, type Actor } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { batchesWhere, coveredBatchIds, deptTarget, isUuid, learnerSeats, loadForStaff, need, ownTarget, seatFor, uni, courseBatchIds } from "../access";
import { checkUpload, displayName, MAX_UPLOAD_MB, storageKeyFor } from "../lib/files";
import { asgnAssignments, asgnFiles, asgnSubmissions } from "../schema";

export const PART_BYTES = 4 * 1024 * 1024;
/** How long a signed link works. The page links to a route that makes a fresh one on every click. */
export const LINK_SECONDS = 120;
/** Staged files older than this are removed. */
export const STAGED_TTL_HOURS = 24;
/** How many unsaved uploads one person may have at a time. */
export const MAX_STAGED_PER_PERSON = 30;

export type FilePurpose = "attachment" | "submission" | "returned";
export type FileRow = typeof asgnFiles.$inferSelect;

export type StartUpload =
  | { purpose: "attachment"; courseId: string; fileName: string; size: number }
  | { purpose: "submission"; assignmentId: string; fileName: string; size: number }
  | { purpose: "returned"; assignmentId: string; batchId: string; fileName: string; size: number };

export type StartedUpload = { fileId: string; partBytes: number; parts: number };

const partKey = (universityId: string, fileId: string, index: number) =>
  `${universityId}/assignments-polls/staging/${fileId}/part-${String(index).padStart(4, "0")}`;

const partsFor = (size: number) => Math.max(1, Math.ceil(size / PART_BYTES));

/** Checks the uploader may add this kind of file here, and returns the size limit in MB. */
async function uploadLimit(tx: Tx, actor: Actor, input: StartUpload): Promise<{ maxMb: number; assignmentId: string | null }> {
  const u = uni(actor);
  if (input.purpose === "attachment") {
    const course = await getCourseLite(tx, need(input.courseId, "Course"));
    const bs = await courseBatchIds(tx, course.id);
    const allowed = can(actor, "assignment.manage", deptTarget(u, course.departmentId)) || batchesWhere(actor, "assignment.manage", course.departmentId, bs).length > 0;
    if (!allowed) throw new ForbiddenError("You can't add assignments to this course.");
    return { maxMb: MAX_UPLOAD_MB, assignmentId: null };
  }
  if (input.purpose === "returned") {
    const { a, access } = await loadForStaff(tx, actor, input.assignmentId);
    if (!isUuid(input.batchId) || !access.gradeBatchIds.includes(input.batchId)) throw new ForbiddenError("You can only return files to students in batches you grade.");
    return { maxMb: MAX_UPLOAD_MB, assignmentId: a.id };
  }
  if (!can(actor, "self.submit_assignment", ownTarget(actor))) throw new ForbiddenError("Only students can hand in assignments.");
  const [a] = await tx.select().from(asgnAssignments).where(eq(asgnAssignments.id, need(input.assignmentId, "Assignment")));
  if (!a) throw new NotFoundError("Assignment");
  const seat = seatFor(await learnerSeats(tx, actor.userId), a, await coveredBatchIds(tx, a));
  if (!seat) throw new NotFoundError("Assignment");
  if (seat.status !== "active") throw new ValidationError("This course has ended, so you can't hand in work for it any more.");
  if (a.submissionType === "text") throw new ValidationError("This assignment takes a written answer only, not files.");
  return { maxMb: a.maxFileMb, assignmentId: a.id };
}

export async function startUpload(actor: Actor, input: StartUpload): Promise<StartedUpload> {
  return withTenant(actor, async (tx) => {
    const { maxMb, assignmentId } = await uploadLimit(tx, actor, input);
    const size = Math.floor(Number(input.size));
    const contentType = checkUpload(input.fileName, size, Math.min(maxMb, MAX_UPLOAD_MB));
    const [{ staged }] = await tx
      .select({ staged: sql<number>`count(*)::int` })
      .from(asgnFiles)
      .where(and(eq(asgnFiles.uploadedBy, actor.userId), isNull(asgnFiles.attachedAt)));
    if (staged >= MAX_STAGED_PER_PERSON) throw new ValidationError("You have too many uploads that haven't been saved. Save your work, or try again tomorrow.");
    const fileId = crypto.randomUUID();
    const [f] = await tx
      .insert(asgnFiles)
      .values({
        id: fileId,
        universityId: uni(actor),
        purpose: input.purpose,
        assignmentId,
        storageKey: storageKeyFor(uni(actor), fileId, input.fileName),
        fileName: displayName(input.fileName),
        contentType,
        sizeBytes: size,
        uploadedBy: actor.userId,
      })
      .returning();
    await audit(tx, actor, "assignment.file_upload", "asgn_file", f.id, { purpose: input.purpose, assignmentId, fileName: f.fileName, sizeBytes: size });
    return { fileId: f.id, partBytes: PART_BYTES, parts: partsFor(size) };
  });
}

async function stagedFile(tx: Tx, actor: Actor, fileId: string): Promise<FileRow> {
  need(fileId, "Upload");
  const [f] = await tx.select().from(asgnFiles).where(eq(asgnFiles.id, fileId));
  if (!f || f.uploadedBy !== actor.userId || f.attachedAt) throw new NotFoundError("Upload");
  return f;
}

/** Stores one part. Every part but the last is exactly PART_BYTES long. */
export async function putPart(actor: Actor, fileId: string, index: number, body: Uint8Array): Promise<void> {
  const f = await withTenant(actor, (tx) => stagedFile(tx, actor, fileId));
  if (f.storedAt) throw new ValidationError("This file has already been uploaded.");
  const parts = partsFor(f.sizeBytes);
  if (!Number.isInteger(index) || index < 0 || index >= parts) throw new ValidationError("That part of the file isn't expected. Upload the file again.");
  const expected = index === parts - 1 ? f.sizeBytes - PART_BYTES * (parts - 1) : PART_BYTES;
  if (body.byteLength !== expected) throw new ValidationError("Part of the file went missing on the way. Upload the file again.");
  await storage().put({ key: partKey(f.universityId, f.id, index), body, contentType: "application/octet-stream" });
}

/** Joins the parts into the file and marks it stored. Safe to call twice. */
export async function finishUpload(actor: Actor, fileId: string): Promise<{ fileId: string; fileName: string; sizeBytes: number }> {
  const f = await withTenant(actor, (tx) => stagedFile(tx, actor, fileId));
  if (!f.storedAt) {
    const parts = partsFor(f.sizeBytes);
    const chunks: Buffer[] = [];
    for (let i = 0; i < parts; i++) {
      const part = await storage().get(partKey(f.universityId, f.id, i));
      if (!part) throw new ValidationError("Part of the file went missing on the way. Upload the file again.");
      chunks.push(part.body);
    }
    const body = Buffer.concat(chunks);
    if (body.length !== f.sizeBytes) throw new ValidationError("Part of the file went missing on the way. Upload the file again.");
    await storage().put({ key: f.storageKey, body, contentType: f.contentType });
    await withTenant(actor, (tx) => tx.update(asgnFiles).set({ storedAt: new Date() }).where(eq(asgnFiles.id, f.id)));
    await Promise.all(Array.from({ length: parts }, (_, i) => storage().delete(partKey(f.universityId, f.id, i)).catch(() => {})));
  }
  return { fileId: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes };
}

/**
 * Attaches staged files to what a form saved. Each must be the actor's own upload, fully
 * stored, for the same purpose (and assignment), and not attached yet.
 */
export async function claimFiles(
  tx: Tx,
  actor: Actor,
  fileIds: readonly string[],
  purpose: FilePurpose,
  link: { assignmentId: string; submissionId?: string; versionId?: string },
): Promise<FileRow[]> {
  const ids = [...new Set(fileIds.filter(Boolean))];
  if (ids.length === 0) return [];
  if (ids.some((id) => !isUuid(id))) throw new ValidationError("A file didn't finish uploading. Remove it, upload it again and save.");
  const rows = await tx
    .select()
    .from(asgnFiles)
    .where(and(inArray(asgnFiles.id, ids), eq(asgnFiles.uploadedBy, actor.userId), eq(asgnFiles.purpose, purpose), isNull(asgnFiles.attachedAt), isNotNull(asgnFiles.storedAt)))
    .for("update");
  const fits = rows.filter((r) => purpose === "attachment" || r.assignmentId === link.assignmentId);
  if (fits.length !== ids.length) throw new ValidationError("A file didn't finish uploading. Remove it, upload it again and save.");
  return tx
    .update(asgnFiles)
    .set({ attachedAt: new Date(), assignmentId: link.assignmentId, submissionId: link.submissionId ?? null, versionId: link.versionId ?? null })
    .where(inArray(asgnFiles.id, ids))
    .returning();
}

/** Removes stored objects after the rows are gone. Keys still used by another row are kept. */
export async function deleteStored(actor: Actor, keys: string[]) {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return;
  const still = await withTenant(actor, (tx) => tx.select({ key: asgnFiles.storageKey }).from(asgnFiles).where(inArray(asgnFiles.storageKey, unique)));
  const inUse = new Set(still.map((r) => r.key));
  await Promise.all(unique.filter((k) => !inUse.has(k)).map((k) => storage().delete(k).catch((e) => console.error(`[assignments-polls] couldn't delete ${k}:`, e))));
}

/**
 * A short-lived link to a file, after checking the actor may open it:
 *  - attachments: anyone who can see the assignment;
 *  - submitted and returned files: the student, and staff who can grade that student's batch;
 *  - a staged file: only the person uploading it.
 * Everyone else gets "not found", so file ids reveal nothing.
 */
export async function fileLink(actor: Actor, fileId: string): Promise<{ url: string; fileName: string }> {
  need(fileId, "File");
  const f = await withTenant(actor, async (tx) => {
    const [f] = await tx.select().from(asgnFiles).where(eq(asgnFiles.id, fileId));
    if (!f || !f.storedAt) throw new NotFoundError("File");
    if (!f.attachedAt) {
      if (f.uploadedBy !== actor.userId) throw new NotFoundError("File");
      return f;
    }
    const [a] = await tx.select().from(asgnAssignments).where(eq(asgnAssignments.id, f.assignmentId!));
    if (!a) throw new NotFoundError("File");
    const covered = await coveredBatchIds(tx, a);
    if (f.purpose === "attachment") {
      const asStudent = can(actor, "self.submit_assignment", ownTarget(actor)) && !!seatFor(await learnerSeats(tx, actor.userId), a, covered);
      const asStaff = covered.length
        ? batchesWhere(actor, "assignment.view", a.departmentId, covered).length > 0
        : can(actor, "assignment.view", deptTarget(uni(actor), a.departmentId));
      if (!asStudent && !asStaff) throw new NotFoundError("File");
      return f;
    }
    const [s] = await tx.select().from(asgnSubmissions).where(eq(asgnSubmissions.id, f.submissionId!));
    if (!s) throw new NotFoundError("File");
    const own = s.userId === actor.userId && can(actor, "self.submit_assignment", ownTarget(actor));
    const grader = batchesWhere(actor, "assignment.grade", a.departmentId, [s.batchId]).length === 1;
    if (!own && !grader) throw new NotFoundError("File");
    if (!own) await audit(tx, actor, "assignment.file_opened", "asgn_file", f.id, { submissionId: s.id, studentId: s.userId });
    return f;
  });
  const url = await storage().signedUrl(f.storageKey, LINK_SECONDS, { downloadName: f.storageKey.split("/").pop() });
  return { url, fileName: f.fileName };
}

/** Daily: removes uploads nobody saved. */
export async function cleanStagedFiles(actor: Actor, now = new Date()) {
  const cutoff = new Date(now.getTime() - STAGED_TTL_HOURS * 3_600_000);
  const stale = await withTenant(actor, async (tx) => {
    const rows = await tx.delete(asgnFiles).where(and(isNull(asgnFiles.attachedAt), lt(asgnFiles.createdAt, cutoff))).returning();
    if (rows.length) await audit(tx, actor, "assignment.clean_uploads", "asgn_file", null, { removed: rows.length });
    return rows;
  });
  for (const f of stale) {
    await storage().delete(f.storageKey).catch(() => {});
    for (let i = 0; i < partsFor(f.sizeBytes); i++) await storage().delete(partKey(f.universityId, f.id, i)).catch(() => {});
  }
  return stale.length;
}

/** Files by owner record, for display. */
export async function filesFor(tx: Tx, where: { assignmentIds?: string[]; submissionIds?: string[] }) {
  const conds = [
    where.assignmentIds?.length ? and(eq(asgnFiles.purpose, "attachment"), inArray(asgnFiles.assignmentId, where.assignmentIds)) : undefined,
    where.submissionIds?.length ? inArray(asgnFiles.submissionId, where.submissionIds) : undefined,
  ].filter(Boolean);
  if (conds.length === 0) return [];
  return tx
    .select()
    .from(asgnFiles)
    .where(and(isNotNull(asgnFiles.attachedAt), conds.length === 1 ? conds[0] : sql`(${conds[0]} or ${conds[1]})`))
    .orderBy(asgnFiles.createdAt, asgnFiles.fileName);
}

export type FileView = { id: string; fileName: string; sizeBytes: number; contentType: string };
export const fileView = (f: FileRow): FileView => ({ id: f.id, fileName: f.fileName, sizeBytes: f.sizeBytes, contentType: f.contentType });
