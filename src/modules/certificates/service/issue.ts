/**
 * Issuing and revoking certificates (brief items 3, 4 and 9).
 *
 * - Automatic: `enrolment.completed` → one certificate per enrolment, only when the
 *   course has certificates turned on and its rule issues automatically. Idempotent: a
 *   second delivery of the same event (or of any completion of the same enrolment) finds
 *   the certificate and does nothing; two racing deliveries are settled by a unique index.
 * - Manual (cert.issue, with a reason): the first certificate for an enrolment, a renewal
 *   when the last one has expired or is about to, or a new one after a revoked one.
 *   Each later certificate points at the one it follows, so the chain stays one per enrolment.
 * - Revoke (cert.issue, with a reason): the verify page then shows the certificate as revoked.
 *
 * The PDF is generated once at issue, stored through storage() under the certificate's id,
 * and never regenerated; its SHA-256 is kept so it can be checked later.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { DomainEvent } from "@/contracts/events";
import {
  assertCan,
  audit,
  emit,
  enrolmentById,
  getCourseLite,
  notify,
  peopleLite,
  storage,
  todayFor,
  universityLite,
  withTenant,
  type Actor,
  type CourseLite,
  type EnrolmentLite,
} from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { addDays, dateIn, effectiveStatus, formatCode, isIsoDate, newCode, shortDate, validUntilFor, verifyUrl } from "../lib";
import { renderCertificatePdf } from "../render";
import { certCertificates, type TemplateSnapshot } from "../schema";
import { buildContent } from "./content";
import { effectiveRule } from "./rules";
import { certificateTarget, isUniqueViolation, trimmed, uni } from "./shared";
import { snapshotOf, type Template } from "./templates";

export type Certificate = typeof certCertificates.$inferSelect;

/** Enrolment statuses that can carry a certificate: learning, finished, or ended at graduation. */
const CERTIFIABLE = new Set(["active", "completed", "ended"]);

/** A renewal opens this many days before expiry (or the course's reminder window, if longer). */
export const RENEWAL_WINDOW_DAYS = 90;

type CreateInput = {
  enrolment: EnrolmentLite;
  course: CourseLite;
  template: Template;
  validityMonths: number | null;
  source: "automatic" | "manual";
  completedOn: string;
  replacesId: string | null;
  sourceEventId: string | null;
  issueReason: string | null;
};

/**
 * Renders, stores and records one certificate, then emits certificate.issued and tells the
 * student. Returns null when the enrolment already has its first certificate (the insert
 * is skipped by the unique index, so nothing is stored or sent).
 */
async function createCertificate(tx: Tx, actor: Actor, input: CreateInput): Promise<Certificate | null> {
  const university = await universityLite(tx);
  const [student] = await peopleLite(tx, [input.enrolment.userId]);
  if (!student) throw new NotFoundError("Student");
  const issuedOn = await todayFor(tx);
  const id = randomUUID();
  const code = newCode();
  const validUntil = validUntilFor(issuedOn, input.validityMonths);
  const snapshot: TemplateSnapshot = snapshotOf(input.template, university.branding.primaryColor);
  const content = await buildContent(snapshot, {
    universityName: university.name,
    logoUrl: university.branding.logoUrl,
    studentName: student.name,
    courseTitle: input.course.title,
    completedOn: input.completedOn,
    validUntil,
    code,
    verifyUrl: verifyUrl(code),
  });
  const pdf = await renderCertificatePdf(content);
  const pdfKey = `${university.id}/certificates/issued/${id}/certificate-${code}.pdf`;

  const insert = tx.insert(certCertificates).values({
    id,
    universityId: university.id,
    code,
    userId: input.enrolment.userId,
    enrolmentId: input.enrolment.enrolmentId,
    courseId: input.course.id,
    batchId: input.enrolment.batchId,
    departmentId: input.course.departmentId,
    templateId: input.template.id,
    replacesId: input.replacesId,
    source: input.source,
    studentName: student.name,
    courseTitle: input.course.title,
    universityName: university.name,
    template: snapshot,
    completedOn: input.completedOn,
    issuedOn,
    validUntil,
    pdfKey,
    pdfSha256: createHash("sha256").update(pdf).digest("hex"),
    pdfBytes: pdf.length,
    sourceEventId: input.sourceEventId,
    issuedBy: input.source === "manual" ? actor.userId || null : null,
    issueReason: input.issueReason,
  });
  const rows =
    input.replacesId === null
      ? await insert.onConflictDoNothing({ target: certCertificates.enrolmentId, where: sql`${certCertificates.replacesId} is null` }).returning()
      : await insert.returning();
  const cert = rows[0];
  if (!cert) return null;

  // Stored only once the row is ours; if anything below fails, the transaction rolls back
  // and the orphaned file (named after an id that never existed) is harmless.
  await storage().put({ key: pdfKey, body: pdf, contentType: "application/pdf" });
  await emit(tx, actor, "certificate.issued", { certificateId: id, userId: cert.userId, courseId: cert.courseId, code });
  await notify(tx, university.id, [cert.userId], {
    kind: "certificate.issued",
    title: input.replacesId ? `Your new certificate for ${input.course.title} is ready` : `Your certificate for ${input.course.title} is ready`,
    body: validUntil
      ? `Download it or share its link from My learning. It is valid until ${shortDate(validUntil)}.`
      : "Download it or share its link from My learning.",
    data: { certificateId: id, courseId: cert.courseId, code: formatCode(code), path: `/${university.slug}/learn/certificates` },
  });
  await audit(tx, actor, "certificate.issue", "certificate", id, {
    code,
    source: input.source,
    enrolmentId: cert.enrolmentId,
    courseId: cert.courseId,
    userId: cert.userId,
    template: input.template.name,
    validUntil,
    replacesId: input.replacesId,
    reason: input.issueReason,
    sourceEventId: input.sourceEventId,
  });
  return cert;
}

export type AutoIssueResult = { status: "issued"; certificateId: string; code: string } | { status: "exists" | "disabled" | "manual_only" | "not_certifiable" };

/** The enrolment.completed handler's work, inside the event's tenant transaction. */
export async function issueOnCompletion(tx: Tx, actor: Actor, event: DomainEvent<"enrolment.completed">): Promise<AutoIssueResult> {
  const { enrolmentId, courseId } = event.payload;
  const [existing] = await tx.select({ id: certCertificates.id }).from(certCertificates).where(eq(certCertificates.enrolmentId, enrolmentId)).limit(1);
  if (existing) return { status: "exists" };

  const course = await getCourseLite(tx, courseId);
  if (!course.certificateEnabled) return { status: "disabled" };
  const enrolment = await enrolmentById(tx, enrolmentId);
  if (!CERTIFIABLE.has(enrolment.status)) return { status: "not_certifiable" };
  assertCan(actor, "cert.issue", { universityId: uni(actor), departmentIds: [course.departmentId], batchIds: [enrolment.batchId] });

  const rule = await effectiveRule(tx, actor, courseId);
  if (!rule.autoIssue) return { status: "manual_only" };

  const university = await universityLite(tx);
  const cert = await createCertificate(tx, actor, {
    enrolment,
    course,
    template: rule.template,
    validityMonths: rule.validityMonths,
    source: "automatic",
    completedOn: dateIn(university.timezone, new Date(event.occurredAt)),
    replacesId: null,
    sourceEventId: event.id,
    issueReason: null,
  });
  return cert ? { status: "issued", certificateId: cert.id, code: cert.code } : { status: "exists" };
}

/** The newest certificate in an enrolment's chain (the one nothing replaces). */
export function chainTip<T extends { id: string; replacesId: string | null }>(chain: T[]): T | null {
  const replaced = new Set(chain.map((c) => c.replacesId).filter(Boolean));
  return chain.find((c) => !replaced.has(c.id)) ?? null;
}

export type IssueInput = { enrolmentId: string; reason: string; completedOn?: string };

function cleanReason(reason: string, what: string) {
  const r = trimmed(reason);
  if (r.length < 5) throw new ValidationError(`Give a reason for ${what}, so the record shows why.`);
  if (r.length > 500) throw new ValidationError("Keep the reason to 500 characters or fewer.");
  return r;
}

/** Issues a certificate by hand (cert.issue). */
export async function issueCertificate(actor: Actor, input: IssueInput): Promise<Certificate> {
  const reason = cleanReason(input.reason, "issuing it by hand");
  try {
    return await withTenant(actor, async (tx) => {
      const enrolment = await enrolmentById(tx, input.enrolmentId);
      const course = await getCourseLite(tx, enrolment.courseId);
      assertCan(actor, "cert.issue", { universityId: uni(actor), departmentIds: [course.departmentId], batchIds: [enrolment.batchId] });
      if (!course.certificateEnabled) {
        throw new ConflictError("Certificates are turned off for this course. Turn on “Issue a certificate on completion” in the course settings first.", "disabled");
      }
      if (!CERTIFIABLE.has(enrolment.status)) throw new ConflictError("This enrolment isn't confirmed, so it can't have a certificate.", "not_certifiable");

      const today = await todayFor(tx);
      const completedOn = input.completedOn?.trim() || today;
      if (!isIsoDate(completedOn)) throw new ValidationError("Enter the completion date as a date.");
      if (completedOn > today) throw new ValidationError("The completion date can't be in the future.");
      if (completedOn < "2000-01-01") throw new ValidationError("Check the completion date: it is too far in the past.");

      const rule = await effectiveRule(tx, actor, course.id);
      const chain = await tx.select().from(certCertificates).where(eq(certCertificates.enrolmentId, enrolment.enrolmentId)).for("update");
      const tip = chainTip(chain);
      if (tip) {
        const status = effectiveStatus(tip, today);
        if (status === "valid" && !tip.validUntil) {
          throw new ConflictError(`${tip.studentName} already has a valid certificate for this course (${formatCode(tip.code)}). Revoke it first if a new one is needed.`, "has_valid");
        }
        if (status === "valid" && tip.validUntil) {
          const opens = addDays(tip.validUntil, -Math.max(RENEWAL_WINDOW_DAYS, rule.reminderDays ?? 0));
          if (today < opens) {
            throw new ConflictError(`${tip.studentName}'s certificate is valid until ${shortDate(tip.validUntil)}. You can renew it from ${shortDate(opens)}.`, "too_early");
          }
        }
      }

      const cert = await createCertificate(tx, actor, {
        enrolment,
        course,
        template: rule.template,
        validityMonths: rule.validityMonths,
        source: "manual",
        completedOn,
        replacesId: tip?.id ?? null,
        sourceEventId: null,
        issueReason: reason,
      });
      if (!cert) throw new ConflictError("A certificate was issued for this student a moment ago. Refresh to see it.", "exists");
      return cert;
    });
  } catch (e) {
    if (isUniqueViolation(e, "cert_certificates_one_per_enrolment") || isUniqueViolation(e, "cert_certificates_replaced_once")) {
      throw new ConflictError("A certificate was issued for this student a moment ago. Refresh to see it.", "exists");
    }
    throw e;
  }
}

/** Revokes a certificate (cert.issue). It stays on record and the verify page shows it as revoked. */
export async function revokeCertificate(actor: Actor, certificateId: string, reason: string): Promise<Certificate> {
  const why = cleanReason(reason, "revoking it");
  return withTenant(actor, async (tx) => {
    const [c] = await tx.select().from(certCertificates).where(eq(certCertificates.id, certificateId)).for("update");
    if (!c) throw new NotFoundError("Certificate");
    assertCan(actor, "cert.issue", certificateTarget(c));
    if (c.status === "revoked") throw new ConflictError("This certificate is already revoked.", "revoked");
    const [updated] = await tx
      .update(certCertificates)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy: actor.userId || null, revokeReason: why })
      .where(eq(certCertificates.id, certificateId))
      .returning();
    const university = await universityLite(tx);
    await notify(tx, university.id, [c.userId], {
      kind: "certificate.revoked",
      title: `Your certificate for ${c.courseTitle} has been revoked`,
      body: "Its link now shows it as revoked. Contact your institute if you have questions.",
      data: { certificateId: c.id, courseId: c.courseId, code: formatCode(c.code), path: `/${university.slug}/learn/certificates` },
    });
    await audit(tx, actor, "certificate.revoke", "certificate", c.id, { code: c.code, reason: why, userId: c.userId, courseId: c.courseId });
    return updated;
  });
}
