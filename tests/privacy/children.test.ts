/** Learners under 18: blocked from optional purposes and tracking until a parent or guardian confirms (Act s.9, Rule 10). */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { dpdpConsents } from "@/modules/privacy/schema";
import { grantConsent } from "@/modules/privacy/services/consents";
import { checkAgeInput, confirmGuardianConsent, guardianLink, minorState, startGuardianConsent, trackingAllowed } from "@/modules/privacy/services/children";
import { instituteWithStudent } from "./helpers";

afterAll(closeDb);

describe("age declaration", () => {
  const today = "2026-11-19";
  it("an adult needs no guardian", () => {
    expect(checkAgeInput({ age: "adult" }, today)).toBeNull();
    expect(checkAgeInput({ age: "", birthDate: "2000-01-01" }, today)).toBeNull();
  });
  it("must be answered", () => {
    expect(() => checkAgeInput({ age: "" }, today)).toThrow(/18 or older/);
  });
  it("a date of birth under 18 wins over a ticked adult box", () => {
    expect(() => checkAgeInput({ age: "adult", birthDate: "2010-05-01" }, today)).toThrow(/guardian's full name/);
    expect(checkAgeInput({ age: "adult", birthDate: "2010-05-01", guardianName: "Lakshmi Iyer", guardianContact: "98200 11001" }, today)).toEqual({
      birthDate: "2010-05-01",
      guardianName: "Lakshmi Iyer",
      guardianEmail: null,
      guardianPhone: "+919820011001",
    });
  });
  it("needs a real way to reach the guardian", () => {
    expect(() => checkAgeInput({ age: "minor", guardianName: "Parent Name", guardianContact: "call me" }, today)).toThrow(/email address or 10-digit/);
  });
});

describe("verifiable parental consent", () => {
  it("blocks a minor until the guardian confirms through the link", async () => {
    const { student, uni } = await instituteWithStudent();
    const details = checkAgeInput({ age: "minor", guardianName: "Lakshmi Iyer", guardianContact: "lakshmi@example.com" }, "2026-11-19")!;
    const { sentTo, token } = await startGuardianConsent(student, details, { ip: "203.0.113.1", linkBase: "http://zinny.test" });
    expect(sentTo).toBe("la•••••@example.com");

    // Blocked: no tracking, no optional purposes.
    expect(await trackingAllowed(student.userId)).toBe(false);
    expect(await minorState(student.userId)).toMatchObject({ minor: true, verified: false, guardianName: "Lakshmi Iyer" });
    await expect(grantConsent(student, "analytics", { ip: null })).rejects.toThrow(/parent or guardian/);

    // The guardian opens the link from their email and confirms.
    expect(await guardianLink(token)).toMatchObject({ state: "pending", learnerName: "Privacy", guardianName: "Lakshmi Iyer" });
    await expect(confirmGuardianConsent(token, { ip: null, agree: false })).rejects.toThrow(/Tick the box/);
    await confirmGuardianConsent(token, { ip: "198.51.100.2", agree: true });

    expect(await trackingAllowed(student.userId)).toBe(true);
    expect((await guardianLink(token)).state).toBe("verified");
    const [consent] = await systemDb().select().from(dpdpConsents).where(and(eq(dpdpConsents.userId, student.userId), eq(dpdpConsents.purpose, "guardian")));
    expect(consent).toMatchObject({ universityId: uni.id, source: "guardian", withdrawnAt: null });
    expect(await grantConsent(student, "analytics", { ip: null })).toMatchObject({ purpose: "analytics" });
  });

  it("an expired or unknown link does nothing", async () => {
    const { student } = await instituteWithStudent();
    const details = checkAgeInput({ age: "minor", guardianName: "Old Link", guardianContact: "old@example.com" }, "2026-11-19")!;
    const longAgo = new Date(Date.now() - 30 * 86_400_000);
    const { token } = await startGuardianConsent(student, details, { ip: null, linkBase: "http://zinny.test", now: longAgo });
    expect((await guardianLink(token)).state).toBe("expired");
    await expect(confirmGuardianConsent(token, { ip: null, agree: true })).rejects.toThrow(/expired/);
    expect((await guardianLink("not-a-real-token-at-all-xx")).state).toBe("invalid");
    expect(await trackingAllowed(student.userId)).toBe(false);
  });

  it("an adult is never blocked", async () => {
    const { student } = await instituteWithStudent();
    expect(await trackingAllowed(student.userId)).toBe(true);
    expect(await grantConsent(student, "analytics", { ip: null })).toMatchObject({ purpose: "analytics" });
  });
});
