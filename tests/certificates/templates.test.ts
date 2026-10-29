import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { storage, systemActorFor, withTenant } from "@/server/core";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { signaturePng } from "@/modules/certificates/render/signature";
import { certTemplates } from "@/modules/certificates/schema";
import {
  archiveTemplate,
  createTemplate,
  ensureStarterTemplates,
  getTemplate,
  listTemplates,
  removeSignatureImage,
  restoreTemplate,
  saveCourseRule,
  setDefaultTemplate,
  setSignatureImage,
  templatePreviewSvg,
  templateSamplePdf,
  updateTemplate,
} from "@/modules/certificates/service";
import { certWorld, useTempStorage } from "./helpers";

useTempStorage();
afterAll(closeDb);

const png = signaturePng("Asha Admin");
const upload = (bytes: Uint8Array) => ({ bytes, size: bytes.length });

describe("templates", () => {
  it("a university starts with three designs, Classic as the default, created once even when requests race", async () => {
    const w = await certWorld("Starter U");
    const sys = systemActorFor(w.uni.id);
    await Promise.all([1, 2, 3].map(() => withTenant(sys, (tx) => ensureStarterTemplates(tx, sys))));
    const list = await listTemplates(w.admin);
    expect(list.map((t) => [t.name, t.design, t.isDefault])).toEqual([
      ["Classic", "classic", true],
      ["Modern", "modern", false],
      ["Minimal", "minimal", false],
    ]);
    expect(list.every((t) => t.heading === "Certificate of completion" && t.signatories.length === 0)).toBe(true);
  });

  it("only university-wide cert.manage (Institute Admin) may change templates; staff with cert.view may look", async () => {
    const w = await certWorld("Template Perms U");
    const [t] = await listTemplates(w.admin);
    const patch = { name: "Classic", design: "classic", heading: "Certificate of merit", intro: "Presented to", body: "for completing", signatories: [] };
    for (const who of [w.hod, w.faculty, w.board]) {
      await expect(updateTemplate(who, t.id, patch)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createTemplate(who, { name: "Mine", design: "modern" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setDefaultTemplate(who, t.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setSignatureImage(who, t.id, 0, upload(png))).rejects.toBeInstanceOf(ForbiddenError);
      expect((await listTemplates(who)).length).toBe(3);
    }
    const student = await w.student("Student Looker");
    await expect(listTemplates(student)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(templatePreviewSvg(student, t.id)).rejects.toBeInstanceOf(ForbiddenError);
    const saved = await updateTemplate(w.admin, t.id, patch);
    expect(saved.heading).toBe("Certificate of merit");
  });

  it("validates wording and signatories", async () => {
    const w = await certWorld("Template Rules U");
    const [t] = await listTemplates(w.admin);
    const base = { name: "Classic", design: "classic", heading: "Certificate of completion", intro: "This is to certify that", body: "has completed", signatories: [] };
    await expect(updateTemplate(w.admin, t.id, { ...base, heading: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateTemplate(w.admin, t.id, { ...base, design: "baroque" })).rejects.toThrow(/Classic, Modern or Minimal/);
    const three = [1, 2, 3].map((i) => ({ name: `Signer ${i}`, title: "Dean" }));
    await expect(updateTemplate(w.admin, t.id, { ...base, signatories: three })).rejects.toThrow(/two signatories/);
    await expect(updateTemplate(w.admin, t.id, { ...base, signatories: [{ name: "", title: "Director" }] })).rejects.toThrow(/name for each signatory/);
    // A key from somewhere else can't be smuggled in.
    await expect(
      updateTemplate(w.admin, t.id, { ...base, signatories: [{ name: "Asha", title: "Director", imageKey: `${w.uni.id}/payments/invoices/x.pdf` }] }),
    ).rejects.toThrow(/doesn't belong/);
    // Blank rows are dropped.
    const ok = await updateTemplate(w.admin, t.id, { ...base, signatories: [{ name: "  Asha   Admin ", title: "Director" }, { name: "", title: "" }] });
    expect(ok.signatories).toEqual([{ name: "Asha Admin", title: "Director", imageKey: null }]);
  });

  it("stores PNG or JPEG signature images and refuses anything else", async () => {
    const w = await certWorld("Signature U");
    const [t] = await listTemplates(w.admin);
    await expect(setSignatureImage(w.admin, t.id, 0, upload(png))).rejects.toThrow(/name and save/);
    await updateTemplate(w.admin, t.id, { name: t.name, design: t.design, heading: t.heading, intro: t.intro, body: t.body, signatories: [{ name: "Asha Admin", title: "Director" }] });
    await expect(setSignatureImage(w.admin, t.id, 0, upload(Buffer.from("<svg onload=alert(1)></svg>")))).rejects.toThrow(/PNG or JPEG/);
    await expect(setSignatureImage(w.admin, t.id, 0, upload(Buffer.alloc(600 * 1024, 1)))).rejects.toThrow(/500 KB/);
    const key = await setSignatureImage(w.admin, t.id, 0, upload(png));
    expect(key.startsWith(`${w.uni.id}/certificates/templates/${t.id}/signature-1-`)).toBe(true);
    expect((await storage().get(key))?.contentType).toBe("image/png");
    const after = await getTemplate(w.admin, t.id);
    expect(after.signatories[0].imageKey).toBe(key);
    // Saving the template keeps the image when its key comes back from the form.
    const kept = await updateTemplate(w.admin, t.id, { name: t.name, design: t.design, heading: t.heading, intro: t.intro, body: t.body, signatories: [{ name: "Asha Admin", title: "Director", imageKey: key }] });
    expect(kept.signatories[0].imageKey).toBe(key);
    await removeSignatureImage(w.admin, t.id, 0);
    expect((await getTemplate(w.admin, t.id)).signatories[0].imageKey).toBeNull();
    // The file stays: certificates already issued may print it.
    expect(await storage().get(key)).not.toBeNull();
  });

  it("one default at a time; the default and templates in use can't be archived", async () => {
    const w = await certWorld("Default U");
    const [classic, modern, minimal] = await listTemplates(w.admin);
    await setDefaultTemplate(w.admin, modern.id);
    const rows = await systemDb().select().from(certTemplates).where(eq(certTemplates.universityId, w.uni.id));
    expect(rows.filter((r) => r.isDefault).map((r) => r.id)).toEqual([modern.id]);
    await expect(archiveTemplate(w.admin, modern.id)).rejects.toBeInstanceOf(ConflictError);
    await saveCourseRule(w.admin, w.course.id, { templateId: minimal.id, autoIssue: true, validityMonths: null, reminderDays: null });
    await expect(archiveTemplate(w.admin, minimal.id)).rejects.toThrow(/1 course uses this template/);
    await archiveTemplate(w.admin, classic.id);
    expect((await listTemplates(w.admin)).map((t) => t.id)).not.toContain(classic.id);
    expect((await listTemplates(w.admin, { includeArchived: true })).map((t) => t.id)).toContain(classic.id);
    await expect(setDefaultTemplate(w.admin, classic.id)).rejects.toThrow(/Restore/);
    await restoreTemplate(w.admin, classic.id);
    await setDefaultTemplate(w.admin, classic.id);
    const audits = await systemDb().select().from(auditLog).where(eq(auditLog.entityId, classic.id));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["certificate.template_archive", "certificate.template_restore", "certificate.template_default"]));
  });

  it("new templates use one of the three designs", async () => {
    const w = await certWorld("New Template U");
    const t = await createTemplate(w.admin, { name: "Workshop", design: "minimal" });
    expect(t.isDefault).toBe(false);
    await expect(createTemplate(w.admin, { name: "x", design: "minimal" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("previews draw the draft with sample data, escaping what was typed", async () => {
    const w = await certWorld("Preview U");
    const [t] = await listTemplates(w.admin);
    const svg = await templatePreviewSvg(w.admin, t.id, {
      design: "modern",
      heading: "Certificate <b>of</b> merit",
      intro: "Presented to",
      body: "for completing",
      signatories: [{ name: "Asha & Co", title: "Director" }],
      sampleName: "Venkatanarasimharajuvaripeta Subrahmanyam",
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Certificate &lt;b&gt;of&lt;/b&gt; merit");
    expect(svg).toContain("Asha &amp; Co");
    expect(svg).toContain("Venkatanarasimharajuvaripeta");
    expect(svg).not.toContain("<b>");
    // Board members can see previews too.
    expect((await templatePreviewSvg(w.board, t.id)).startsWith("<svg")).toBe(true);
    const sample = await templateSamplePdf(w.admin, t.id);
    expect(Buffer.from(sample.pdf).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
