/** Tenant isolation for every onb_ table. */
import { afterAll, describe, it } from "vitest";
import { closeDb } from "@/db/client";
import { onbDocuments, onbPlanOrders, onbSignups, onbStudentKyc } from "@/modules/onboarding/schema";
import { encryptSecret } from "@/modules/onboarding/lib/crypto";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeUser, uniqueCode } from "../fixtures";

afterAll(closeDb);

describe("onb_ tables are isolated per university", () => {
  it("onb_signups", () =>
    expectTenantIsolated(onbSignups, (uni) => ({
      universityId: uni.id,
      instituteType: "coaching",
      contactName: "Anita",
      contactEmail: "anita@onb.test",
      contactPhone: "+919820011001",
      city: "Pune",
    })));

  it("onb_documents", () =>
    expectTenantIsolated(onbDocuments, (uni) => ({
      universityId: uni.id,
      kind: "pan" as const,
      fileName: "PAN.pdf",
      contentType: "application/pdf",
      sizeBytes: 1000,
      storageKey: `${uni.id}/onboarding/documents/${uniqueCode()}.pdf`,
      status: "pending" as const,
    })));

  it("onb_plan_orders", () =>
    expectTenantIsolated(onbPlanOrders, (uni) => ({
      universityId: uni.id,
      planKey: "standard",
      planName: "Standard",
      basePaise: 100_00,
      gstPaise: 18_00,
      totalPaise: 118_00,
      gateway: "mock",
      gatewayOrderId: `order_${uniqueCode()}`,
    })));

  it("onb_student_kyc", () =>
    expectTenantIsolated(onbStudentKyc, async (uni) => ({
      universityId: uni.id,
      userId: (await makeUser(`Kyc ${uniqueCode()}`)).id,
      panCipher: encryptSecret("ABCDE1234F"),
      panMasked: "XXXXX1234F",
      aadhaarLast4: "1234",
      consentAt: new Date(),
      consentNoticeVersion: "test",
    })));
});
