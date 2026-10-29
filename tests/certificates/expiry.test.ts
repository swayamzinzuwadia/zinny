import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { notifications } from "@/db/schema";
import { systemActorFor } from "@/server/core";
import { runJobs } from "@/server/jobs-runner";
import { addDays } from "@/modules/certificates/lib";
import { certCertificates } from "@/modules/certificates/schema";
import { issueCertificate, listTemplates, lookupCertificate, runExpiry, saveCourseRule } from "@/modules/certificates/service";
import { certWorld, useTempStorage } from "./helpers";

useTempStorage();
afterAll(closeDb);

const kinds = async (userId: string, kind: string) =>
  systemDb().select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.kind, kind)));

async function expiringWorld(name: string) {
  const w = await certWorld(name);
  const [t] = await listTemplates(w.admin);
  await saveCourseRule(w.admin, w.course.id, { templateId: t.id, autoIssue: true, validityMonths: 12, reminderDays: 30 });
  const { actor, enrolmentId } = await w.enrolled(`${name} Student`);
  await w.complete(enrolmentId);
  const [c] = await systemDb().select().from(certCertificates).where(eq(certCertificates.enrolmentId, enrolmentId));
  return { w, actor, c, enrolmentId };
}

describe("daily expiry job", () => {
  it("sends one renewal reminder N days before expiry", async () => {
    const { w, actor, c } = await expiringWorld("Remind U");
    const sys = systemActorFor(w.uni.id);
    expect(c.validUntil).toBeTruthy();
    expect(await runExpiry(sys, { today: addDays(c.validUntil!, -31) })).toEqual({ reminded: 0, expired: 0 });
    expect(await runExpiry(sys, { today: addDays(c.validUntil!, -30) })).toEqual({ reminded: 1, expired: 0 });
    expect(await runExpiry(sys, { today: addDays(c.validUntil!, -29) })).toEqual({ reminded: 0, expired: 0 });
    const notes = await kinds(actor.userId, "certificate.expiring");
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toMatch(/^Your Data Analytics certificate expires on /);
  });

  it("marks certificates past their last valid day as expired, once, and tells the student", async () => {
    const { w, actor, c } = await expiringWorld("Expire U");
    const sys = systemActorFor(w.uni.id);
    expect((await runExpiry(sys, { today: c.validUntil! })).expired).toBe(0);
    expect((await runExpiry(sys, { today: addDays(c.validUntil!, 1) })).expired).toBe(1);
    expect((await runExpiry(sys, { today: addDays(c.validUntil!, 2) })).expired).toBe(0);
    const [after] = await systemDb().select().from(certCertificates).where(eq(certCertificates.id, c.id));
    expect(after.status).toBe("expired");
    expect(after.expiredAt).toBeTruthy();
    expect(await kinds(actor.userId, "certificate.expired")).toHaveLength(1);
  });

  it("an expired certificate shows as expired on the verify page", async () => {
    const { w, c } = await expiringWorld("Expired Verify U");
    await systemDb().update(certCertificates).set({ issuedOn: "2020-01-01", completedOn: "2020-01-01", validUntil: "2020-12-31" }).where(eq(certCertificates.id, c.id));
    expect((await lookupCertificate(c.code))?.status).toBe("expired");
    await runExpiry(systemActorFor(w.uni.id));
    expect((await lookupCertificate(c.code))?.status).toBe("expired");
  });

  it("skips certificates that have been renewed, and courses without a reminder", async () => {
    const { w, actor, c, enrolmentId } = await expiringWorld("Renewed U");
    await systemDb().update(certCertificates).set({ issuedOn: "2020-01-01", completedOn: "2020-01-01", validUntil: "2020-12-31" }).where(eq(certCertificates.id, c.id));
    await issueCertificate(w.admin, { enrolmentId, reason: "Refresher completed" });
    const r = await runExpiry(systemActorFor(w.uni.id));
    expect(r.expired).toBe(1);
    expect(await kinds(actor.userId, "certificate.expired")).toHaveLength(0);

    const n = await certWorld("No Reminder U");
    const [t] = await listTemplates(n.admin);
    await saveCourseRule(n.admin, n.course.id, { templateId: t.id, autoIssue: true, validityMonths: 6, reminderDays: null });
    const { enrolmentId: e2 } = await n.enrolled("No Reminder Student");
    await n.complete(e2);
    const [d] = await systemDb().select().from(certCertificates).where(eq(certCertificates.enrolmentId, e2));
    expect((await runExpiry(systemActorFor(n.uni.id), { today: addDays(d.validUntil!, -1) })).reminded).toBe(0);
  });

  it("runs through the core job runner as certificates.expiry, once per university", async () => {
    const { w } = await expiringWorld("Runner U");
    const report = await runJobs("day", { universityId: w.uni.id });
    expect(report.find((r) => r.jobId === "certificates.expiry")).toMatchObject({ ok: true, universityId: w.uni.id });
  });
});
