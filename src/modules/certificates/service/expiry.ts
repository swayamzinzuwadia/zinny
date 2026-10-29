/**
 * The daily expiry job (brief item 8), run once per university as its system actor:
 *   1. renewal reminders N days before a certificate expires (N from the course's rule),
 *      sent once per certificate;
 *   2. certificates past their last valid day are marked expired, and the student told.
 * Certificates that have already been renewed get neither message. Overlapping runs are
 * safe: each certificate is claimed with a conditional update, and locked rows are skipped.
 */
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { assertCan, audit, notify, todayFor, universityLite, withTenant, type Actor } from "@/server/core";
import { formatCode, shortDate } from "../lib";
import { certCertificates, certRules } from "../schema";
import { uni } from "./shared";

const notRenewed = sql`not exists (select 1 from ${certCertificates} as r where r.replaces_id = ${certCertificates.id})`;

export async function runExpiry(actor: Actor, opts: { today?: string } = {}): Promise<{ reminded: number; expired: number }> {
  assertCan(actor, "cert.issue", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const today = opts.today ?? (await todayFor(tx));
    const university = await universityLite(tx);
    const path = `/${university.slug}/learn/certificates`;

    const due = await tx
      .select({ id: certCertificates.id })
      .from(certCertificates)
      .innerJoin(certRules, eq(certRules.courseId, certCertificates.courseId))
      .where(
        and(
          eq(certCertificates.status, "valid"),
          isNotNull(certCertificates.validUntil),
          isNull(certCertificates.reminderSentAt),
          isNotNull(certRules.reminderDays),
          sql`${certCertificates.validUntil} >= ${today}::date`,
          sql`${certCertificates.validUntil} - ${certRules.reminderDays} <= ${today}::date`,
          notRenewed,
        ),
      )
      .for("update", { of: certCertificates, skipLocked: true });
    let reminded = 0;
    if (due.length) {
      const claimed = await tx
        .update(certCertificates)
        .set({ reminderSentAt: new Date() })
        .where(and(inArray(certCertificates.id, due.map((d) => d.id)), isNull(certCertificates.reminderSentAt)))
        .returning();
      for (const c of claimed) {
        await notify(tx, university.id, [c.userId], {
          kind: "certificate.expiring",
          title: `Your ${c.courseTitle} certificate expires on ${shortDate(c.validUntil!)}`,
          body: "Ask your institute how to renew it before then.",
          data: { certificateId: c.id, courseId: c.courseId, code: formatCode(c.code), validUntil: c.validUntil, path },
        });
        await audit(tx, actor, "certificate.remind", "certificate", c.id, { code: c.code, validUntil: c.validUntil });
      }
      reminded = claimed.length;
    }

    const lapsed = await tx
      .select({ id: certCertificates.id })
      .from(certCertificates)
      .where(and(eq(certCertificates.status, "valid"), isNotNull(certCertificates.validUntil), lt(certCertificates.validUntil, today)))
      .for("update", { skipLocked: true });
    let expired = 0;
    if (lapsed.length) {
      const marked = await tx
        .update(certCertificates)
        .set({ status: "expired", expiredAt: new Date() })
        .where(and(inArray(certCertificates.id, lapsed.map((l) => l.id)), eq(certCertificates.status, "valid")))
        .returning();
      const renewed = new Set(
        (
          await tx
            .select({ replacesId: certCertificates.replacesId })
            .from(certCertificates)
            .where(inArray(certCertificates.replacesId, marked.map((m) => m.id)))
        ).map((r) => r.replacesId),
      );
      for (const c of marked) {
        if (!renewed.has(c.id)) {
          await notify(tx, university.id, [c.userId], {
            kind: "certificate.expired",
            title: `Your ${c.courseTitle} certificate has expired`,
            body: `It was valid until ${shortDate(c.validUntil!)}. Ask your institute how to renew it.`,
            data: { certificateId: c.id, courseId: c.courseId, code: formatCode(c.code), path },
          });
        }
        await audit(tx, actor, "certificate.expire", "certificate", c.id, { code: c.code, validUntil: c.validUntil, renewed: renewed.has(c.id) });
      }
      expired = marked.length;
    }
    return { reminded, expired };
  });
}
