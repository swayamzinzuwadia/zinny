/**
 * Student KYC, the safe version: the PAN (stored encrypted, shown masked), only the last 4
 * digits of the Aadhaar (the full number is refused and never stored), and the student's
 * consent with its time and the notice version. Optional at sign-up; each student fills in
 * their own (self.profile on their own record), at each institute they study with.
 */
import { and, eq } from "drizzle-orm";
import { assertCan, audit, withTenant, type Actor } from "@/server/core";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { KYC_NOTICE_VERSION } from "../lib/constants";
import { encryptSecret, isPan, maskPan, normalisePan } from "../lib/crypto";
import { onbStudentKyc } from "../schema";

export type KycStatus = { done: false } | { done: true; panMasked: string; aadhaarLast4: string | null; consentAt: Date; noticeVersion: string; updatedAt: Date };

function own(actor: Actor) {
  if (!actor.universityId || !actor.userId) throw new ForbiddenError("No institute selected.");
  assertCan(actor, "self.profile", { universityId: actor.universityId, ownerUserId: actor.userId });
  return { universityId: actor.universityId, userId: actor.userId };
}

/** The student's own KYC, masked. */
export async function kycStatus(actor: Actor): Promise<KycStatus> {
  const { userId } = own(actor);
  const [row] = await withTenant(actor, (tx) => tx.select().from(onbStudentKyc).where(eq(onbStudentKyc.userId, userId)));
  if (!row) return { done: false };
  return { done: true, panMasked: row.panMasked, aadhaarLast4: row.aadhaarLast4, consentAt: row.consentAt, noticeVersion: row.consentNoticeVersion, updatedAt: row.updatedAt };
}

/**
 * The Aadhaar field takes the last 4 digits only. Anything longer is refused with a reason,
 * so a full number is never sent on, logged or stored.
 */
export function checkAadhaarLast4(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, "");
  if (!digits) return null;
  if (!/^\d+$/.test(digits)) throw new ValidationError("Enter only the last 4 digits of your Aadhaar, like 1234.");
  if (digits.length !== 4) {
    throw new ValidationError("Enter only the last 4 digits of your Aadhaar. We never take or keep the full number.", digits.length === 12 ? "aadhaar_full" : "invalid");
  }
  return digits;
}

export type KycInput = { pan: string; aadhaarLast4: string; consent: boolean };

/** Saves or updates the student's KYC. Returns the masked PAN. */
export async function saveKyc(actor: Actor, input: KycInput, now = new Date()): Promise<string> {
  const { universityId, userId } = own(actor);
  const pan = normalisePan(input.pan);
  if (!isPan(pan)) throw new ValidationError("That PAN doesn't look right. It has 10 characters: 5 letters, 4 digits, then a letter, like ABCDE1234F.");
  const aadhaarLast4 = checkAadhaarLast4(input.aadhaarLast4);
  if (!input.consent) throw new ValidationError("Tick the box to agree that your institute may keep these details for KYC.");
  const panMasked = maskPan(pan);
  const values = { panCipher: encryptSecret(pan), panMasked, aadhaarLast4, consentAt: now, consentNoticeVersion: KYC_NOTICE_VERSION, updatedAt: now };
  await withTenant(actor, async (tx) => {
    const [before] = await tx.select({ id: onbStudentKyc.id }).from(onbStudentKyc).where(and(eq(onbStudentKyc.userId, userId)));
    const [row] = before
      ? await tx.update(onbStudentKyc).set(values).where(eq(onbStudentKyc.id, before.id)).returning()
      : await tx.insert(onbStudentKyc).values({ universityId, userId, ...values }).returning();
    // Never the PAN itself in the log: only the masked form.
    await audit(tx, actor, before ? "onboarding.kyc.update" : "onboarding.kyc.create", "onb_student_kyc", row.id, {
      panMasked,
      aadhaarLast4: aadhaarLast4 ? "given" : "not given",
      noticeVersion: KYC_NOTICE_VERSION,
    });
  });
  return panMasked;
}
