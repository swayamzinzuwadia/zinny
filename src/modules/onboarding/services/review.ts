/**
 * The Zinny team's view of self-signed institutes (/platform/signups): trial end date,
 * status and documents; approve or reject each document with a note; extend a trial.
 * Needs platform.manage_universities.
 *
 * Every read and write happens under row-level security as the institute it is about:
 * the list walks the institutes one by one (the Zinny team panel's university list says
 * which exist), and changes are made inside that institute and logged in its audit log
 * with the reviewer's name.
 */
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import { universities } from "@/db/schema";
import { assertPlatform, audit, storage, systemActorFor, todayIn, withTenant, type Actor } from "@/server/core";
import { addDays, daysBetween } from "@/server/lib/dates";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { setTrialState } from "@/server/services/core-api";
import { universityOptions } from "@/modules/zinny-team-panel/services/universities";
import { DOCUMENT_LABEL } from "../lib/constants";
import { onbDocuments, onbPlanOrders, onbSignups } from "../schema";

export type SignupDocument = Pick<
  typeof onbDocuments.$inferSelect,
  "id" | "kind" | "fileName" | "contentType" | "sizeBytes" | "status" | "reviewerNote" | "reviewedAt" | "createdAt"
>;

export type SignupRow = {
  universityId: string;
  name: string;
  slug: string;
  legalName: string | null;
  status: string;
  gstEnabled: boolean;
  gstin: string | null;
  stateCode: string;
  today: string;
  trialEndsAt: string | null;
  daysLeft: number | null;
  signup: typeof onbSignups.$inferSelect;
  documents: SignupDocument[];
  paidPlan: string | null;
};

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** The reviewer, working inside one institute: their own name and id in its audit log. */
const inside = (actor: Actor, universityId: string): Actor => ({ ...actor, universityId, supportSessionId: null });

async function signupOf(universityId: string, now: Date): Promise<SignupRow | null> {
  return withTenant(systemActorFor(universityId), async (tx) => {
    const [signup] = await tx.select().from(onbSignups).limit(1);
    if (!signup) return null;
    const [u] = await tx.select().from(universities).where(eq(universities.id, universityId));
    if (!u) return null;
    const documents = await tx
      .select({
        id: onbDocuments.id,
        kind: onbDocuments.kind,
        fileName: onbDocuments.fileName,
        contentType: onbDocuments.contentType,
        sizeBytes: onbDocuments.sizeBytes,
        status: onbDocuments.status,
        reviewerNote: onbDocuments.reviewerNote,
        reviewedAt: onbDocuments.reviewedAt,
        createdAt: onbDocuments.createdAt,
      })
      .from(onbDocuments)
      .where(and(isNull(onbDocuments.supersededAt), ne(onbDocuments.status, "uploading")))
      .orderBy(asc(onbDocuments.kind), desc(onbDocuments.createdAt));
    const [paid] = await tx.select({ planName: onbPlanOrders.planName }).from(onbPlanOrders).where(eq(onbPlanOrders.status, "paid")).orderBy(desc(onbPlanOrders.paidAt)).limit(1);
    const today = todayIn(u.timezone, now);
    return {
      universityId,
      name: u.name,
      slug: u.slug,
      legalName: u.legalName,
      status: u.status,
      gstEnabled: u.gstEnabled,
      gstin: u.gstin,
      stateCode: u.stateCode,
      today,
      trialEndsAt: u.trialEndsAt,
      daysLeft: u.trialEndsAt ? daysBetween(today, u.trialEndsAt) : null,
      signup,
      documents,
      paidPlan: paid?.planName ?? null,
    };
  });
}

/** Every self-signed institute, newest sign-up first. */
export async function listSignups(actor: Actor, now = new Date()): Promise<SignupRow[]> {
  assertPlatform(actor, "platform.manage_universities");
  const unis = await universityOptions(actor);
  const rows: SignupRow[] = [];
  // A few at a time: each is its own short transaction under that institute's row-level security.
  for (let i = 0; i < unis.length; i += 8) {
    const batch = await Promise.all(unis.slice(i, i + 8).map((u) => signupOf(u.id, now)));
    for (const r of batch) if (r) rows.push(r);
  }
  return rows.sort((a, b) => b.signup.createdAt.getTime() - a.signup.createdAt.getTime());
}

export type Decision = "approved" | "rejected";

/** Approves or rejects one document. A rejection needs a note that tells the institute what to send instead. */
export async function reviewDocument(actor: Actor, universityId: string, documentId: string, decision: Decision, note: string) {
  assertPlatform(actor, "platform.manage_universities");
  if (!isUuid(universityId) || !isUuid(documentId)) throw new NotFoundError("Document");
  if (decision !== "approved" && decision !== "rejected") throw new ValidationError("Approve or reject the document.");
  const why = note.trim();
  if (decision === "rejected" && why.length < 5) throw new ValidationError("Write what is wrong with the document, so the institute knows what to upload instead.");
  if (why.length > 500) throw new ValidationError("Keep the note under 500 characters.");
  const as = inside(actor, universityId);
  return withTenant(as, async (tx) => {
    const [doc] = await tx.select().from(onbDocuments).where(eq(onbDocuments.id, documentId)).for("update");
    if (!doc || doc.status === "uploading") throw new NotFoundError("Document");
    if (doc.supersededAt) throw new ConflictError("The institute has replaced this document since. Review the new one.");
    await tx
      .update(onbDocuments)
      .set({ status: decision, reviewerNote: why || null, reviewedBy: actor.userId || null, reviewedAt: new Date() })
      .where(eq(onbDocuments.id, doc.id));
    await audit(tx, as, decision === "approved" ? "onboarding.document.approve" : "onboarding.document.reject", "onb_document", doc.id, {
      kind: doc.kind,
      note: why || null,
      previous: doc.status,
    });
    return `${DOCUMENT_LABEL[doc.kind]} ${decision}.`;
  });
}

/** A link that opens one institute's document for two minutes, for the reviewer. */
export async function reviewDocumentLink(actor: Actor, universityId: string, documentId: string): Promise<string> {
  assertPlatform(actor, "platform.manage_universities");
  if (!isUuid(universityId) || !isUuid(documentId)) throw new NotFoundError("Document");
  const [doc] = await withTenant(inside(actor, universityId), (tx) => tx.select().from(onbDocuments).where(eq(onbDocuments.id, documentId)));
  if (!doc || doc.status === "uploading") throw new NotFoundError("Document");
  return storage().signedUrl(doc.storageKey, 120, { downloadName: doc.fileName });
}

/**
 * Gives an institute `days` more days of trial, counted from its current end date or from
 * today, whichever is later. A frozen institute is opened again.
 */
export async function extendTrial(actor: Actor, universityId: string, days: number, now = new Date()) {
  assertPlatform(actor, "platform.manage_universities");
  if (!isUuid(universityId)) throw new NotFoundError("Institute");
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new ValidationError("Extend the trial by 1 to 60 days.");
  const [u] = await withTenant(systemActorFor(universityId), (tx) => tx.select().from(universities).where(eq(universities.id, universityId)));
  if (!u) throw new NotFoundError("Institute");
  if (!u.trialEndsAt) throw new ValidationError("This institute was set up by the Zinny team, so it has no trial to extend.");
  if (u.status === "suspended") throw new ConflictError("This institute is suspended. Reactivate it on its institute page first.");
  const today = todayIn(u.timezone, now);
  const from = u.trialEndsAt > today ? u.trialEndsAt : today;
  const trialEndsAt = addDays(from, days);
  await setTrialState(actor, universityId, { trialEndsAt, ...(u.status === "frozen" ? { status: "active" as const } : {}) });
  await withTenant(inside(actor, universityId), (tx) => audit(tx, inside(actor, universityId), "onboarding.trial.extend", "university", universityId, { days, trialEndsAt }));
  return trialEndsAt;
}
