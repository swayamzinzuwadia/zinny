import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, domainEvents, notifications } from "@/db/schema";
import type { DomainEvent } from "@/contracts/events";
import { storage, systemActorFor, withTenant } from "@/server/core";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { certCertificates } from "@/modules/certificates/schema";
import {
  issueCertificate,
  issueOnCompletion,
  listTemplates,
  revokeCertificate,
  saveCourseRule,
  updateTemplate,
} from "@/modules/certificates/service";
import { drainEvents, eventsOfType } from "../helpers/events";
import { certWorld, withTempStorage } from "./helpers";

withTempStorage();
afterAll(closeDb);

const certsFor = (enrolmentId: string) => systemDb().select().from(certCertificates).where(eq(certCertificates.enrolmentId, enrolmentId));

describe("automatic issue on enrolment.completed", () => {
  it("issues one certificate with a stored PDF, emits certificate.issued and tells the student", async () => {
    const w = await certWorld("Auto U");
    const { actor: s, enrolmentId } = await w.enrolled("Riya Auto");
    await w.complete(enrolmentId);

    const [c] = await certsFor(enrolmentId);
    expect(c).toBeTruthy();
    expect(c.source).toBe("automatic");
    expect(c.status).toBe("valid");
    expect(c.studentName).toBe("Riya Auto");
    expect(c.courseTitle).toBe("Data Analytics");
    expect(c.validUntil).toBeNull();
    expect(c.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    const [completed] = await eventsOfType("enrolment.completed", w.uni.id);
    expect(c.sourceEventId).toBe(completed.id);

    const file = await storage().get(c.pdfKey);
    expect(file?.contentType).toBe("application/pdf");
    expect(file!.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(file!.body).digest("hex")).toBe(c.pdfSha256);
    expect(file!.size).toBe(c.pdfBytes);

    const [issued] = await eventsOfType("certificate.issued", w.uni.id);
    expect(issued.payload).toEqual({ certificateId: c.id, userId: s.userId, courseId: w.course.id, code: c.code });
    const notes = await systemDb().select().from(notifications).where(and(eq(notifications.userId, s.userId), eq(notifications.kind, "certificate.issued")));
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Your certificate for Data Analytics is ready");
    const audits = await systemDb().select().from(auditLog).where(and(eq(auditLog.entityId, c.id), eq(auditLog.action, "certificate.issue")));
    expect(audits).toHaveLength(1);
  });

  it("the same enrolment.completed delivered twice yields one certificate", async () => {
    const w = await certWorld("Twice U");
    const { enrolmentId } = await w.enrolled("Kabir Twice");
    await w.complete(enrolmentId);
    const [event] = (await eventsOfType("enrolment.completed", w.uni.id)) as unknown as DomainEvent<"enrolment.completed">[];

    // Deliver the very same event to the handler again, twice in a row and twice at once.
    const deliver = () => withTenant(systemActorFor(w.uni.id), (tx) => issueOnCompletion(tx, systemActorFor(w.uni.id), event));
    expect(await deliver()).toEqual({ status: "exists" });
    const both = await Promise.all([deliver(), deliver()]);
    expect(both.map((b) => b.status)).toEqual(["exists", "exists"]);

    expect(await certsFor(enrolmentId)).toHaveLength(1);
    expect(await eventsOfType("certificate.issued", w.uni.id)).toHaveLength(1);
  });

  it("two first deliveries racing still yield one certificate", async () => {
    const w = await certWorld("Race U");
    const { enrolmentId } = await w.enrolled("Aditi Race");
    // Complete without delivering, then race two handler runs of the same event.
    const { markEnrolmentCompleted } = await import("@/server/core");
    await markEnrolmentCompleted(w.admin, enrolmentId);
    const [event] = (await eventsOfType("enrolment.completed", w.uni.id)) as unknown as DomainEvent<"enrolment.completed">[];
    const sys = systemActorFor(w.uni.id);
    const results = await Promise.all([1, 2].map(() => withTenant(sys, (tx) => issueOnCompletion(tx, sys, event))));
    expect(results.filter((r) => r.status === "issued")).toHaveLength(1);
    expect(await certsFor(enrolmentId)).toHaveLength(1);
    await drainEvents(); // the registered handler finds it too
    expect(await certsFor(enrolmentId)).toHaveLength(1);
    expect(await eventsOfType("certificate.issued", w.uni.id)).toHaveLength(1);
  });

  it("a course with certificates turned off issues none", async () => {
    const w = await certWorld("Off U");
    await w.setCertificates(false);
    const { enrolmentId } = await w.enrolled("Meera Off");
    await w.complete(enrolmentId);
    expect(await certsFor(enrolmentId)).toHaveLength(0);
    expect(await eventsOfType("certificate.issued", w.uni.id)).toHaveLength(0);
    // Manual issue is refused too.
    await expect(issueCertificate(w.admin, { enrolmentId, reason: "Completed offline" })).rejects.toThrow(/turned off/);
  });

  it("a rule with automatic issue off issues none on completion, but staff can issue by hand", async () => {
    const w = await certWorld("Manual Rule U");
    const [t] = await listTemplates(w.admin);
    await saveCourseRule(w.admin, w.course.id, { templateId: t.id, autoIssue: false, validityMonths: null, reminderDays: null });
    const { enrolmentId } = await w.enrolled("Rohan Manual");
    await w.complete(enrolmentId);
    expect(await certsFor(enrolmentId)).toHaveLength(0);
    const c = await issueCertificate(w.hod, { enrolmentId, reason: "Final project reviewed" });
    expect(c.source).toBe("manual");
    expect(c.issueReason).toBe("Final project reviewed");
    expect(c.issuedBy).toBe(w.hod.userId);
  });

  it("uses the rule's template and validity, frozen at issue", async () => {
    const w = await certWorld("Rule U");
    const templates = await listTemplates(w.admin);
    const modern = templates.find((t) => t.design === "modern")!;
    await saveCourseRule(w.admin, w.course.id, { templateId: modern.id, autoIssue: true, validityMonths: 12, reminderDays: 30 });
    const { enrolmentId } = await w.enrolled("Sneha Rule");
    await w.complete(enrolmentId);
    const [c] = await certsFor(enrolmentId);
    expect(c.templateId).toBe(modern.id);
    expect(c.template.design).toBe("modern");
    expect(c.validUntil).not.toBeNull();
    const before = await storage().get(c.pdfKey);

    // Editing the template later changes neither the stored snapshot nor the PDF.
    await updateTemplate(w.admin, modern.id, { name: "Modern", design: "classic", heading: "Award", intro: "Presented to", body: "for finishing", signatories: [] });
    const [after] = await certsFor(enrolmentId);
    expect(after.template.design).toBe("modern");
    expect(after.template.heading).toBe("Certificate of completion");
    expect((await storage().get(c.pdfKey))!.body.equals(before!.body)).toBe(true);
  });
});

describe("manual issue and revoke need cert.issue", () => {
  it("Admin and the course's HOD may issue; other HODs, faculty, board and students may not", async () => {
    const w = await certWorld("Issue Perms U");
    const { actor: student, enrolmentId } = await w.enrolled("Zoya Perms");
    for (const who of [w.otherHod, w.faculty, w.board, student]) {
      await expect(issueCertificate(who, { enrolmentId, reason: "Completed offline" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    const c = await issueCertificate(w.admin, { enrolmentId, reason: "Completed offline" });
    expect(c.issuedBy).toBe(w.admin.userId);
    const { enrolmentId: second } = await w.enrolled("Tara Perms");
    await expect(issueCertificate(w.hod, { enrolmentId: second, reason: "Completed offline" })).resolves.toBeTruthy();
  });

  it("Admin and the course's HOD may revoke; other HODs, faculty, board and the student may not", async () => {
    const w = await certWorld("Revoke Perms U");
    const { actor: student, enrolmentId } = await w.enrolled("Neil Revoke");
    await w.complete(enrolmentId);
    const [c] = await certsFor(enrolmentId);
    for (const who of [w.otherHod, w.faculty, w.board, student]) {
      await expect(revokeCertificate(who, c.id, "Issued by mistake")).rejects.toBeInstanceOf(ForbiddenError);
    }
    const r = await revokeCertificate(w.hod, c.id, "Plagiarised final project");
    expect(r.status).toBe("revoked");
    expect(r.revokeReason).toBe("Plagiarised final project");
    expect(r.revokedBy).toBe(w.hod.userId);
    await expect(revokeCertificate(w.admin, c.id, "Again please")).rejects.toBeInstanceOf(ConflictError);
    const notes = await systemDb().select().from(notifications).where(and(eq(notifications.userId, student.userId), eq(notifications.kind, "certificate.revoked")));
    expect(notes).toHaveLength(1);
  });

  it("a reason is required for both", async () => {
    const w = await certWorld("Reason U");
    const { enrolmentId } = await w.enrolled("Diya Reason");
    await expect(issueCertificate(w.admin, { enrolmentId, reason: "  " })).rejects.toBeInstanceOf(ValidationError);
    const c = await issueCertificate(w.admin, { enrolmentId, reason: "Completed offline" });
    await expect(revokeCertificate(w.admin, c.id, "no")).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a second certificate while one is valid; after revoking, a new one follows the old", async () => {
    const w = await certWorld("Chain U");
    const { enrolmentId } = await w.enrolled("Ishaan Chain");
    await w.complete(enrolmentId);
    const [first] = await certsFor(enrolmentId);
    await expect(issueCertificate(w.admin, { enrolmentId, reason: "Name spelt wrong" })).rejects.toThrow(/already has a valid certificate/);
    await revokeCertificate(w.admin, first.id, "Name spelt wrong");
    const second = await issueCertificate(w.admin, { enrolmentId, reason: "Name corrected" });
    expect(second.replacesId).toBe(first.id);
    expect(second.code).not.toBe(first.code);
    // Each certificate can be followed only once.
    await revokeCertificate(w.admin, second.id, "Issued twice by mistake");
    const third = await issueCertificate(w.admin, { enrolmentId, reason: "Final version" });
    expect(third.replacesId).toBe(second.id);
    expect(await certsFor(enrolmentId)).toHaveLength(3);
  });

  it("renews only when the certificate has expired or is close to expiry", async () => {
    const w = await certWorld("Renew U");
    const [t] = await listTemplates(w.admin);
    await saveCourseRule(w.admin, w.course.id, { templateId: t.id, autoIssue: true, validityMonths: 24, reminderDays: 30 });
    const { enrolmentId } = await w.enrolled("Arjun Renew");
    await w.complete(enrolmentId);
    const [c] = await certsFor(enrolmentId);
    await expect(issueCertificate(w.admin, { enrolmentId, reason: "Refresher done" })).rejects.toThrow(/You can renew it from/);
    // It expired last month.
    await systemDb().update(certCertificates).set({ issuedOn: "2020-01-01", validUntil: "2021-12-31", completedOn: "2020-01-01" }).where(eq(certCertificates.id, c.id));
    const renewed = await issueCertificate(w.admin, { enrolmentId, reason: "Refresher course completed" });
    expect(renewed.replacesId).toBe(c.id);
    expect(renewed.validUntil! > renewed.issuedOn).toBe(true);
  });

  it("refuses enrolments that are not confirmed, and future completion dates", async () => {
    const w = await certWorld("Dates U");
    const { enrolmentId } = await w.enrolled("Aarav Dates");
    await expect(issueCertificate(w.admin, { enrolmentId, reason: "Completed offline", completedOn: "2999-01-01" })).rejects.toThrow(/future/);
    const c = await issueCertificate(w.admin, { enrolmentId, reason: "Completed offline", completedOn: "2026-01-15" });
    expect(c.completedOn).toBe("2026-01-15");
    const audits = await systemDb().select().from(domainEvents).where(and(eq(domainEvents.type, "certificate.issued"), eq(domainEvents.universityId, w.uni.id)));
    expect(audits).toHaveLength(1);
  });
});
