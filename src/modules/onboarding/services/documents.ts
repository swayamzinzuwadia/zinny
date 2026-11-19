/**
 * The institute's documents (PAN card required; deeds, MOA, AOA, GST certificate and
 * registrations optional), uploaded by people who run the institute (settings.manage).
 *
 * Files go up in parts of PART_BYTES through a route handler, because server actions accept
 * 1 MB and Vercel functions about 4.5 MB per request:
 *   1. startDocumentUpload  checks kind, type and size; records the document as "uploading"
 *   2. putDocumentPart      stores each part under <uni>/<STORAGE_AREA>/staging/<id>/
 *   3. finishDocumentUpload joins the parts, checks the bytes really are a PDF, JPG or PNG,
 *                           stores the file and marks it pending for the Zinny team
 * A new upload of a kind replaces the one before (kept, with superseded_at set). Nothing is
 * deleted from the database; staged parts are removed once joined.
 */
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { assertCan, audit, storage, withTenant, type Actor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { DOCUMENT_KINDS, DOCUMENT_LABEL, DOCUMENT_TYPES, PART_BYTES, documentProblem, documentType, isDocumentKind, type DocumentKind } from "../lib/constants";
import { cleanFileName, sniffType } from "../lib/files";
import { onbDocuments } from "../schema";

export type DocumentRow = typeof onbDocuments.$inferSelect;

/** Kinds where an institute may keep several files (each registration is its own). */
const MULTIPLE: ReadonlySet<DocumentKind> = new Set(["registration"]);

/**
 * Where the files live in storage(). Storage keys must start with a module id from
 * MODULE_IDS (src/contracts/module.ts), which doesn't list "onboarding" yet during this wave,
 * so documents sit in the Zinny team panel's area, under onboarding/. Once the integrator adds
 * "onboarding" to MODULE_IDS this becomes "onboarding" (stored keys are kept on each row).
 */
export const STORAGE_AREA = "zinny-team-panel/onboarding";

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const partKey = (universityId: string, id: string, index: number) => `${universityId}/${STORAGE_AREA}/staging/${id}/part-${String(index).padStart(3, "0")}`;
const partsFor = (size: number) => Math.max(1, Math.ceil(size / PART_BYTES));

function uni(actor: Actor) {
  if (!actor.universityId) throw new ForbiddenError("No institute selected.");
  return actor.universityId;
}

/** Only people who run the whole institute see and send its documents. */
function assertManage(actor: Actor) {
  assertCan(actor, "settings.manage", { universityId: uni(actor) });
}

/** The documents on file now: one per kind (several registrations), newest first within a kind. */
export async function listDocuments(actor: Actor): Promise<DocumentRow[]> {
  assertManage(actor);
  const rows = await withTenant(actor, (tx) =>
    tx
      .select()
      .from(onbDocuments)
      .where(and(isNull(onbDocuments.supersededAt), ne(onbDocuments.status, "uploading")))
      .orderBy(asc(onbDocuments.kind), desc(onbDocuments.createdAt)),
  );
  const order = DOCUMENT_KINDS.map((d) => d.key as string);
  return rows.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

export type StartedUpload = { documentId: string; parts: number; partBytes: number };

export async function startDocumentUpload(actor: Actor, input: { kind: string; fileName: string; size: number; contentType: string }): Promise<StartedUpload> {
  assertManage(actor);
  if (!isDocumentKind(input.kind)) throw new ValidationError("Pick which document this is.");
  const problem = documentProblem({ name: input.fileName, size: input.size, type: input.contentType });
  if (problem) throw new ValidationError(problem);
  const contentType = documentType(input.fileName, input.contentType)!;
  const fileName = cleanFileName(input.fileName);
  const universityId = uni(actor);
  const id = crypto.randomUUID();
  await withTenant(actor, (tx) =>
    tx.insert(onbDocuments).values({
      id,
      universityId,
      kind: input.kind as DocumentKind,
      fileName,
      contentType,
      sizeBytes: input.size,
      storageKey: `${universityId}/${STORAGE_AREA}/documents/${id}.${DOCUMENT_TYPES[contentType].ext}`,
      status: "uploading",
      uploadedBy: actor.userId || null,
    }),
  );
  return { documentId: id, parts: partsFor(input.size), partBytes: PART_BYTES };
}

async function uploading(actor: Actor, documentId: string) {
  if (!isUuid(documentId)) throw new NotFoundError("Document");
  const [doc] = await withTenant(actor, (tx) => tx.select().from(onbDocuments).where(eq(onbDocuments.id, documentId)));
  if (!doc) throw new NotFoundError("Document");
  if (doc.status !== "uploading") throw new ConflictError("This file has already been uploaded.");
  if (doc.uploadedBy && doc.uploadedBy !== actor.userId) throw new ForbiddenError("Only the person who started this upload can finish it.");
  return doc;
}

export async function putDocumentPart(actor: Actor, documentId: string, index: number, body: Uint8Array) {
  assertManage(actor);
  const doc = await uploading(actor, documentId);
  const parts = partsFor(doc.sizeBytes);
  if (!Number.isInteger(index) || index < 0 || index >= parts) throw new ValidationError("That part of the file isn't expected.");
  const expected = index < parts - 1 ? PART_BYTES : doc.sizeBytes - PART_BYTES * (parts - 1);
  if (body.byteLength !== expected) throw new ValidationError("Part of the file went missing on the way. Try uploading it again.");
  await storage().put({ key: partKey(doc.universityId, doc.id, index), body, contentType: "application/octet-stream" });
}

export async function finishDocumentUpload(actor: Actor, documentId: string): Promise<DocumentRow> {
  assertManage(actor);
  const doc = await uploading(actor, documentId);
  const parts = partsFor(doc.sizeBytes);
  const chunks: Buffer[] = [];
  for (let i = 0; i < parts; i++) {
    const part = await storage().get(partKey(doc.universityId, doc.id, i));
    if (!part) throw new ValidationError("Part of the file went missing on the way. Try uploading it again.");
    chunks.push(Buffer.from(part.body));
  }
  const body = Buffer.concat(chunks);
  if (body.byteLength !== doc.sizeBytes) throw new ValidationError("Part of the file went missing on the way. Try uploading it again.");
  const real = sniffType(body);
  if (!real) throw new ValidationError(`${doc.fileName} isn't really a PDF, JPG or PNG. Save it as one of those and try again.`);
  await storage().put({ key: doc.storageKey, body, contentType: real });
  for (let i = 0; i < parts; i++) await storage().delete(partKey(doc.universityId, doc.id, i)).catch(() => undefined);

  return withTenant(actor, async (tx) => {
    const now = new Date();
    if (!MULTIPLE.has(doc.kind)) {
      await tx
        .update(onbDocuments)
        .set({ supersededAt: now })
        .where(and(eq(onbDocuments.kind, doc.kind), isNull(onbDocuments.supersededAt), ne(onbDocuments.id, doc.id), ne(onbDocuments.status, "uploading")));
    }
    const [row] = await tx.update(onbDocuments).set({ status: "pending", contentType: real }).where(eq(onbDocuments.id, doc.id)).returning();
    await audit(tx, actor, "onboarding.document.upload", "onb_document", doc.id, { kind: doc.kind, fileName: doc.fileName, sizeBytes: doc.sizeBytes });
    return row;
  });
}

/** Takes an optional document off the institute's file (kept, marked superseded). The PAN card can only be replaced. */
export async function removeDocument(actor: Actor, documentId: string) {
  assertManage(actor);
  if (!isUuid(documentId)) throw new NotFoundError("Document");
  return withTenant(actor, async (tx) => {
    const [doc] = await tx.select().from(onbDocuments).where(eq(onbDocuments.id, documentId)).for("update");
    if (!doc || doc.supersededAt) throw new NotFoundError("Document");
    if (doc.kind === "pan") throw new ValidationError("Your PAN card is required, so it can't be removed. Upload a new one to replace it.");
    await tx.update(onbDocuments).set({ supersededAt: new Date() }).where(eq(onbDocuments.id, doc.id));
    await audit(tx, actor, "onboarding.document.remove", "onb_document", doc.id, { kind: doc.kind, fileName: doc.fileName });
    return `${DOCUMENT_LABEL[doc.kind]} removed.`;
  });
}

/** A link that opens the file for two minutes. The download is named after the document. */
export async function documentLink(actor: Actor, documentId: string): Promise<string> {
  assertManage(actor);
  if (!isUuid(documentId)) throw new NotFoundError("Document");
  const [doc] = await withTenant(actor, (tx) => tx.select().from(onbDocuments).where(eq(onbDocuments.id, documentId)));
  if (!doc || doc.status === "uploading") throw new NotFoundError("Document");
  return storage().signedUrl(doc.storageKey, 120, { downloadName: doc.fileName });
}

/** Whether a PAN card is on file and not rejected: what the trial and the plan checkout need. */
export function hasUsablePan(docs: Pick<DocumentRow, "kind" | "status">[]) {
  return docs.some((d) => d.kind === "pan" && (d.status === "pending" || d.status === "approved"));
}
