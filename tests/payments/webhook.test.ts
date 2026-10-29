import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, domainEvents, enrolments, invoices, notifications, orders } from "@/db/schema";
import { payRefunds, payWebhookEvents } from "@/modules/payments/schema";
import { refundOrder } from "@/modules/payments/refunds";
import { drainEvents, eventsOfType } from "../helpers/events";
import { fakeRazorpay, orderRow, paidCourse, paymentEvent, postWebhook, refundEvent, startCheckout, useRazorpay, webhookSig, type FakeRazorpay } from "./helpers";

afterAll(closeDb);

/** Everything a webhook could change, for "changes nothing" checks. */
async function snapshot(universityId: string) {
  const db = systemDb();
  const n = async (t: typeof orders | typeof invoices | typeof notifications | typeof domainEvents | typeof auditLog | typeof enrolments | typeof payRefunds) =>
    (await db.select({ n: count() }).from(t).where(eq(t.universityId, universityId)))[0].n;
  const os = await db.select({ id: orders.id, status: orders.status, pay: orders.gatewayPaymentId }).from(orders).where(eq(orders.universityId, universityId));
  const es = await db.select({ id: enrolments.id, status: enrolments.status }).from(enrolments).where(eq(enrolments.universityId, universityId));
  return {
    orders: os.sort((a, b) => a.id.localeCompare(b.id)),
    enrolments: es.sort((a, b) => a.id.localeCompare(b.id)),
    invoices: await n(invoices),
    notifications: await n(notifications),
    events: await n(domainEvents),
    audit: await n(auditLog),
    refunds: await n(payRefunds),
  };
}

describe("Razorpay webhook", () => {
  let fake: FakeRazorpay;
  let undo: () => void;
  beforeEach(() => {
    fake = fakeRazorpay();
    undo = useRazorpay(fake);
  });
  afterEach(() => undo());

  it("payment.captured enrols the student, finding the university from the order", async () => {
    const c = await paidCourse("Hook Capture U");
    const s = await c.student("Hook Riya");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    const res = await postWebhook(paymentEvent("payment.captured", p));
    expect(res).toMatchObject({ status: 200, body: { status: "processed", outcome: "enrolled" } });
    expect(await orderRow(orderId)).toMatchObject({ status: "paid", gatewayPaymentId: p.id });
    const [row] = await systemDb().select().from(payWebhookEvents).where(eq(payWebhookEvents.eventId, res.eventId));
    expect(row).toMatchObject({ universityId: c.uni.id, orderId, status: "processed", outcome: "enrolled", eventType: "payment.captured", gatewayPaymentId: p.id, amountPaise: 1_180_000 });
  });

  it("rejects a bad signature with 400 and stores nothing", async () => {
    const c = await paidCourse("Hook BadSig U");
    const s = await c.student("Hook Bad");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const body = paymentEvent("payment.captured", fake.pay(order.gatewayOrderId!));
    const before = await snapshot(c.uni.id);
    for (const signature of ["", "00", webhookSig(body, "wrong-secret"), webhookSig(`${body}\n`)]) {
      const res = await postWebhook(body, { signature });
      expect(res).toMatchObject({ status: 400, body: { error: "invalid_signature" } });
    }
    // A signed body that was tampered with afterwards.
    const tampered = body.replace(String(1_180_000), "100");
    expect((await postWebhook(tampered, { signature: webhookSig(body) })).status).toBe(400);
    expect(await snapshot(c.uni.id)).toEqual(before);
    expect((await orderRow(orderId)).status).toBe("pending");
    expect(await systemDb().select().from(payWebhookEvents).where(eq(payWebhookEvents.universityId, c.uni.id))).toEqual([]);
  });

  it("the same webhook twice changes nothing (same event id, or the same body with a new event id)", async () => {
    const c = await paidCourse("Hook Replay U");
    const s = await c.student("Hook Kabir");
    const { order } = await startCheckout(s, c.batch.id);
    const body = paymentEvent("payment.captured", fake.pay(order.gatewayOrderId!));
    const first = await postWebhook(body);
    expect(first.status).toBe(200);
    await drainEvents();
    const after = await snapshot(c.uni.id);
    const again = await postWebhook(body, { eventId: first.eventId });
    expect(again).toMatchObject({ status: 200, body: { duplicate: true, status: "processed" } });
    const replay = await postWebhook(body, { eventId: "evt_attacker_new_id" });
    expect(replay).toMatchObject({ status: 200, body: { duplicate: true } });
    await drainEvents();
    expect(await snapshot(c.uni.id)).toEqual(after);
    expect(await systemDb().select().from(payWebhookEvents).where(eq(payWebhookEvents.universityId, c.uni.id))).toHaveLength(1);
  });

  it("order.paid and payment.captured for one payment enrol once", async () => {
    const c = await paidCourse("Hook Both U");
    const s = await c.student("Hook Both");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    expect((await postWebhook(paymentEvent("payment.captured", p))).body.outcome).toBe("enrolled");
    expect((await postWebhook(paymentEvent("order.paid", p))).body.outcome).toBe("already_paid");
    expect((await eventsOfType("payment.confirmed", c.uni.id)).filter((e) => e.payload.orderId === orderId)).toHaveLength(1);
  });

  it("refuses a payment whose amount or currency doesn't match, and tells Accounts", async () => {
    const c = await paidCourse("Hook Mismatch U");
    const s = await c.student("Hook Mismatch");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const res = await postWebhook(paymentEvent("payment.captured", fake.pay(order.gatewayOrderId!, { amount: 100 })));
    expect(res).toMatchObject({ status: 200, body: { status: "rejected", outcome: "amount_mismatch" } });
    expect((await orderRow(orderId)).status).toBe("pending");
    const usd = await postWebhook(paymentEvent("payment.captured", fake.pay(order.gatewayOrderId!, { currency: "USD" })));
    expect(usd.body.outcome).toBe("amount_mismatch");
    const told = await systemDb().select().from(notifications).where(and(eq(notifications.userId, c.accounts.userId), eq(notifications.kind, "finance.payment_rejected")));
    expect(told.length).toBe(2);
  });

  it("refuses a payment that names another university than its order's", async () => {
    const a = await paidCourse("Hook Uni A");
    const b = await paidCourse("Hook Uni B");
    const s = await a.student("Hook Cross");
    const { orderId, order } = await startCheckout(s, a.batch.id);
    const p = fake.pay(order.gatewayOrderId!, { notes: { orderId, universityId: b.uni.id } });
    const res = await postWebhook(paymentEvent("payment.captured", p));
    expect(res.body).toMatchObject({ status: "rejected", outcome: "university_mismatch" });
    expect((await orderRow(orderId)).status).toBe("pending");
    // Nothing was written in university B.
    expect(await systemDb().select().from(payWebhookEvents).where(eq(payWebhookEvents.universityId, b.uni.id))).toEqual([]);
  });

  it("ignores orders that aren't Zinny's (another app on the same Razorpay account)", async () => {
    const p = fake.pay("order_NotOurs12345");
    expect(await postWebhook(paymentEvent("payment.captured", p))).toMatchObject({ status: 200, body: { ignored: "unknown_order" } });
  });

  it("payment.failed releases the seat; a late failure never undoes a payment", async () => {
    const c = await paidCourse("Hook Fail U", { seatLimit: 1 });
    const s = await c.student("Hook Failer");
    const { orderId, enrolmentId, order } = await startCheckout(s, c.batch.id);
    const failed = fake.pay(order.gatewayOrderId!, { status: "failed" });
    expect((await postWebhook(paymentEvent("payment.failed", failed))).body).toMatchObject({ outcome: "seat_released" });
    expect((await orderRow(orderId)).status).toBe("failed");
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.id, enrolmentId));
    expect(e.status).toBe("cancelled");

    const s2 = await c.student("Hook Payer");
    const second = await startCheckout(s2, c.batch.id);
    const ok = fake.pay(second.order.gatewayOrderId!);
    await postWebhook(paymentEvent("payment.captured", ok));
    const late = fake.pay(second.order.gatewayOrderId!, { status: "failed" });
    expect((await postWebhook(paymentEvent("payment.failed", late))).body).toMatchObject({ outcome: "order_paid" });
    expect((await orderRow(second.orderId)).status).toBe("paid");
  });

  it("a second captured payment for a paid order is flagged for Accounts, not applied", async () => {
    const c = await paidCourse("Hook Twice U");
    const s = await c.student("Hook Twice");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p1 = fake.pay(order.gatewayOrderId!);
    const p2 = fake.pay(order.gatewayOrderId!);
    await postWebhook(paymentEvent("payment.captured", p1));
    expect((await postWebhook(paymentEvent("payment.captured", p2))).body).toMatchObject({ outcome: "duplicate_payment" });
    expect((await orderRow(orderId)).gatewayPaymentId).toBe(p1.id);
    const told = await systemDb().select().from(notifications).where(and(eq(notifications.userId, c.accounts.userId), eq(notifications.kind, "finance.duplicate_payment")));
    expect(told).toHaveLength(1);
  });

  it("refund.processed completes a pending refund, and records refunds made in the Razorpay dashboard", async () => {
    const c = await paidCourse("Hook Refund U");
    const s = await c.student("Hook Refunded");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    await postWebhook(paymentEvent("payment.captured", p));

    fake.refundStatus = "pending";
    const r = await refundOrder(c.accounts, { orderId, amountPaise: 180_000, reason: "Late joining discount" });
    expect(r.status).toBe("pending");
    expect(await eventsOfType("payment.refunded", c.uni.id)).toHaveLength(0);
    const [mine] = await systemDb().select().from(payRefunds).where(eq(payRefunds.id, r.refundId));
    const rzpRefund = fake.refunds.get(mine.gatewayRefundId!)!;
    rzpRefund.status = "processed";
    const body = refundEvent("refund.processed", rzpRefund, p);
    expect((await postWebhook(body)).body).toMatchObject({ status: "processed", outcome: "refund_processed" });
    expect((await systemDb().select().from(payRefunds).where(eq(payRefunds.id, r.refundId)))[0].status).toBe("processed");
    const refunded = await eventsOfType("payment.refunded", c.uni.id);
    expect(refunded.map((e) => e.payload)).toEqual([{ orderId, userId: s.userId, amountPaise: 180_000 }]);
    // Replaying it changes nothing.
    expect((await postWebhook(body)).body).toMatchObject({ duplicate: true });
    expect(await eventsOfType("payment.refunded", c.uni.id)).toHaveLength(1);

    // The rest refunded straight from the Razorpay dashboard (no notes of ours).
    const dash = { id: "rfnd_Dashboard0001", entity: "refund", payment_id: p.id, amount: 1_000_000, currency: "INR", status: "processed", notes: [] };
    expect((await postWebhook(refundEvent("refund.processed", dash, p))).body).toMatchObject({ outcome: "refund_recorded" });
    const all = await systemDb().select().from(payRefunds).where(eq(payRefunds.orderId, orderId));
    expect(all.map((x) => [x.amountPaise, x.status]).sort()).toEqual([
      [1_000_000, "processed"],
      [180_000, "processed"],
    ]);
    // Together they cover the order, so core marked it refunded.
    expect((await orderRow(orderId)).status).toBe("refunded");
    expect(await eventsOfType("payment.refunded", c.uni.id)).toHaveLength(2);
  });

  it("refund.failed frees the amount again and tells Accounts", async () => {
    const c = await paidCourse("Hook RefundFail U");
    const s = await c.student("Hook RF");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    await postWebhook(paymentEvent("payment.captured", p));
    fake.refundStatus = "pending";
    const r = await refundOrder(c.accounts, { orderId, amountPaise: 1_180_000, reason: "Student withdrew" });
    const [mine] = await systemDb().select().from(payRefunds).where(eq(payRefunds.id, r.refundId));
    const rz = fake.refunds.get(mine.gatewayRefundId!)!;
    rz.status = "failed";
    expect((await postWebhook(refundEvent("refund.failed", rz))).body).toMatchObject({ outcome: "refund_failed" });
    expect((await systemDb().select().from(payRefunds).where(eq(payRefunds.id, r.refundId)))[0].status).toBe("failed");
    expect((await orderRow(orderId)).status).toBe("paid");
    const told = await systemDb().select().from(notifications).where(and(eq(notifications.userId, c.accounts.userId), eq(notifications.kind, "finance.refund_failed")));
    expect(told).toHaveLength(1);
    // The full amount can be refunded again.
    fake.refundStatus = "processed";
    expect((await refundOrder(c.accounts, { orderId, amountPaise: 1_180_000, reason: "Student withdrew, second try" })).orderRefunded).toBe(true);
  });

  it("answers 500 when handling fails, and handles Razorpay's retry of the same event", async () => {
    const c = await paidCourse("Hook Retry U");
    const s = await c.student("Hook Retry");
    const { orderId, order, enrolmentId } = await startCheckout(s, c.batch.id);
    const body = paymentEvent("payment.captured", fake.pay(order.gatewayOrderId!));
    // Break the order for a moment so core confirmPayment throws.
    await systemDb().update(orders).set({ enrolmentId: null }).where(eq(orders.id, orderId));
    const quiet = console.error;
    console.error = () => {};
    const first = await postWebhook(body).finally(() => (console.error = quiet));
    expect(first).toMatchObject({ status: 500, body: { error: "processing_failed" } });
    const [failed] = await systemDb().select().from(payWebhookEvents).where(eq(payWebhookEvents.eventId, first.eventId));
    expect(failed).toMatchObject({ status: "failed", attempts: 1 });
    expect(failed.error).toMatch(/Order not found/);
    await systemDb().update(orders).set({ enrolmentId }).where(eq(orders.id, orderId));
    const retry = await postWebhook(body, { eventId: first.eventId });
    expect(retry).toMatchObject({ status: 200, body: { status: "processed", outcome: "enrolled" } });
    const [row] = await systemDb().select().from(payWebhookEvents).where(eq(payWebhookEvents.eventId, first.eventId));
    expect(row).toMatchObject({ status: "processed", attempts: 2, error: null });
    expect((await orderRow(orderId)).status).toBe("paid");
  });

  it("is refused while the mock gateway is active", async () => {
    undo();
    const body = paymentEvent("payment.captured", { id: "pay_x", order_id: "order_x", amount: 1, currency: "INR", status: "captured" });
    expect(await postWebhook(body)).toMatchObject({ status: 400, body: { error: "razorpay_not_configured" } });
    undo = useRazorpay(fake);
  });
});
