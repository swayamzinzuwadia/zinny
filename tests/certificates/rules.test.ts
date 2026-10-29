import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { archiveTemplate, cleanRule, getCourseRule, listTemplates, saveCourseRule, setDefaultTemplate } from "@/modules/certificates/service";
import { certWorld, useTempStorage } from "./helpers";

useTempStorage();
afterAll(closeDb);

describe("certificate rules per course", () => {
  it("without a rule a course uses the default template, issues automatically and never expires", async () => {
    const w = await certWorld("Rule Default U");
    const r = await getCourseRule(w.hod, w.course.id);
    expect(r).toMatchObject({ custom: false, autoIssue: true, validityMonths: null, reminderDays: null });
    expect(r.template.isDefault).toBe(true);
  });

  it("Admin and the course's HOD may save rules; another HOD, faculty and board may not", async () => {
    const w = await certWorld("Rule Perms U");
    const [, modern] = await listTemplates(w.admin);
    const input = { templateId: modern.id, autoIssue: true, validityMonths: 24, reminderDays: 30 };
    for (const who of [w.otherHod, w.faculty, w.board]) await expect(saveCourseRule(who, w.course.id, input)).rejects.toBeInstanceOf(ForbiddenError);
    await saveCourseRule(w.hod, w.course.id, input);
    const r = await getCourseRule(w.faculty, w.course.id); // faculty of the batch can read it (cert.view)
    expect(r).toMatchObject({ custom: true, autoIssue: true, validityMonths: 24, reminderDays: 30 });
    expect(r.template.id).toBe(modern.id);
    await expect(getCourseRule(w.otherHod, w.course.id)).rejects.toBeInstanceOf(ForbiddenError);
    // Saving again updates the one rule.
    await saveCourseRule(w.admin, w.course.id, { ...input, validityMonths: null, reminderDays: null });
    expect(await getCourseRule(w.admin, w.course.id)).toMatchObject({ validityMonths: null, reminderDays: null });
  });

  it("checks the numbers", () => {
    const t = "00000000-0000-0000-0000-000000000000";
    expect(cleanRule({ templateId: t, autoIssue: true, validityMonths: "", reminderDays: "" })).toEqual({ templateId: t, autoIssue: true, validityMonths: null, reminderDays: null });
    expect(cleanRule({ templateId: t, autoIssue: false, validityMonths: "12", reminderDays: "30" })).toMatchObject({ validityMonths: 12, reminderDays: 30 });
    expect(() => cleanRule({ templateId: t, autoIssue: true, validityMonths: "0", reminderDays: "" })).toThrow(ValidationError);
    expect(() => cleanRule({ templateId: t, autoIssue: true, validityMonths: "1.5", reminderDays: "" })).toThrow(/whole number/);
    expect(() => cleanRule({ templateId: t, autoIssue: true, validityMonths: "", reminderDays: "30" })).toThrow(/needs an expiry/);
    expect(() => cleanRule({ templateId: t, autoIssue: true, validityMonths: "1", reminderDays: "40" })).toThrow(/before the certificate expires/);
  });

  it("refuses archived templates, and falls back to the default if a rule's template is archived later", async () => {
    const w = await certWorld("Rule Archive U");
    const [classic, modern, minimal] = await listTemplates(w.admin);
    await archiveTemplate(w.admin, minimal.id);
    await expect(saveCourseRule(w.admin, w.course.id, { templateId: minimal.id, autoIssue: true, validityMonths: null, reminderDays: null })).rejects.toThrow(/archived/);
    await saveCourseRule(w.admin, w.course.id, { templateId: modern.id, autoIssue: true, validityMonths: null, reminderDays: null });
    await setDefaultTemplate(w.admin, classic.id);
    expect((await getCourseRule(w.admin, w.course.id)).template.id).toBe(modern.id);
  });
});
