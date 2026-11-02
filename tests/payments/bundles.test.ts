import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { loadActor } from "@/server/actor";
import { abandonBundle, bundleView, payBundleInTestMode, startBundle, verifyBundlePayment } from "@/modules/payments/bundles";
import { payBundles } from "@/modules/payments/schema";
import { grant } from "../fixtures";
import { checkoutSig, fakeRazorpay, invoiceOf, orderRow, paidCourse, paymentEvent, postWebhook, startCheckout, useRazorpay, type FakeRazorpay } from "./helpers";

afterAll(closeDb);

/** One learner with a seat held at two institutes: what a marketplace cart turns into. */
async function twoInstitutes(tag: string) {
  const a = await paidCourse(`Bundle ${tag} A`);
  const b = await paidCourse(`Bundle ${tag} B`, { pricePaise: 500_000 });
  const atA = await a.student(`Bundle ${tag} Learner`);
  await grant(atA.userId, "student", { universityId: b.uni.id });
  const atB = await loadActor(atA.userId, b.uni.id);
  const one = await startCheckout(atA, a.batch.id);
  const two = await startCheckout(atB, b.batch.id);
  return { userId: atA.userId, orderIds: [one.orderId, two.orderId], total: one.order.totalPaise + two.order.totalPaise };
}

const bundleRow = async (id: string) => (await systemDb().select().from(payBundles).where(eq(payBundles.id, id)))[0];

describe("one payment for several orders", () => {
  let fake: FakeRazorpay;
  let undo: () => void;
  beforeEach(() => {
    fake = fakeRazorpay();
    undo = useRazorpay(fake);
  });
  afterEach(() => undo());

  it("pays orders at different institutes with one Razorpay payment, each with its own invoice", async () => {
    const t = await twoInstitutes("Pay");
    const { bundleId } = await startBundle(t.userId, t.orderIds);
    const b = await bundleRow(bundleId);
    expect(b).toMatchObject({ totalPaise: t.total, gateway: "razorpay", status: "pending" });
    expect((await bundleView(t.userId, bundleId)).items).toHaveLength(2);

    const p = fake.pay(b.gatewayOrderId);
    expect(p.amount).toBe(t.total);
    await verifyBundlePayment(t.userId, { bundleId, razorpayOrderId: b.gatewayOrderId, razorpayPaymentId: p.id, signature: checkoutSig(b.gatewayOrderId, p.id) });
    for (const id of t.orderIds) {
      expect(await orderRow(id)).toMatchObject({ status: "paid", gatewayPaymentId: p.id });
      expect(await invoiceOf(id)).toBeTruthy();
    }
    expect(await bundleRow(bundleId)).toMatchObject({ status: "paid", gatewayPaymentId: p.id });
  });

  it("refuses a bad signature, and someone else's bundle", async () => {
    const t = await twoInstitutes("Sig");
    const { bundleId } = await startBundle(t.userId, t.orderIds);
    const b = await bundleRow(bundleId);
    const p = fake.pay(b.gatewayOrderId);
    await expect(verifyBundlePayment(t.userId, { bundleId, razorpayOrderId: b.gatewayOrderId, razorpayPaymentId: p.id, signature: "nope" })).rejects.toMatchObject({ status: 422 });
    const other = await twoInstitutes("Sig Other");
    await expect(bundleView(other.userId, bundleId)).rejects.toMatchObject({ status: 404 });
    await expect(startBundle(other.userId, t.orderIds)).rejects.toMatchObject({ status: 404 });
    for (const id of t.orderIds) expect((await orderRow(id)).status).toBe("pending");
  });

  it("settles a bundle from the webhook when the browser never comes back, once", async () => {
    const t = await twoInstitutes("Hook");
    const { bundleId } = await startBundle(t.userId, t.orderIds);
    const b = await bundleRow(bundleId);
    const p = fake.pay(b.gatewayOrderId);
    expect(await postWebhook(paymentEvent("payment.captured", p))).toMatchObject({ status: 200, body: { status: "processed", outcome: "bundle_paid_2" } });
    for (const id of t.orderIds) expect((await orderRow(id)).status).toBe("paid");

    const again = fake.pay(b.gatewayOrderId);
    expect(await postWebhook(paymentEvent("payment.captured", again))).toMatchObject({ body: { outcome: "bundle_duplicate_payment" } });
    const short = fake.pay(b.gatewayOrderId, { amount: t.total - 100 });
    expect(await postWebhook(paymentEvent("payment.captured", short))).toMatchObject({ body: { status: "rejected", outcome: "bundle_amount_mismatch" } });
  });

  it("releases every seat when the payment fails or the learner gives up", async () => {
    const failed = await twoInstitutes("Fail");
    const f = await startBundle(failed.userId, failed.orderIds);
    const fb = await bundleRow(f.bundleId);
    await postWebhook(paymentEvent("payment.failed", fake.pay(fb.gatewayOrderId, { status: "failed" })));
    for (const id of failed.orderIds) expect((await orderRow(id)).status).toBe("failed");
    expect((await bundleRow(f.bundleId)).status).toBe("failed");

    const quit = await twoInstitutes("Quit");
    const q = await startBundle(quit.userId, quit.orderIds);
    await abandonBundle(quit.userId, q.bundleId);
    for (const id of quit.orderIds) expect((await orderRow(id)).status).toBe("failed");
  });

  it("moves orders out of an earlier unpaid bundle when the learner checks out again", async () => {
    const t = await twoInstitutes("Again");
    const first = await startBundle(t.userId, t.orderIds);
    const second = await startBundle(t.userId, t.orderIds);
    expect((await bundleRow(first.bundleId)).status).toBe("expired");
    expect((await bundleView(t.userId, second.bundleId)).items).toHaveLength(2);
    expect((await bundleView(t.userId, first.bundleId)).items).toHaveLength(0);
  });
});

describe("test mode", () => {
  it("pays a bundle with the mock gateway", async () => {
    const t = await twoInstitutes("Mock");
    const { bundleId } = await startBundle(t.userId, t.orderIds);
    expect((await bundleRow(bundleId)).gateway).toBe("mock");
    await payBundleInTestMode(t.userId, bundleId);
    for (const id of t.orderIds) expect((await orderRow(id)).status).toBe("paid");
  });

  it("keeps bundles away from the app's database role", async () => {
    const c = await paidCourse("Bundle Role U");
    const { withTenant } = await import("@/server/tenant");
    await expect(withTenant(c.admin, (tx) => tx.select().from(payBundles))).rejects.toThrow();
  });
});
