/**
 * The public verify page's look-up (brief item 5): no sign-in, rate-limited, exact code only.
 *
 * The visitor has no university, so, as the brief allows for this route alone, the
 * certificate's university is found with systemDb(), selecting only university_id for one
 * exact code. Everything else is read under that university's row-level security as its
 * system actor, and only the listed fields leave this function: student name, course,
 * institute, issue date and status.
 */
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { systemActorFor, universityLite, withTenant } from "@/server/core";
import { dateIn, effectiveStatus, formatCode, normalizeCode, type EffectiveStatus } from "../lib";
import { clientKey, verifyLimits } from "../rate-limit";
import { certCertificates } from "../schema";

export type VerifiedCertificate = {
  code: string;
  studentName: string;
  courseTitle: string;
  institute: string;
  issuedOn: string;
  status: EffectiveStatus;
};

export type VerifyOutcome = { kind: "found"; certificate: VerifiedCertificate } | { kind: "not_found"; code: string } | { kind: "limited"; retryAfterSeconds: number };

/** Looks up one certificate by its exact code. Null when there is no such certificate. */
export async function lookupCertificate(input: string): Promise<VerifiedCertificate | null> {
  const code = normalizeCode(input);
  if (!code) return null;
  const [hit] = await systemDb()
    .select({ universityId: certCertificates.universityId })
    .from(certCertificates)
    .where(eq(certCertificates.code, code))
    .limit(1);
  if (!hit) return null;
  return withTenant(systemActorFor(hit.universityId), async (tx) => {
    const [c] = await tx
      .select({
        studentName: certCertificates.studentName,
        courseTitle: certCertificates.courseTitle,
        universityName: certCertificates.universityName,
        issuedOn: certCertificates.issuedOn,
        status: certCertificates.status,
        validUntil: certCertificates.validUntil,
      })
      .from(certCertificates)
      .where(eq(certCertificates.code, code));
    if (!c) return null;
    const { timezone } = await universityLite(tx);
    return {
      code: formatCode(code),
      studentName: c.studentName,
      courseTitle: c.courseTitle,
      institute: c.universityName,
      issuedOn: c.issuedOn,
      status: effectiveStatus(c, dateIn(timezone)),
    };
  });
}

/** The verify page: rate-limited per visitor, with a tighter limit on codes that don't exist. */
export async function verifyForVisitor(input: string, headers: { get(name: string): string | null }): Promise<VerifyOutcome> {
  const who = clientKey(headers);
  const misses = verifyLimits.misses.blocked(who);
  if (misses.blocked) return { kind: "limited", retryAfterSeconds: misses.retryAfterSeconds };
  const take = verifyLimits.lookups.take(who);
  if (!take.ok) return { kind: "limited", retryAfterSeconds: take.retryAfterSeconds };
  const certificate = await lookupCertificate(input);
  if (certificate) return { kind: "found", certificate };
  verifyLimits.misses.take(who);
  return { kind: "not_found", code: String(input).slice(0, 40) };
}
