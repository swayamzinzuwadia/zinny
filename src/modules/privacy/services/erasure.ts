/**
 * Erasure (Act s.12(3), s.8(7)) and the data export (s.11).
 *
 * Erasing a person anonymises their personal fields and deletes their KYC data. It keeps what
 * the law requires: GST invoices (8 years, CGST Act s.35 and 36), the orders behind them, and
 * the consent and request log (Rule 8(3), at least a year). The person is told so.
 *
 * Contract note: the person's identity (`users`, a core table) and their KYC
 * (`onb_student_kyc`, the onboarding module's) have no core API or event for erasure yet, so
 * this file is the one place that changes them, under the institute's row-level security.
 * docs/handoff/privacy.md asks for `anonymiseUser` in the core API and an erasure event.
 */
import { and, count, desc, eq, gt, inArray, isNull, ne, or } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { courses, enrolments, invoices, orders, roleAssignments, universities, users } from "@/db/schema";
import { withTenant, type Actor } from "@/server/core";
import { onbStudentKyc } from "@/modules/onboarding/schema";
import { dpdpConsents, dpdpRequests } from "../schema";
import { INVOICE_RETENTION_YEARS, NOTICE_VERSION } from "../lib/rules";
import { selfOf, todayOf } from "./access";
import { withdrawAllIn } from "./consents";
import { minorState } from "./children";
import { zinny, zinnyAudit, zinnyTx } from "./system";

export const ERASED_NAME = "Erased user";
export const erasedEmail = (userId: string) => `erased+${userId}@erased.invalid`;

export type ErasureResult = { anonymised: boolean; kycDeleted: number; rolesEnded: number; consentsWithdrawn: number; invoicesKept: number };

/** What we tell the person when their erasure is done. */
export function erasureMessage(r: ErasureResult): string {
  const parts = [
    r.anonymised ? "Your name, email address, mobile number and password have been removed." : "This institute no longer holds your details; your Zinny sign-in stays for your other institutes.",
    r.kycDeleted ? "Your KYC details (PAN and Aadhaar digits) have been deleted." : null,
    r.invoicesKept
      ? `We kept ${r.invoicesKept} GST ${r.invoicesKept === 1 ? "invoice" : "invoices"} with the name and email printed on ${r.invoicesKept === 1 ? "it" : "them"}, because tax law requires invoices to be kept for ${INVOICE_RETENTION_YEARS} years.`
      : null,
    "We keep a record of your consents and this request for at least a year, as the DPDP Rules require.",
  ];
  return parts.filter(Boolean).join(" ");
}

/** Active roles the person holds anywhere other than `exceptUniversityId` (system read, their own rows). */
async function otherTies(userId: string, exceptUniversityId: string | null): Promise<number> {
  const now = new Date();
  const [r] = await zinny()
    .select({ n: count() })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        isNull(roleAssignments.revokedAt),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
        exceptUniversityId ? or(isNull(roleAssignments.universityId), ne(roleAssignments.universityId, exceptUniversityId)) : undefined,
      ),
    );
  return r?.n ?? 0;
}

async function anonymise(tx: Tx, userId: string) {
  await tx.update(users).set({ name: ERASED_NAME, email: erasedEmail(userId), phone: null, passwordHash: null }).where(eq(users.id, userId));
}

async function invoicesOf(tx: Tx, userId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(invoices).innerJoin(orders, eq(orders.id, invoices.orderId)).where(eq(orders.userId, userId));
  return r?.n ?? 0;
}

/**
 * Erases a person from an institute. `tx` is the institute's withTenant transaction; the
 * caller has checked `privacy.manage` (or is the retention job's system actor).
 */
export async function eraseInInstitute(tx: Tx, actor: Actor, userId: string, now = new Date()): Promise<ErasureResult> {
  const universityId = actor.universityId!;
  const keepIdentity = (await otherTies(userId, universityId)) > 0;
  const kyc = await tx.delete(onbStudentKyc).where(eq(onbStudentKyc.userId, userId)).returning({ id: onbStudentKyc.id });
  const consents = await withdrawAllIn(tx, userId, universityId, now);
  const roles = await tx
    .update(roleAssignments)
    .set({ revokedAt: now })
    .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.universityId, universityId), isNull(roleAssignments.revokedAt)))
    .returning({ id: roleAssignments.id });
  if (!keepIdentity) await anonymise(tx, userId);
  const result: ErasureResult = { anonymised: !keepIdentity, kycDeleted: kyc.length, rolesEnded: roles.length, consentsWithdrawn: consents.length, invoicesKept: await invoicesOf(tx, userId) };
  await zinnyAudit(tx, actor, universityId, "privacy.erasure.complete", "users", userId, result);
  return result;
}

/** Erases what Zinny itself holds (a marketplace learner or a sign-up), in a system transaction. The caller checked the platform permission. */
export async function eraseOnZinny(tx: Tx, actor: Actor, userId: string, now = new Date()): Promise<ErasureResult> {
  const keepIdentity = (await otherTies(userId, null)) > 0;
  const consents = await withdrawAllIn(tx, userId, null, now);
  if (!keepIdentity) await anonymise(tx, userId);
  const result: ErasureResult = { anonymised: !keepIdentity, kycDeleted: 0, rolesEnded: 0, consentsWithdrawn: consents.length, invoicesKept: await invoicesOf(tx, userId) };
  await zinnyAudit(tx, actor, null, "privacy.erasure.complete", "users", userId, result);
  return result;
}

/* ─────────────────────────── Export ─────────────────────────── */

export type DataExport = Awaited<ReturnType<typeof exportMyData>>;

/**
 * A copy of the person's data, as JSON: profile, roles, enrolments, orders and invoices, KYC
 * status with the PAN masked (never the PAN itself), consents and requests. Inside an
 * institute it is what that institute holds; outside one, what Zinny holds across the
 * marketplace. Each download is logged as a completed access request.
 */
export async function exportMyData(actor: Actor, now = new Date()) {
  const me = selfOf(actor);
  const collect = async (tx: Tx) => {
    const [profile] = await tx.select({ name: users.name, email: users.email, phone: users.phone, createdAt: users.createdAt }).from(users).where(eq(users.id, me.userId));
    const roles = await tx
      .select({ role: roleAssignments.role, scope: roleAssignments.scopeType, institute: universities.name, startsAt: roleAssignments.startsAt, endsAt: roleAssignments.endsAt, revokedAt: roleAssignments.revokedAt })
      .from(roleAssignments)
      .leftJoin(universities, eq(universities.id, roleAssignments.universityId))
      .where(and(eq(roleAssignments.userId, me.userId), me.universityId ? eq(roleAssignments.universityId, me.universityId) : undefined));
    const enrols = await tx
      .select({ course: courses.title, institute: universities.name, status: enrolments.status, enrolledAt: enrolments.enrolledAt })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .innerJoin(universities, eq(universities.id, enrolments.universityId))
      .where(eq(enrolments.userId, me.userId))
      .orderBy(desc(enrolments.createdAt));
    const orderRows = await tx
      .select({
        course: courses.title,
        institute: universities.name,
        status: orders.status,
        totalPaise: orders.totalPaise,
        paidAt: orders.paidAt,
        invoiceNumber: invoices.number,
      })
      .from(orders)
      .innerJoin(courses, eq(courses.id, orders.courseId))
      .innerJoin(universities, eq(universities.id, orders.universityId))
      .leftJoin(invoices, eq(invoices.orderId, orders.id))
      .where(eq(orders.userId, me.userId))
      .orderBy(desc(orders.createdAt));
    const kycRows = await tx
      .select({ institute: universities.name, panMasked: onbStudentKyc.panMasked, aadhaarLast4: onbStudentKyc.aadhaarLast4, consentAt: onbStudentKyc.consentAt, noticeVersion: onbStudentKyc.consentNoticeVersion })
      .from(onbStudentKyc)
      .innerJoin(universities, eq(universities.id, onbStudentKyc.universityId))
      .where(eq(onbStudentKyc.userId, me.userId));
    const consentRows = await tx
      .select({ purpose: dpdpConsents.purpose, noticeVersion: dpdpConsents.noticeVersion, grantedAt: dpdpConsents.grantedAt, withdrawnAt: dpdpConsents.withdrawnAt, source: dpdpConsents.source })
      .from(dpdpConsents)
      .where(and(eq(dpdpConsents.userId, me.userId), me.universityId ? eq(dpdpConsents.universityId, me.universityId) : isNull(dpdpConsents.universityId)));
    const requestRows = await tx
      .select({ kind: dpdpRequests.kind, status: dpdpRequests.status, details: dpdpRequests.details, dueOn: dpdpRequests.dueOn, response: dpdpRequests.response, createdAt: dpdpRequests.createdAt })
      .from(dpdpRequests)
      .where(and(eq(dpdpRequests.userId, me.userId), me.universityId ? eq(dpdpRequests.universityId, me.universityId) : isNull(dpdpRequests.universityId)));

    // Downloading is itself an access request, answered on the spot.
    const today = await todayOf(me.universityId ? tx : null);
    const [logged] = await tx
      .insert(dpdpRequests)
      .values({ universityId: me.universityId, userId: me.userId, kind: "access", status: "completed", details: "Downloaded a copy of my data.", dueOn: today, closedAt: now, response: "Downloaded." })
      .returning({ id: dpdpRequests.id });
    await zinnyAudit(tx, actor, me.universityId, "privacy.export", "dpdp_requests", logged.id, {});

    return {
      format: "zinny-personal-data/1",
      generatedAt: now.toISOString(),
      dataFiduciary: me.universityId ? (await tx.select({ name: universities.name }).from(universities).where(eq(universities.id, me.universityId)))[0]?.name : "Zinny",
      noticeVersion: NOTICE_VERSION,
      profile,
      roles,
      enrolments: enrols,
      orders: orderRows.map((o) => ({ ...o, total: `₹${(o.totalPaise / 100).toFixed(2)}` })),
      kyc: kycRows.length
        ? kycRows.map((k) => ({ status: "on file", institute: k.institute, pan: k.panMasked, aadhaarLast4: k.aadhaarLast4, consentAt: k.consentAt, noticeVersion: k.noticeVersion }))
        : [{ status: "not given" }],
      consents: consentRows,
      requests: requestRows,
    };
  };
  const data = me.universityId ? await withTenant(actor, collect) : await zinnyTx(collect);
  const minor = await minorState(me.userId);
  return { ...data, age: minor.minor ? { under18: true, guardianConsent: minor.verified ? "given" : "waiting" } : { under18: false } };
}

/** Used by the request handlers to show who asked. */
export async function peopleNames(tx: Tx, ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; email: string }>();
  const rows = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, { name: r.name, email: r.email }]));
}
