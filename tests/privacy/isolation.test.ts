/** Every privacy table with a university is isolated between institutes (CLAUDE.md rule 10). */
import { afterAll, describe, it } from "vitest";
import { closeDb } from "@/db/client";
import { dpdpConsents, dpdpGuardianConsents, dpdpRequests, dpdpRetentionFlags, dpdpSettings } from "@/modules/privacy/schema";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeUser } from "../fixtures";

afterAll(closeDb);

describe("privacy tables are isolated per institute", () => {
  it("dpdp_consents", () =>
    expectTenantIsolated(dpdpConsents, async (uni) => ({ universityId: uni.id, userId: (await makeUser("Iso Consent")).id, purpose: "account" as const, noticeVersion: "t", source: "test" })));

  it("dpdp_requests", () =>
    expectTenantIsolated(dpdpRequests, async (uni) => ({ universityId: uni.id, userId: (await makeUser("Iso Request")).id, kind: "erasure" as const, dueOn: "2030-01-01" })));

  it("dpdp_guardian_consents", () =>
    expectTenantIsolated(dpdpGuardianConsents, async (uni) => ({
      universityId: uni.id,
      userId: (await makeUser("Iso Minor")).id,
      guardianName: "Parent",
      guardianEmail: "parent@example.com",
      tokenHash: `h-${Math.random()}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    })));

  it("dpdp_settings", () => expectTenantIsolated(dpdpSettings, (uni) => ({ universityId: uni.id, inactiveDays: 400 })));

  it("dpdp_retention_flags", () =>
    expectTenantIsolated(dpdpRetentionFlags, async (uni) => ({ universityId: uni.id, userId: (await makeUser("Iso Flag")).id, lastActiveAt: new Date("2020-01-01") })));
});
