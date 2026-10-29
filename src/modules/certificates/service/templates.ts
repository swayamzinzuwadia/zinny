/**
 * Certificate templates (brief item 1): three designs to start, per university, with
 * heading and wording, up to two signatories with signature images, and a live preview.
 *
 * Templates belong to the whole university, so changing them needs cert.manage at
 * university level (Institute Admin). Anyone who works with certificates may see them.
 */
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, audit, storage, todayFor, universityLite, withTenant, type Actor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { formatCode, verifyBaseUrl } from "../lib";
import { DESIGNS, accentFrom, imageInfo, renderCertificatePdf, renderCertificateSvg, type DesignKey } from "../render";
import { certCertificates, certRules, certTemplates, type CertDesign, type Signatory, type TemplateSnapshot } from "../schema";
import { SAMPLE, buildContent } from "./content";
import { canManageTemplates, canSeeTemplates, trimmed, uni } from "./shared";

export type Template = typeof certTemplates.$inferSelect;

export const DEFAULT_WORDING = {
  heading: "Certificate of completion",
  intro: "This is to certify that",
  body: "has successfully completed the course",
} as const;

const STARTERS: { name: string; design: CertDesign }[] = [
  { name: "Classic", design: "classic" },
  { name: "Modern", design: "modern" },
  { name: "Minimal", design: "minimal" },
];

/** Signature uploads: small enough for a server action (1 MB body limit) with room to spare. */
export const MAX_SIGNATURE_BYTES = 512 * 1024;

function assertManage(actor: Actor) {
  assertCan(actor, "cert.manage", { universityId: uni(actor) });
}

function assertSee(actor: Actor) {
  if (!canSeeTemplates(actor)) throw new ForbiddenError();
}

/**
 * Gives a university its three starter templates (Classic as the default) the first time
 * certificates are used. Safe when two requests race: they queue on an advisory lock.
 */
export async function ensureStarterTemplates(tx: Tx, actor: Actor): Promise<void> {
  const universityId = uni(actor);
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(certTemplates);
  if (n > 0) return;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cert_templates:${universityId}`}))`);
  const [{ again }] = await tx.select({ again: sql<number>`count(*)::int` }).from(certTemplates);
  if (again > 0) return;
  const rows = await tx
    .insert(certTemplates)
    .values(STARTERS.map((s, i) => ({ universityId, name: s.name, design: s.design, ...DEFAULT_WORDING, signatories: [], isDefault: i === 0, createdBy: actor.userId || null })))
    .returning({ id: certTemplates.id, name: certTemplates.name });
  await audit(tx, actor, "certificate.templates_start", "cert_template", null, { templates: rows.map((r) => r.name) });
}

/** The default template, creating the starters if the university has none yet. */
export async function defaultTemplate(tx: Tx, actor: Actor): Promise<Template> {
  await ensureStarterTemplates(tx, actor);
  const [d] = await tx.select().from(certTemplates).where(and(eq(certTemplates.isDefault, true), isNull(certTemplates.archivedAt)));
  if (d) return d;
  // No default marked (shouldn't happen): fall back to the oldest active template.
  const [first] = await tx.select().from(certTemplates).where(isNull(certTemplates.archivedAt)).orderBy(asc(certTemplates.createdAt)).limit(1);
  if (!first) throw new ConflictError("There is no certificate template to use. Restore or add one under Products → Certificates.", "no_template");
  return first;
}

export type TemplateListItem = Template & { courses: number; issued: number };

// Written out in full: in a single-table select drizzle leaves columns unqualified, which
// would make the correlated "id" refer to the inner table.
const usedByCourses = sql<number>`(select count(*)::int from cert_rules r where r.template_id = cert_templates.id)`;
const issuedWith = sql<number>`(select count(*)::int from cert_certificates c where c.template_id = cert_templates.id)`;

export async function listTemplates(actor: Actor, opts: { includeArchived?: boolean } = {}): Promise<TemplateListItem[]> {
  assertSee(actor);
  return withTenant(actor, async (tx) => {
    await ensureStarterTemplates(tx, actor);
    const rows = await tx
      .select({
        t: certTemplates,
        courses: usedByCourses,
        issued: issuedWith,
      })
      .from(certTemplates)
      .where(opts.includeArchived ? undefined : isNull(certTemplates.archivedAt))
      .orderBy(sql`${certTemplates.archivedAt} is not null`, sql`${certTemplates.isDefault} desc`, asc(certTemplates.createdAt));
    return rows.map((r) => ({ ...r.t, courses: r.courses, issued: r.issued }));
  });
}

export async function getTemplate(actor: Actor, id: string): Promise<TemplateListItem> {
  assertSee(actor);
  return withTenant(actor, async (tx) => {
    const [r] = await tx
      .select({
        t: certTemplates,
        courses: usedByCourses,
        issued: issuedWith,
      })
      .from(certTemplates)
      .where(eq(certTemplates.id, id));
    if (!r) throw new NotFoundError("Template");
    return { ...r.t, courses: r.courses, issued: r.issued };
  });
}

/* ─────────────────────────── Validation ─────────────────────────── */

export type TemplateText = { heading: string; intro: string; body: string };
export type SignatoryInput = { name: string; title: string; imageKey?: string | null };

function checkLength(label: string, value: string, min: number, max: number) {
  if (value.length < min) throw new ValidationError(min === 1 ? `Enter the ${label}.` : `The ${label} needs at least ${min} characters.`);
  if (value.length > max) throw new ValidationError(`Keep the ${label} to ${max} characters or fewer.`);
}

export function cleanText(input: Partial<TemplateText>): TemplateText {
  const t = { heading: trimmed(input.heading), intro: trimmed(input.intro), body: trimmed(input.body) };
  checkLength("heading", t.heading, 3, 60);
  checkLength("opening line", t.intro, 2, 80);
  checkLength("completion line", t.body, 2, 100);
  return t;
}

/** Keeps signatories with a name (at most two). An image key must belong to this template's folder. */
export function cleanSignatories(universityId: string, templateId: string | null, input: SignatoryInput[]): Signatory[] {
  const out: Signatory[] = [];
  for (const s of input) {
    const name = trimmed(s.name);
    const title = trimmed(s.title);
    if (!name && !title && !s.imageKey) continue;
    if (!name) throw new ValidationError("Enter a name for each signatory, or clear the row.");
    checkLength("signatory's name", name, 2, 60);
    if (title.length > 60) throw new ValidationError("Keep each signatory's title to 60 characters or fewer.");
    const key = s.imageKey || null;
    if (key && (!templateId || !key.startsWith(`${universityId}/certificates/templates/${templateId}/`))) {
      throw new ValidationError("That signature image doesn't belong to this template. Upload it again.");
    }
    out.push({ name, title, imageKey: key });
  }
  if (out.length > 2) throw new ValidationError("A certificate has room for two signatories at most.");
  return out;
}

function cleanName(name: unknown) {
  const n = trimmed(name);
  checkLength("template name", n, 2, 60);
  return n;
}

function cleanDesign(design: unknown): CertDesign {
  if (typeof design !== "string" || !(design in DESIGNS)) throw new ValidationError("Pick one of the designs: Classic, Modern or Minimal.");
  return design as CertDesign;
}

/* ─────────────────────────── Changes ─────────────────────────── */

export async function createTemplate(actor: Actor, input: { name: string; design: string }) {
  assertManage(actor);
  const name = cleanName(input.name);
  const design = cleanDesign(input.design);
  return withTenant(actor, async (tx) => {
    await ensureStarterTemplates(tx, actor);
    const [t] = await tx
      .insert(certTemplates)
      .values({ universityId: uni(actor), name, design, ...DEFAULT_WORDING, signatories: [], createdBy: actor.userId || null })
      .returning();
    await audit(tx, actor, "certificate.template_create", "cert_template", t.id, { name, design });
    return t;
  });
}

export type TemplatePatch = { name: string; design: string; heading: string; intro: string; body: string; signatories: SignatoryInput[] };

export async function updateTemplate(actor: Actor, id: string, patch: TemplatePatch) {
  assertManage(actor);
  const name = cleanName(patch.name);
  const design = cleanDesign(patch.design);
  const text = cleanText(patch);
  const signatories = cleanSignatories(uni(actor), id, patch.signatories);
  return withTenant(actor, async (tx) => {
    const [before] = await tx.select().from(certTemplates).where(eq(certTemplates.id, id)).for("update");
    if (!before) throw new NotFoundError("Template");
    if (before.archivedAt) throw new ConflictError("This template is archived. Restore it before editing.");
    const [t] = await tx
      .update(certTemplates)
      .set({ name, design, ...text, signatories, updatedAt: new Date() })
      .where(eq(certTemplates.id, id))
      .returning();
    await audit(tx, actor, "certificate.template_update", "cert_template", id, { name, design, ...text, signatories: signatories.map((s) => ({ name: s.name, title: s.title, image: !!s.imageKey })) });
    return t;
  });
}

/** Stores a signature image (PNG or JPEG) for signatory `index` (0 or 1). Earlier images stay in storage: issued certificates may use them. */
export async function setSignatureImage(actor: Actor, id: string, index: number, file: { bytes: Uint8Array; size: number }) {
  assertManage(actor);
  if (index !== 0 && index !== 1) throw new ValidationError("Pick the first or second signatory.");
  if (!file.size) throw new ValidationError("Choose a PNG or JPEG image of the signature.");
  if (file.size > MAX_SIGNATURE_BYTES) throw new ValidationError("That image is larger than 500 KB. Crop or compress it and upload again.");
  const info = imageInfo(file.bytes);
  if (!info) throw new ValidationError("Upload the signature as a PNG or JPEG image.");
  if (info.width < 60 || info.height < 20) throw new ValidationError("That image is too small to print clearly. Use one at least 300 pixels wide.");
  return withTenant(actor, async (tx) => {
    const [t] = await tx.select().from(certTemplates).where(eq(certTemplates.id, id)).for("update");
    if (!t) throw new NotFoundError("Template");
    if (t.archivedAt) throw new ConflictError("This template is archived. Restore it before editing.");
    const s = t.signatories[index];
    if (!s) throw new ValidationError("Add the signatory's name and save the template first.");
    const ext = info.mime === "image/png" ? "png" : "jpg";
    const key = `${uni(actor)}/certificates/templates/${id}/signature-${index + 1}-${randomBytes(6).toString("hex")}.${ext}`;
    await storage().put({ key, body: file.bytes, contentType: info.mime });
    const signatories = t.signatories.map((x, i) => (i === index ? { ...x, imageKey: key } : x));
    await tx.update(certTemplates).set({ signatories, updatedAt: new Date() }).where(eq(certTemplates.id, id));
    await audit(tx, actor, "certificate.template_signature", "cert_template", id, { index, bytes: file.size });
    return key;
  });
}

export async function removeSignatureImage(actor: Actor, id: string, index: number) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const [t] = await tx.select().from(certTemplates).where(eq(certTemplates.id, id)).for("update");
    if (!t) throw new NotFoundError("Template");
    if (!t.signatories[index]?.imageKey) return;
    const signatories = t.signatories.map((x, i) => (i === index ? { ...x, imageKey: null } : x));
    await tx.update(certTemplates).set({ signatories, updatedAt: new Date() }).where(eq(certTemplates.id, id));
    await audit(tx, actor, "certificate.template_signature_remove", "cert_template", id, { index });
  });
}

export async function setDefaultTemplate(actor: Actor, id: string) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const [t] = await tx.select().from(certTemplates).where(eq(certTemplates.id, id)).for("update");
    if (!t) throw new NotFoundError("Template");
    if (t.archivedAt) throw new ConflictError("Restore this template before making it the default.");
    if (t.isDefault) return;
    await tx.update(certTemplates).set({ isDefault: false }).where(eq(certTemplates.isDefault, true));
    await tx.update(certTemplates).set({ isDefault: true, updatedAt: new Date() }).where(eq(certTemplates.id, id));
    await audit(tx, actor, "certificate.template_default", "cert_template", id, { name: t.name });
  });
}

export async function archiveTemplate(actor: Actor, id: string) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const [t] = await tx.select().from(certTemplates).where(eq(certTemplates.id, id)).for("update");
    if (!t) throw new NotFoundError("Template");
    if (t.archivedAt) return;
    if (t.isDefault) throw new ConflictError("This is the default template. Make another template the default first.");
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(certRules).where(eq(certRules.templateId, id));
    if (n > 0) throw new ConflictError(`${n} course${n === 1 ? " uses" : "s use"} this template. Pick another template for ${n === 1 ? "it" : "them"} first.`);
    await tx.update(certTemplates).set({ archivedAt: new Date() }).where(eq(certTemplates.id, id));
    await audit(tx, actor, "certificate.template_archive", "cert_template", id, { name: t.name });
  });
}

export async function restoreTemplate(actor: Actor, id: string) {
  assertManage(actor);
  return withTenant(actor, async (tx) => {
    const [t] = await tx.select().from(certTemplates).where(eq(certTemplates.id, id)).for("update");
    if (!t) throw new NotFoundError("Template");
    if (!t.archivedAt) return;
    await tx.update(certTemplates).set({ archivedAt: null }).where(eq(certTemplates.id, id));
    await audit(tx, actor, "certificate.template_restore", "cert_template", id, { name: t.name });
  });
}

/* ─────────────────────────── Preview ─────────────────────────── */

export type PreviewDraft = {
  design: string;
  heading: string;
  intro: string;
  body: string;
  signatories: SignatoryInput[];
  /** Optional sample person and course, to try long names. */
  sampleName?: string;
  sampleCourse?: string;
};

/** The snapshot a template would freeze onto a certificate issued now. */
export function snapshotOf(t: Pick<Template, "design" | "heading" | "intro" | "body" | "signatories">, primaryColor: string | undefined): TemplateSnapshot {
  return { design: t.design, heading: t.heading, intro: t.intro, body: t.body, signatories: t.signatories, accentColor: accentFrom(primaryColor) };
}

/**
 * The template filled with sample data. With `draft`, unsaved edits are shown as typed,
 * as long as they are valid enough to draw; invalid text falls back to the saved wording.
 */
async function sampleContent(actor: Actor, templateId: string, draft?: PreviewDraft) {
  return withTenant(actor, async (tx) => {
    const [t] = await tx.select().from(certTemplates).where(eq(certTemplates.id, templateId));
    if (!t) throw new NotFoundError("Template");
    const university = await universityLite(tx);
    const today = await todayFor(tx);
    let source: Pick<Template, "design" | "heading" | "intro" | "body" | "signatories"> = t;
    if (draft) {
      const design = draft.design in DESIGNS ? (draft.design as DesignKey) : t.design;
      const text = {
        heading: trimmed(draft.heading).slice(0, 60) || t.heading,
        intro: trimmed(draft.intro).slice(0, 80) || t.intro,
        body: trimmed(draft.body).slice(0, 100) || t.body,
      };
      let signatories = t.signatories;
      try {
        signatories = cleanSignatories(university.id, t.id, draft.signatories.map((s) => ({ ...s, name: trimmed(s.name) || (s.imageKey ? "Name" : "") })));
      } catch {
        // Half-typed rows: keep showing the saved signatories.
      }
      source = { design, ...text, signatories };
    }
    const snap = snapshotOf(source, university.branding.primaryColor);
    let base: string;
    try {
      base = verifyBaseUrl();
    } catch {
      base = "https://zinny.app";
    }
    return buildContent(snap, {
      universityName: university.name,
      logoUrl: university.branding.logoUrl,
      studentName: trimmed(draft?.sampleName).slice(0, 120) || SAMPLE.studentName,
      courseTitle: trimmed(draft?.sampleCourse).slice(0, 200) || SAMPLE.courseTitle,
      completedOn: today,
      validUntil: null,
      code: SAMPLE.code,
      verifyUrl: `${base}/verify/${formatCode(SAMPLE.code)}`,
    });
  });
}

export async function templatePreviewSvg(actor: Actor, templateId: string, draft?: PreviewDraft): Promise<string> {
  assertSee(actor);
  return renderCertificateSvg(await sampleContent(actor, templateId, draft));
}

/** A sample PDF of a saved template, to check printing before any certificate is issued. */
export async function templateSamplePdf(actor: Actor, templateId: string): Promise<{ pdf: Uint8Array; name: string }> {
  assertSee(actor);
  const content = await sampleContent(actor, templateId);
  return { pdf: await renderCertificatePdf(content), name: `Sample certificate - ${content.design}.pdf` };
}

/** Short-lived links to a template's signature images, for showing them next to the upload buttons. */
export async function templateSignatureUrls(actor: Actor, id: string): Promise<(string | null)[]> {
  const t = await getTemplate(actor, id);
  return Promise.all(t.signatories.map((s) => (s.imageKey ? storage().signedUrl(s.imageKey, 600) : Promise.resolve(null))));
}

export { canManageTemplates, canSeeTemplates };
