/** Consent: each purpose on its own, recorded with the notice version and a hashed IP; withdrawn as easily as given. */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import { dpdpConsents } from "@/modules/privacy/schema";
import { NOTICE_VERSION } from "@/modules/privacy/lib/rules";
import { grantConsent, myConsents, recordKycConsent, recordSignupConsents, withdrawConsent } from "@/modules/privacy/services/consents";
import { instituteWithStudent, marketplaceLearner } from "./helpers";

afterAll(closeDb);

describe("consent records", () => {
  it("grants news for the institute, then withdraws it with one call", async () => {
    const { student, uni } = await instituteWithStudent();
    const row = await grantConsent(student, "marketing", { ip: "203.0.113.9" });
    expect(row).toMatchObject({ universityId: uni.id, userId: student.userId, purpose: "marketing", noticeVersion: NOTICE_VERSION, withdrawnAt: null, source: "profile" });
    expect(row!.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(row!.ipHash).not.toContain("203.0.113.9");

    const done = await withdrawConsent(student, row!.id);
    expect(done.withdrawnAt).toBeInstanceOf(Date);
    const mine = await myConsents(student);
    expect(mine.find((c) => c.id === row!.id)?.withdrawnAt).toBeInstanceOf(Date);

    // Both were logged.
    const log = await systemDb().select().from(auditLog).where(and(eq(auditLog.entityId, row!.id), eq(auditLog.entity, "dpdp_consents")));
    expect(log.map((l) => l.action).sort()).toEqual(["privacy.consent.grant", "privacy.consent.withdraw"]);

    // Giving it again adds a new row, so the history stays whole.
    const again = await grantConsent(student, "marketing", { ip: null });
    expect(again!.id).not.toBe(row!.id);
  });

  it("records sign-up consents per purpose, news only when ticked, for Zinny and the institute joined", async () => {
    const { student, uni } = await instituteWithStudent();
    await recordSignupConsents({ ...student, universityId: null }, { source: "student_signup", consents: { marketing: false }, ip: "198.51.100.4", instituteId: uni.id });
    const rows = await systemDb().select().from(dpdpConsents).where(eq(dpdpConsents.userId, student.userId));
    const key = (r: { purpose: string; universityId: string | null }) => `${r.universityId ? "uni" : "zinny"}:${r.purpose}`;
    expect(rows.map(key).sort()).toEqual(["uni:account", "uni:service", "zinny:account", "zinny:service"]);
    expect(rows.every((r) => r.source === "student_signup" && r.noticeVersion === NOTICE_VERSION)).toBe(true);
  });

  it("records the KYC consent on the institute's record", async () => {
    const { student, uni } = await instituteWithStudent();
    await recordKycConsent(student, { ip: null });
    const [row] = await systemDb().select().from(dpdpConsents).where(and(eq(dpdpConsents.userId, student.userId), eq(dpdpConsents.purpose, "kyc")));
    expect(row.universityId).toBe(uni.id);
  });

  it("won't withdraw account or service: that takes an erasure request", async () => {
    const { user, actor } = await marketplaceLearner();
    await recordSignupConsents(actor, { source: "student_signup", consents: { marketing: true }, ip: null });
    const mine = await myConsents(actor);
    expect(mine.map((c) => c.purpose).sort()).toEqual(["account", "marketing", "service"]);
    const account = mine.find((c) => c.purpose === "account")!;
    await expect(withdrawConsent(actor, account.id)).rejects.toThrow(/erased/);
    const news = mine.find((c) => c.purpose === "marketing")!;
    expect((await withdrawConsent(actor, news.id)).withdrawnAt).toBeInstanceOf(Date);
    expect(user.id).toBe(actor.userId);
  });

  it("won't let someone withdraw another person's consent", async () => {
    const a = await marketplaceLearner();
    const b = await marketplaceLearner();
    await recordSignupConsents(a.actor, { source: "student_signup", consents: { marketing: true }, ip: null });
    const news = (await myConsents(a.actor)).find((c) => c.purpose === "marketing")!;
    await expect(withdrawConsent(b.actor, news.id)).rejects.toThrow(/not found/i);
  });

  it("refuses sign-up consents for an account that isn't brand new", async () => {
    const { user, actor } = await marketplaceLearner();
    await systemDb().execute(`update users set created_at = now() - interval '2 hours' where id = '${user.id}'`);
    await expect(recordSignupConsents(actor, { source: "student_signup", consents: { marketing: false }, ip: null })).rejects.toThrow();
  });
});
