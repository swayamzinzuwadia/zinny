/** Download my data (PAN masked), and erasure: personal fields anonymised, KYC deleted, invoices kept. */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { invoices, orders, roleAssignments, users } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { confirmPayment } from "@/server/services/enrolment";
import { saveKyc } from "@/modules/onboarding/services/kyc";
import { onbStudentKyc } from "@/modules/onboarding/schema";
import { dpdpConsents, dpdpRequests } from "@/modules/privacy/schema";
import { exportMyData, ERASED_NAME } from "@/modules/privacy/services/erasure";
import { decideRequest, fileRequest, myRequests } from "@/modules/privacy/services/requests";
import { grantConsent } from "@/modules/privacy/services/consents";
import { buyRecordings, grant, makeUniversity, setupCourse } from "../fixtures";

afterAll(closeDb);

async function paidStudentWithKyc() {
  const t = await setupCourse({ name: "Erasure Uni", pricePaise: 150_000 });
  const student = await t.student("Kiran Erasure");
  await saveKyc(student, { pan: "ABCDE1234F", aadhaarLast4: "4321", consent: true });
  const held = await buyRecordings(student, t.batch.id);
  await confirmPayment(t.uni.id, { orderId: held.order.id, gatewayPaymentId: `pay_${held.order.id.slice(0, 8)}` });
  return { ...t, student };
}

describe("download my data", () => {
  it("contains the profile, enrolments, orders and KYC with the PAN masked, never the PAN", async () => {
    const { student } = await paidStudentWithKyc();
    const data = await exportMyData(student);
    const json = JSON.stringify(data);
    expect(data.profile?.name).toBe("Kiran Erasure");
    expect(data.kyc).toEqual([expect.objectContaining({ status: "on file", pan: "XXXXX1234F", aadhaarLast4: "4321" })]);
    expect(json).not.toContain("ABCDE1234F");
    expect(json).not.toContain("panCipher");
    expect(data.enrolments.length).toBeGreaterThanOrEqual(1);
    expect(data.orders).toEqual([expect.objectContaining({ status: "paid", total: "₹1770.00", invoiceNumber: expect.any(String) })]);
    // The download itself is logged as an answered access request.
    expect((await myRequests(student)).some((r) => r.kind === "access" && r.status === "completed")).toBe(true);
  });
});

describe("erasure", () => {
  it("anonymises personal fields and deletes KYC, but keeps invoices and the consent log", async () => {
    const { student, admin, uni } = await paidStudentWithKyc();
    await grantConsent(student, "marketing", { ip: null });
    const [invoiceBefore] = await systemDb().select().from(invoices).innerJoin(orders, eq(orders.id, invoices.orderId)).where(eq(orders.userId, student.userId));
    expect(invoiceBefore.invoices.buyerName).toBe("Kiran Erasure");

    const req = await fileRequest(student, { kind: "erasure", details: "Please erase my account." });
    expect(req.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const { request, erased } = await decideRequest(admin, { requestId: req.id, status: "completed", response: "" });

    expect(erased).toMatchObject({ anonymised: true, kycDeleted: 1, invoicesKept: 1 });
    expect(request.status).toBe("completed");
    expect(request.response).toMatch(/GST invoice/);

    const [u] = await systemDb().select().from(users).where(eq(users.id, student.userId));
    expect(u).toMatchObject({ name: ERASED_NAME, phone: null, passwordHash: null });
    expect(u.email).toMatch(/@erased\.invalid$/);
    expect(await systemDb().select().from(onbStudentKyc).where(eq(onbStudentKyc.userId, student.userId))).toEqual([]);

    // Invoices stay, exactly as issued: GST law requires them.
    const [invoiceAfter] = await systemDb().select().from(invoices).where(eq(invoices.id, invoiceBefore.invoices.id));
    expect(invoiceAfter).toEqual(invoiceBefore.invoices);
    // The consent log stays, withdrawn.
    const consents = await systemDb().select().from(dpdpConsents).where(eq(dpdpConsents.userId, student.userId));
    expect(consents.length).toBeGreaterThan(0);
    expect(consents.filter((c) => c.universityId === uni.id).every((c) => c.withdrawnAt)).toBe(true);
    // Their roles here have ended.
    const roles = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, student.userId));
    expect(roles.every((r) => r.revokedAt)).toBe(true);
  });

  it("keeps the shared sign-in when the person still studies at another institute", async () => {
    const { student, admin } = await paidStudentWithKyc();
    const other = await makeUniversity("Other Institute");
    await grant(student.userId, "student", { universityId: other.id });
    const req = await fileRequest(await loadActor(student.userId, admin.universityId, { session: null }), { kind: "erasure", details: "" });
    const { erased } = await decideRequest(admin, { requestId: req.id, status: "completed", response: "Done." });
    expect(erased).toMatchObject({ anonymised: false, kycDeleted: 1 });
    const [u] = await systemDb().select().from(users).where(eq(users.id, student.userId));
    expect(u.name).toBe("Kiran Erasure");
  });

  it("a refusal needs a reason, and closed requests stay closed", async () => {
    const { student, admin } = await paidStudentWithKyc();
    const req = await fileRequest(student, { kind: "correction", details: "My name is spelt wrong on my certificate." });
    await expect(decideRequest(admin, { requestId: req.id, status: "refused", response: "No" })).rejects.toThrow(/why/);
    await decideRequest(admin, { requestId: req.id, status: "refused", response: "Certificates show the name you gave at enrolment; change it on your profile first." });
    await expect(decideRequest(admin, { requestId: req.id, status: "completed", response: "Done" })).rejects.toThrow(/already closed/);
    const [row] = await systemDb().select().from(dpdpRequests).where(eq(dpdpRequests.id, req.id));
    expect(row.status).toBe("refused");
  });

  it("one open request of a kind at a time", async () => {
    const { student } = await paidStudentWithKyc();
    await fileRequest(student, { kind: "grievance", details: "Nobody answered my email about my data." });
    await expect(fileRequest(student, { kind: "grievance", details: "Still nobody answered my email." })).rejects.toThrow(/already have/);
  });
});
