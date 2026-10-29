/**
 * Reading issued certificates: the course tab, the learner's own list, downloads,
 * previews and the dashboard count. Staff lists are narrowed with reach() (a HOD sees
 * their departments, faculty their own batches); learners see only their own.
 */
import { and, desc, eq, gte, ilike, inArray, isNotNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { enrolments } from "@/db/schema";
import { assertCan, can, courseTarget, getCourseLite, listCourseBatches, peopleLite, storage, todayFor, universityLite, withTenant, type Actor } from "@/server/core";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { addDays, downloadName, effectiveStatus, formatCode, monthStart, normalizeCode, verifyPath, verifyUrl, type EffectiveStatus } from "../lib";
import { renderCertificateSvg } from "../render";
import { certCertificates } from "../schema";
import { buildContent } from "./content";
import { RENEWAL_WINDOW_DAYS, chainTip, type Certificate } from "./issue";
import { effectiveRule } from "./rules";
import { certificateScope, certificateTarget, holdsAnywhere, uni } from "./shared";

export type CertificateView = {
  id: string;
  code: string;
  displayCode: string;
  verifyPath: string;
  userId: string;
  studentName: string;
  courseId: string;
  courseTitle: string;
  batchId: string;
  enrolmentId: string;
  completedOn: string;
  issuedOn: string;
  validUntil: string | null;
  status: EffectiveStatus;
  source: "automatic" | "manual";
  issueReason: string | null;
  revokeReason: string | null;
  replacesId: string | null;
  /** Set when a renewal or re-issue has followed this certificate. */
  replacedById: string | null;
  design: string;
};

/** Days before expiry at which a certificate counts as "expiring soon" on staff screens. */
export const EXPIRING_SOON_DAYS = 30;

function view(c: Certificate, today: string, replacedBy: Map<string, string>): CertificateView {
  return {
    id: c.id,
    code: c.code,
    displayCode: formatCode(c.code),
    verifyPath: verifyPath(c.code),
    userId: c.userId,
    studentName: c.studentName,
    courseId: c.courseId,
    courseTitle: c.courseTitle,
    batchId: c.batchId,
    enrolmentId: c.enrolmentId,
    completedOn: c.completedOn,
    issuedOn: c.issuedOn,
    validUntil: c.validUntil,
    status: effectiveStatus(c, today),
    source: c.source,
    issueReason: c.issueReason,
    revokeReason: c.revokeReason,
    replacesId: c.replacesId,
    replacedById: replacedBy.get(c.id) ?? null,
    design: c.template.design,
  };
}

function replacements(rows: Pick<Certificate, "id" | "replacesId">[]) {
  return new Map(rows.filter((r) => r.replacesId).map((r) => [r.replacesId!, r.id]));
}

const newestFirst = [desc(certCertificates.issuedOn), desc(certCertificates.createdAt)];

/* ─────────────────────────── Staff ─────────────────────────── */

export type CourseCertificates = {
  today: string;
  rows: (CertificateView & { batchName: string })[];
  counts: { valid: number; expired: number; revoked: number; expiringSoon: number };
};

export async function courseCertificates(actor: Actor, courseId: string): Promise<CourseCertificates> {
  return withTenant(actor, async (tx) => {
    assertCan(actor, "cert.view", await courseTarget(tx, uni(actor), courseId));
    const today = await todayFor(tx);
    const rows = await tx
      .select()
      .from(certCertificates)
      .where(and(eq(certCertificates.courseId, courseId), certificateScope(actor, "cert.view")))
      .orderBy(...newestFirst);
    const batches = new Map((await listCourseBatches(tx, courseId)).map((b) => [b.id, b.name]));
    const replaced = replacements(rows);
    const views = rows.map((r) => ({ ...view(r, today, replaced), batchName: batches.get(r.batchId) ?? "Removed batch" }));
    const soon = addDays(today, EXPIRING_SOON_DAYS);
    return {
      today,
      rows: views,
      counts: {
        valid: views.filter((v) => v.status === "valid").length,
        expired: views.filter((v) => v.status === "expired" && !v.replacedById).length,
        revoked: views.filter((v) => v.status === "revoked").length,
        expiringSoon: views.filter((v) => v.status === "valid" && v.validUntil && v.validUntil <= soon && !v.replacedById).length,
      },
    };
  });
}

export type Candidate = {
  enrolmentId: string;
  name: string;
  email: string;
  batchName: string;
  enrolmentStatus: string;
  /** What issuing would do now, or why it can't. */
  action: "issue" | "renew" | "reissue" | "none";
  note: string | null;
};

/** Students of a course who could get a certificate by hand (cert.issue), with what issuing would do. */
export async function issueCandidates(actor: Actor, courseId: string): Promise<Candidate[]> {
  return withTenant(actor, async (tx) => {
    assertCan(actor, "cert.issue", await courseTarget(tx, uni(actor), courseId));
    const today = await todayFor(tx);
    const rule = await effectiveRule(tx, actor, courseId);
    const rows = await tx
      .select({ enrolmentId: enrolments.id, userId: enrolments.userId, batchId: enrolments.batchId, status: enrolments.status })
      .from(enrolments)
      .where(and(eq(enrolments.courseId, courseId), inArray(enrolments.status, ["active", "completed", "ended"])));
    if (rows.length === 0) return [];
    const people = new Map((await peopleLite(tx, rows.map((r) => r.userId))).map((p) => [p.id, p]));
    const batches = new Map((await listCourseBatches(tx, courseId)).map((b) => [b.id, b.name]));
    const certs = await tx.select().from(certCertificates).where(inArray(certCertificates.enrolmentId, rows.map((r) => r.enrolmentId)));
    const window = Math.max(RENEWAL_WINDOW_DAYS, rule.reminderDays ?? 0);
    return rows
      .flatMap((r) => {
        const p = people.get(r.userId);
        if (!p) return [];
        const tip = chainTip(certs.filter((c) => c.enrolmentId === r.enrolmentId));
        let action: Candidate["action"] = "issue";
        let note: string | null = null;
        if (tip) {
          const st = effectiveStatus(tip, today);
          if (st === "revoked") action = "reissue";
          else if (st === "expired") action = "renew";
          else if (!tip.validUntil) {
            action = "none";
            note = "Has a valid certificate";
          } else if (today >= addDays(tip.validUntil, -window)) action = "renew";
          else {
            action = "none";
            note = `Valid until ${tip.validUntil}`;
          }
        }
        return [{ enrolmentId: r.enrolmentId, name: p.name, email: p.email, batchName: batches.get(r.batchId) ?? "", enrolmentStatus: r.status, action, note }];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}

export type SearchFilters = { q?: string; status?: EffectiveStatus | "all"; limit?: number };

/** Issued certificates across the university, within the actor's reach, newest first. */
export async function searchCertificates(actor: Actor, f: SearchFilters = {}): Promise<{ today: string; rows: CertificateView[] }> {
  if (!holdsAnywhere(actor, "cert.view")) throw new ForbiddenError();
  return withTenant(actor, async (tx) => {
    const today = await todayFor(tx);
    const where: (SQL | undefined)[] = [certificateScope(actor, "cert.view")];
    const q = (f.q ?? "").trim();
    if (q) {
      const code = normalizeCode(q);
      const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      const compact = q.toUpperCase().replace(/[\s-]/g, "");
      where.push(
        or(
          ilike(certCertificates.studentName, like),
          ilike(certCertificates.courseTitle, like),
          code ? eq(certCertificates.code, code) : /^[0-9A-Z]{3,12}$/.test(compact) ? sql`${certCertificates.code} like ${`${compact}%`}` : undefined,
        ),
      );
    }
    if (f.status === "revoked") where.push(eq(certCertificates.status, "revoked"));
    if (f.status === "expired") where.push(sql`${certCertificates.status} <> 'revoked'`, or(eq(certCertificates.status, "expired"), lt(certCertificates.validUntil, today)));
    if (f.status === "valid") where.push(eq(certCertificates.status, "valid"), or(sql`${certCertificates.validUntil} is null`, gte(certCertificates.validUntil, today)));
    const rows = await tx
      .select()
      .from(certCertificates)
      .where(and(...where))
      .orderBy(...newestFirst)
      .limit(Math.min(f.limit ?? 50, 200));
    const replaced = rows.length
      ? replacements(await tx.select({ id: certCertificates.id, replacesId: certCertificates.replacesId }).from(certCertificates).where(inArray(certCertificates.replacesId, rows.map((r) => r.id))))
      : new Map<string, string>();
    return { today, rows: rows.map((r) => view(r, today, replaced)) };
  });
}

export type DashboardSummary = { thisMonth: number; lastMonth: number; automatic: number; manual: number; expiringSoon: number };

/** For dashboardCards.certificates-issued: this month's count within the viewer's reach. */
export async function dashboardSummary(actor: Actor, today: string): Promise<DashboardSummary> {
  if (!holdsAnywhere(actor, "cert.view")) throw new ForbiddenError();
  return withTenant(actor, async (tx) => {
    const scope = certificateScope(actor, "cert.view");
    const start = monthStart(today);
    const prevStart = monthStart(addDays(start, -1));
    const [r] = await tx
      .select({
        thisMonth: sql<number>`count(*) filter (where ${certCertificates.issuedOn} >= ${start})::int`,
        lastMonth: sql<number>`count(*) filter (where ${certCertificates.issuedOn} >= ${prevStart} and ${certCertificates.issuedOn} < ${start})::int`,
        automatic: sql<number>`count(*) filter (where ${certCertificates.issuedOn} >= ${start} and ${certCertificates.source} = 'automatic')::int`,
        manual: sql<number>`count(*) filter (where ${certCertificates.issuedOn} >= ${start} and ${certCertificates.source} = 'manual')::int`,
        expiringSoon: sql<number>`count(*) filter (where ${certCertificates.status} = 'valid' and ${certCertificates.validUntil} between ${today} and ${addDays(today, EXPIRING_SOON_DAYS)}
          and not exists (select 1 from ${certCertificates} as r where r.replaces_id = ${certCertificates.id}))::int`,
      })
      .from(certCertificates)
      .where(and(scope, or(gte(certCertificates.issuedOn, prevStart), and(isNotNull(certCertificates.validUntil), lte(certCertificates.validUntil, addDays(today, EXPIRING_SOON_DAYS))))));
    return r;
  });
}

/* ─────────────────────────── Learner ─────────────────────────── */

function assertSelf(actor: Actor) {
  assertCan(actor, "self.view_certificates", { universityId: uni(actor), ownerUserId: actor.userId });
}

/** The learner's own certificates, newest first. Alumni keep them all. */
export async function myCertificates(actor: Actor, opts: { enrolmentId?: string } = {}): Promise<{ today: string; rows: CertificateView[] }> {
  assertSelf(actor);
  return withTenant(actor, async (tx) => {
    const today = await todayFor(tx);
    const rows = await tx
      .select()
      .from(certCertificates)
      .where(and(eq(certCertificates.userId, actor.userId), opts.enrolmentId ? eq(certCertificates.enrolmentId, opts.enrolmentId) : undefined))
      .orderBy(...newestFirst);
    return { today, rows: rows.map((r) => view(r, today, replacements(rows))) };
  });
}

/* ─────────────────────────── One certificate ─────────────────────────── */

/**
 * Loads one certificate for someone allowed to see it: its owner (self.view_certificates)
 * or staff with cert.view on its department or batch. Anyone else gets "not found".
 */
async function loadVisible(actor: Actor, id: string) {
  return withTenant(actor, async (tx) => {
    const [c] = await tx.select().from(certCertificates).where(eq(certCertificates.id, id));
    if (!c) throw new NotFoundError("Certificate");
    const own = c.userId === actor.userId && can(actor, "self.view_certificates", { universityId: c.universityId, ownerUserId: actor.userId });
    if (!own && !can(actor, "cert.view", certificateTarget(c))) throw new NotFoundError("Certificate");
    const university = await universityLite(tx);
    return { c, university, today: await todayFor(tx) };
  });
}

/** A short-lived link to the stored PDF, downloaded with a readable file name. */
export async function certificateDownloadUrl(actor: Actor, id: string): Promise<string> {
  const { c } = await loadVisible(actor, id);
  return storage().signedUrl(c.pdfKey, 300, { downloadName: downloadName("Certificate", c.courseTitle, c.studentName) });
}

/** The certificate drawn as SVG from what was frozen at issue (the same layout as its PDF). */
export async function certificateSvg(actor: Actor, id: string): Promise<string> {
  const { c, university } = await loadVisible(actor, id);
  const content = await buildContent(c.template, {
    universityName: c.universityName,
    logoUrl: university.branding.logoUrl,
    studentName: c.studentName,
    courseTitle: c.courseTitle,
    completedOn: c.completedOn,
    validUntil: c.validUntil,
    code: c.code,
    verifyUrl: safeVerifyUrl(c.code),
  });
  return renderCertificateSvg(content);
}

export function safeVerifyUrl(code: string): string {
  try {
    return verifyUrl(code);
  } catch {
    return verifyPath(code);
  }
}

/* ─────────────────────────── Detail and learner info ─────────────────────────── */

export type CertificateDetail = {
  certificate: CertificateView & { batchName: string; departmentId: string };
  chain: CertificateView[];
  issuedByName: string | null;
  revokedByName: string | null;
  revokedAt: Date | null;
  pdfBytes: number;
  pdfSha256: string;
  canIssue: boolean;
};

/** One certificate for staff (cert.view on its department or batch), with its renewals and who acted. */
export async function certificateDetail(actor: Actor, id: string): Promise<CertificateDetail> {
  return withTenant(actor, async (tx) => {
    const [c] = await tx.select().from(certCertificates).where(eq(certCertificates.id, id));
    if (!c || !can(actor, "cert.view", certificateTarget(c))) throw new NotFoundError("Certificate");
    const today = await todayFor(tx);
    const chain = await tx.select().from(certCertificates).where(eq(certCertificates.enrolmentId, c.enrolmentId)).orderBy(certCertificates.createdAt);
    const replaced = replacements(chain);
    const people = new Map((await peopleLite(tx, [c.issuedBy, c.revokedBy].filter((x): x is string => !!x))).map((p) => [p.id, p.name]));
    const batches = new Map((await listCourseBatches(tx, c.courseId).catch(() => [])).map((b) => [b.id, b.name]));
    return {
      certificate: { ...view(c, today, replaced), batchName: batches.get(c.batchId) ?? "Removed batch", departmentId: c.departmentId },
      chain: chain.map((x) => view(x, today, replaced)),
      issuedByName: c.issuedBy ? (people.get(c.issuedBy) ?? "A former staff member") : null,
      revokedByName: c.revokedBy ? (people.get(c.revokedBy) ?? "A former staff member") : c.revokedAt ? "Zinny system" : null,
      revokedAt: c.revokedAt,
      pdfBytes: c.pdfBytes,
      pdfSha256: c.pdfSha256,
      canIssue: can(actor, "cert.issue", certificateTarget(c)),
    };
  });
}

export type LearnerCourseInfo = { certificateEnabled: boolean; autoIssue: boolean; validityMonths: number | null };

/** What a learner is told about a course's certificate before they have one. Their own enrolment only. */
export async function learnerCourseInfo(actor: Actor, enrolmentId: string): Promise<LearnerCourseInfo> {
  assertSelf(actor);
  return withTenant(actor, async (tx) => {
    const [e] = await tx.select({ userId: enrolments.userId, courseId: enrolments.courseId }).from(enrolments).where(eq(enrolments.id, enrolmentId));
    if (!e || e.userId !== actor.userId) throw new NotFoundError("Enrolment");
    const course = await getCourseLite(tx, e.courseId);
    const rule = await effectiveRule(tx, actor, e.courseId);
    return { certificateEnabled: course.certificateEnabled, autoIssue: rule.autoIssue, validityMonths: rule.validityMonths };
  });
}
