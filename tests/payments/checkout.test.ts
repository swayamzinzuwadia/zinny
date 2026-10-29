import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, enrolments, notifications } from "@/db/schema";
import { abandonCheckout, checkoutView, failInTestMode, payInTestMode, verifyCheckoutPayment } from "@/modules/payments/checkout";
import { checkoutSig, fakeRazorpay, invoiceOf, orderRow, paidCourse, startCheckout, useRazorpay, type FakeRazorpay } from "./helpers";
import { eventsOfType } from "../helpers/events";

afterAll(closeDb);

describe("checkout with Razorpay", () => {
  let fake: FakeRazorpay;
  let undo: () => void;
  beforeEach(() => {
    fake = fakeRazorpay();
    undo = useRazorpay(fake);
  });
  afterEach(() => undo());

  it("creates the Razorpay order for the GST-inclusive total and shows the GST split and seat hold", async () => {
    const c = await paidCourse("Checkout View U");
    const s = await c.student("Riya View");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    expect(order.gateway).toBe("razorpay");
    expect(fake.orders.get(order.gatewayOrderId!)).toMatchObject({ amount: 1_180_000, currency: "INR" });
    const v = await checkoutView(s, orderId);
    expect(v.state).toBe("pay");
    expect(v.split).toEqual({ cgstPaise: 90_000, sgstPaise: 90_000, halfRatePercent: 9 });
    expect(v.enrolment?.holdExpiresAt).toBeInstanceOf(Date);
    expect(v.gateway.kind).toBe("razorpay");
    if (v.gateway.kind !== "razorpay") return;
    expect(v.gateway.options).toMatchObject({ key: "rzp_test_ZinnyKey01", order_id: order.gatewayOrderId, amount: 1_180_000, currency: "INR", prefill: { name: "Riya View" } });
    // UPI, cards and netbanking only.
    expect(JSON.stringify(v.gateway.options.config)).toContain('"upi"');
    expect(JSON.stringify(v.gateway.options.config)).toContain('"netbanking"');
    expect(JSON.stringify(v.gateway.options)).not.toContain("test_key_secret");
  });

  it("a verified payment enrols the student and issues the GST invoice", async () => {
    const c = await paidCourse("Checkout Pay U");
    const s = await c.student("Kabir Pay");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    const out = await verifyCheckoutPayment(s, { orderId, razorpayOrderId: order.gatewayOrderId!, razorpayPaymentId: p.id, signature: checkoutSig(order.gatewayOrderId!, p.id) });
    expect(out.status).toBe("enrolled");
    const o = await orderRow(orderId);
    expect(o).toMatchObject({ status: "paid", gatewayPaymentId: p.id });
    expect((await invoiceOf(orderId)).totalPaise).toBe(1_180_000);
    expect((await checkoutView(s, orderId)).state).toBe("paid");
    // Verifying again is harmless.
    const again = await verifyCheckoutPayment(s, { orderId, razorpayOrderId: order.gatewayOrderId!, razorpayPaymentId: p.id, signature: checkoutSig(order.gatewayOrderId!, p.id) });
    expect(again.status).toBe("already_paid");
    expect((await eventsOfType("payment.confirmed", c.uni.id)).filter((e) => e.payload.orderId === orderId)).toHaveLength(1);
  });

  it("captures a payment that Razorpay only authorised", async () => {
    const c = await paidCourse("Checkout Capture U");
    const s = await c.student("Aditi Capture");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!, { status: "authorized" });
    await verifyCheckoutPayment(s, { orderId, razorpayOrderId: order.gatewayOrderId!, razorpayPaymentId: p.id, signature: checkoutSig(order.gatewayOrderId!, p.id) });
    expect(fake.payments.get(p.id)?.status).toBe("captured");
    expect(fake.calls.some((x) => x.method === "POST" && x.path === `/payments/${p.id}/capture`)).toBe(true);
  });

  it("rejects a bad signature, and changes nothing", async () => {
    const c = await paidCourse("Checkout BadSig U");
    const s = await c.student("Ishaan BadSig");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    for (const signature of ["", "deadbeef", checkoutSig(order.gatewayOrderId!, p.id, "not-the-secret"), checkoutSig(order.gatewayOrderId!, "pay_someoneElse1")]) {
      await expect(verifyCheckoutPayment(s, { orderId, razorpayOrderId: order.gatewayOrderId!, razorpayPaymentId: p.id, signature })).rejects.toThrow(/couldn't verify/);
    }
    expect((await orderRow(orderId)).status).toBe("pending");
    const refusals = await systemDb().select().from(auditLog).where(and(eq(auditLog.action, "payment.verify_refused"), eq(auditLog.entityId, orderId)));
    expect(refusals.length).toBe(4);
  });

  it("rejects a genuine payment for a different order (signature valid for that other order)", async () => {
    const c = await paidCourse("Checkout Swap U", { seatLimit: 5 });
    const s = await c.student("Meera Swap");
    const other = await c.student("Rohan Other");
    const mine = await startCheckout(s, c.batch.id);
    const theirs = await startCheckout(other, c.batch.id);
    const p = fake.pay(theirs.order.gatewayOrderId!);
    await expect(
      verifyCheckoutPayment(s, { orderId: mine.orderId, razorpayOrderId: theirs.order.gatewayOrderId!, razorpayPaymentId: p.id, signature: checkoutSig(theirs.order.gatewayOrderId!, p.id) }),
    ).rejects.toThrow(/different order/);
    expect((await orderRow(mine.orderId)).status).toBe("pending");
    expect((await orderRow(theirs.orderId)).status).toBe("pending");
  });

  it("refuses a payment for an order from another university", async () => {
    const a = await paidCourse("Checkout Uni A");
    const b = await paidCourse("Checkout Uni B");
    const sa = await a.student("Sneha A");
    const sb = await b.student("Arjun B");
    const { orderId, order } = await startCheckout(sa, a.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    const input = { orderId, razorpayOrderId: order.gatewayOrderId!, razorpayPaymentId: p.id, signature: checkoutSig(order.gatewayOrderId!, p.id) };
    // A student of university B, or B's admin, can't confirm A's order, even with a valid signature.
    await expect(verifyCheckoutPayment(sb, input)).rejects.toThrow(/Order not found/);
    await expect(verifyCheckoutPayment(b.admin, input)).rejects.toThrow(/Order not found/);
    await expect(checkoutView(sb, orderId)).rejects.toThrow(/Order not found/);
    await expect(abandonCheckout(sb, orderId, { reason: "dismissed" })).rejects.toThrow(/Order not found/);
    // Another student of the same university can't either.
    await expect(verifyCheckoutPayment(await a.student("Zoya Same Uni"), input)).rejects.toThrow(/Order not found/);
    expect((await orderRow(orderId)).status).toBe("pending");
  });

  it("refuses a payment whose amount doesn't match the order", async () => {
    const c = await paidCourse("Checkout Amount U");
    const s = await c.student("Tara Amount");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!, { amount: 100 });
    await expect(verifyCheckoutPayment(s, { orderId, razorpayOrderId: order.gatewayOrderId!, razorpayPaymentId: p.id, signature: checkoutSig(order.gatewayOrderId!, p.id) })).rejects.toThrow(/doesn't match/);
    expect((await orderRow(orderId)).status).toBe("pending");
  });

  it("still confirms on a valid signature when Razorpay can't be reached for the double-check", async () => {
    const c = await paidCourse("Checkout Offline U");
    const s = await c.student("Neil Offline");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    fake.failNext(/GET \/payments\//, "network");
    fake.failNext(/GET \/payments\//, "network");
    const out = await verifyCheckoutPayment(s, { orderId, razorpayOrderId: order.gatewayOrderId!, razorpayPaymentId: p.id, signature: checkoutSig(order.gatewayOrderId!, p.id) });
    expect(out.status).toBe("enrolled");
  });

  it("dismissing or failing the checkout releases the seat through core failPayment", async () => {
    const c = await paidCourse("Checkout Dismiss U", { seatLimit: 1 });
    const s = await c.student("Diya Dismiss");
    const { orderId, enrolmentId } = await startCheckout(s, c.batch.id);
    const other = await c.student("Waiting Student");
    await expect(startCheckout(other, c.batch.id)).rejects.toThrow(/full/);
    await abandonCheckout(s, orderId, { reason: "failed", code: "BAD_REQUEST_ERROR", description: "Payment failed" });
    expect((await orderRow(orderId)).status).toBe("failed");
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.id, enrolmentId));
    expect(e.status).toBe("cancelled");
    expect((await checkoutView(s, orderId)).state).toBe("closed");
    // The seat is free again.
    await expect(startCheckout(other, c.batch.id)).resolves.toBeTruthy();
    // Dismissing again changes nothing.
    expect(await abandonCheckout(s, orderId, { reason: "dismissed" })).toEqual({ status: "failed" });
  });

  it("a payment that succeeds after a failed attempt still enrols when the seat is free", async () => {
    const c = await paidCourse("Checkout Retry U");
    const s = await c.student("Retry Student");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    await abandonCheckout(s, orderId, { reason: "failed" });
    const p = fake.pay(order.gatewayOrderId!);
    const out = await verifyCheckoutPayment(s, { orderId, razorpayOrderId: order.gatewayOrderId!, razorpayPaymentId: p.id, signature: checkoutSig(order.gatewayOrderId!, p.id) });
    expect(out.status).toBe("enrolled");
  });

  it("the test-mode button is off while Razorpay is active", async () => {
    const c = await paidCourse("Checkout NoTest U");
    const s = await c.student("No Test");
    const { orderId } = await startCheckout(s, c.batch.id);
    await expect(payInTestMode(s, orderId)).rejects.toThrow(/Test payments are off/);
  });
});

describe("checkout with the mock gateway (test mode)", () => {
  it("keeps the test-mode button: paying enrols and issues the invoice", async () => {
    const c = await paidCourse("Mock Pay U");
    const s = await c.student("Mock Payer");
    const { orderId } = await startCheckout(s, c.batch.id);
    const v = await checkoutView(s, orderId);
    expect(v.gateway).toEqual({ kind: "mock", testMode: true });
    expect(v.state).toBe("pay");
    expect((await payInTestMode(s, orderId)).status).toBe("enrolled");
    expect((await orderRow(orderId)).gatewayPaymentId).toMatch(/^mock_pay_/);
    expect(await invoiceOf(orderId)).toBeTruthy();
    const [n] = await systemDb().select().from(notifications).where(and(eq(notifications.userId, s.userId), eq(notifications.kind, "enrolment.confirmed")));
    expect(n.title).toMatch(/enrolled/);
  });

  it("can simulate a failed payment", async () => {
    const c = await paidCourse("Mock Fail U");
    const s = await c.student("Mock Failer");
    const { orderId } = await startCheckout(s, c.batch.id);
    await failInTestMode(s, orderId);
    expect((await orderRow(orderId)).status).toBe("failed");
    await expect(payInTestMode(s, orderId)).rejects.toThrow(/closed/);
  });

  it("is off on a production site that isn't a demo", async () => {
    const c = await paidCourse("Mock Prod U");
    const s = await c.student("Prod Student");
    const { orderId } = await startCheckout(s, c.batch.id);
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      await expect(payInTestMode(s, orderId)).rejects.toThrow(/off on this site/);
      const v = await checkoutView(s, orderId);
      expect(v.state).toBe("unavailable");
      expect(v.problem).toMatch(/aren't set up/);
    } finally {
      env.NODE_ENV = before;
    }
  });
});
