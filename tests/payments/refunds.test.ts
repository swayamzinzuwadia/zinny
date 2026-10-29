import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, notifications } from "@/db/schema";
import { confirmPayment, systemActorFor } from "@/server/core";
import { holdSeat } from "@/server/services/enrolment";
import { reconcileRefunds, refundOrder } from "@/modules/payments/refunds";
import { payRefunds } from "@/modules/payments/schema";
import { eventsOfType } from "../helpers/events";
import { fakeRazorpay, orderRow, paidCourse, startCheckout, useRazorpay, type FakeRazorpay } from "./helpers";
import { payInTestMode } from "@/modules/payments/checkout";

afterAll(closeDb);

/** A paid order through the test-mode checkout. */
async function paidOrder(name: string) {
  const c = await paidCourse(name);
  const s = await c.student(`${name} Student`);
  const { orderId } = await startCheckout(s, c.batch.id);
  await payInTestMode(s, orderId);
  return { c, s, orderId };
}

describe("refunds (mock gateway)", () => {
  it("refunds in part, then the rest; the order is refunded only when the whole total is back", async () => {
    const { c, s, orderId } = await paidOrder("Refund Partial U");
    const first = await refundOrder(c.accounts, { orderId, amountPaise: 180_000, reason: "Scholarship of ₹1,800" });
    expect(first).toMatchObject({ status: "processed", amountPaise: 180_000, orderRefunded: false });
    expect((await orderRow(orderId)).status).toBe("paid");
    const rest = await refundOrder(c.admin, { orderId, amountPaise: 1_000_000, reason: "Student withdrew from the course" });
    expect(rest).toMatchObject({ status: "processed", orderRefunded: true });
    expect((await orderRow(orderId)).status).toBe("refunded");

    // payment.refunded once per refund, with this refund's amount.
    const events = (await eventsOfType("payment.refunded", c.uni.id)).map((e) => e.payload);
    expect(events.sort((a, b) => a.amountPaise - b.amountPaise)).toEqual([
      { orderId, userId: s.userId, amountPaise: 180_000 },
      { orderId, userId: s.userId, amountPaise: 1_000_000 },
    ]);
    // The student is notified each time, with the reason.
    const told = await systemDb().select().from(notifications).where(and(eq(notifications.userId, s.userId), eq(notifications.kind, "payment.refunded")));
    expect(told.map((n) => n.title).sort()).toEqual(["₹1,800 refunded for Data Analytics", "₹10,000 refunded for Data Analytics"]);
    expect(told.find((n) => n.title.startsWith("₹1,800"))!.body).toMatch(/Part of your payment.*Scholarship/);
    // Audited.
    const log = await systemDb().select().from(auditLog).where(and(eq(auditLog.entityId, orderId), eq(auditLog.action, "payment.refund_request")));
    expect(log).toHaveLength(2);
    expect(log.map((l) => l.actorUserId).sort()).toEqual([c.accounts.userId, c.admin.userId].sort());
  });

  it("a refund can't exceed the amount paid", async () => {
    const { c, orderId } = await paidOrder("Refund Limit U");
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 1_180_001, reason: "Too much money" })).rejects.toThrow(/at most ₹11,800/);
    await refundOrder(c.accounts, { orderId, amountPaise: 1_000_000, reason: "Most of it back" });
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 180_001, reason: "A paisa too much" })).rejects.toThrow(/at most ₹1,800.*₹10,000 is already refunded/);
    await refundOrder(c.accounts, { orderId, amountPaise: 180_000, reason: "The rest of it" });
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 100, reason: "Anything more" })).rejects.toThrow(/already refunded in full/);
    const sum = (await systemDb().select().from(payRefunds).where(eq(payRefunds.orderId, orderId))).reduce((n, r) => n + r.amountPaise, 0);
    expect(sum).toBe(1_180_000);
  });

  it("two refunds at the same time can't add up to more than was paid", async () => {
    const { c, orderId } = await paidOrder("Refund Race U");
    const results = await Promise.allSettled([
      refundOrder(c.accounts, { orderId, amountPaise: 800_000, reason: "First click" }),
      refundOrder(c.admin, { orderId, amountPaise: 800_000, reason: "Second click" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason)).toMatch(/at most ₹3,800/);
  });

  it("only finance.refund holders can refund: Admin and Accounts yes; Board, HOD, faculty and the student no", async () => {
    const { c, s, orderId } = await paidOrder("Refund Perm U");
    for (const who of [c.board, c.hod, c.faculty, s]) {
      await expect(refundOrder(who, { orderId, amountPaise: 100, reason: "Not allowed to do this" })).rejects.toThrow(/access/);
    }
    expect(await systemDb().select().from(payRefunds).where(eq(payRefunds.orderId, orderId))).toEqual([]);
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 100, reason: "Accounts can refund" })).resolves.toMatchObject({ status: "processed" });
    await expect(refundOrder(c.admin, { orderId, amountPaise: 100, reason: "Admin can refund" })).resolves.toMatchObject({ status: "processed" });
  });

  it("another university's staff can't refund the order", async () => {
    const { orderId } = await paidOrder("Refund Own U");
    const other = await paidCourse("Refund Other U");
    await expect(refundOrder(other.accounts, { orderId, amountPaise: 100, reason: "Not our order at all" })).rejects.toThrow(/Order not found/);
  });

  it("needs a reason and a valid amount, and only paid orders can be refunded", async () => {
    const { c, orderId } = await paidOrder("Refund Valid U");
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 100, reason: "no" })).rejects.toThrow(/Say why/);
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 0, reason: "Zero rupees" })).rejects.toThrow(/above ₹0/);
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 10.5, reason: "Half a paisa" })).rejects.toThrow(/above ₹0/);
    const s2 = await c.student("Unpaid Student");
    const pending = await startCheckout(s2, c.batch.id);
    await expect(refundOrder(c.accounts, { orderId: pending.orderId, amountPaise: 100, reason: "Not paid yet" })).rejects.toThrow(/Only paid orders/);
  });

  it("a refund_due order (paid after the batch filled) is refunded in full and marked refunded", async () => {
    const c = await paidCourse("Refund Due U");
    const s = await c.student("Two Tabs");
    // Two checkouts for one course: the first payment arrives after the second seat was taken.
    const extra = await (await import("@/server/services/batches")).createBatch(c.hod, {
      courseId: c.course.id,
      name: "Weekend",
      startDate: "2030-11-09",
      endDate: "2031-01-31",
      seatLimit: 10,
      slots: [{ weekday: 6, startTime: "10:00", endTime: "13:00" }],
      faculty: [{ userId: c.facultyUserId, role: "permanent_faculty" }],
    });
    const first = await holdSeat(s, { batchId: c.batch.id, acknowledgeClash: true });
    const second = await holdSeat(s, { batchId: extra.id, acknowledgeClash: true });
    if (first.status !== "held" || second.status !== "held") throw new Error("expected holds");
    await confirmPayment(c.uni.id, { orderId: second.orderId, gatewayPaymentId: "mock_pay_second" });
    expect((await confirmPayment(c.uni.id, { orderId: first.orderId, gatewayPaymentId: "mock_pay_first" })).status).toBe("refund_due");
    expect((await orderRow(first.orderId)).status).toBe("refund_due");
    const r = await refundOrder(c.accounts, { orderId: first.orderId, amountPaise: 1_180_000, reason: "Paid twice for one course" });
    expect(r.orderRefunded).toBe(true);
    expect((await orderRow(first.orderId)).status).toBe("refunded");
    // The other, real enrolment is untouched.
    expect((await orderRow(second.orderId)).status).toBe("paid");
  });

  it("refuses to refund a test-mode order through Razorpay", async () => {
    const { c, orderId } = await paidOrder("Refund Gateway U");
    const fake = fakeRazorpay();
    const undo = useRazorpay(fake);
    try {
      await expect(refundOrder(c.accounts, { orderId, amountPaise: 100, reason: "Gateway changed" })).rejects.toThrow(/test mode/);
    } finally {
      undo();
    }
  });
});

describe("refunds through Razorpay", () => {
  let fake: FakeRazorpay;
  let undo: () => void;
  beforeEach(() => {
    fake = fakeRazorpay();
    undo = useRazorpay(fake);
  });
  afterEach(() => undo());

  async function razorpayPaid(name: string) {
    const c = await paidCourse(name);
    const s = await c.student(`${name} Student`);
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    await confirmPayment(c.uni.id, { orderId, gatewayPaymentId: p.id });
    return { c, s, orderId, payment: p };
  }

  it("calls the Razorpay refund API with the payment, amount and our refund id, then marks the order refunded", async () => {
    const { c, orderId, payment } = await razorpayPaid("Rzp Refund U");
    const r = await refundOrder(c.accounts, { orderId, amountPaise: 1_180_000, reason: "Batch cancelled by the institute" });
    expect(r).toMatchObject({ status: "processed", orderRefunded: true });
    const call = fake.calls.find((x) => x.path === `/payments/${payment.id}/refund`)!;
    expect(call.body).toMatchObject({ amount: 1_180_000, notes: { refundId: r.refundId, orderId, universityId: c.uni.id } });
    const [row] = await systemDb().select().from(payRefunds).where(eq(payRefunds.id, r.refundId));
    expect(row).toMatchObject({ status: "processed", gateway: "razorpay" });
    expect(row.gatewayRefundId).toMatch(/^rfnd_/);
    expect((await orderRow(orderId)).status).toBe("refunded");
  });

  it("a refund Razorpay refuses is recorded as failed and frees the amount", async () => {
    const { c, orderId } = await razorpayPaid("Rzp Refused U");
    fake.failNext(/refund/, { status: 400, body: { error: { code: "BAD_REQUEST_ERROR", description: "Refund is not allowed on this payment" } } });
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 50_000, reason: "Trying a refund" })).rejects.toThrow(/didn't go through.*not allowed.*Nothing was refunded/);
    const [row] = await systemDb().select().from(payRefunds).where(eq(payRefunds.orderId, orderId));
    expect(row).toMatchObject({ status: "failed" });
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 1_180_000, reason: "Full refund this time" })).resolves.toMatchObject({ status: "processed" });
  });

  it("when Razorpay doesn't answer, the amount stays reserved and the hourly reconcile finishes it", async () => {
    const { c, s, orderId } = await razorpayPaid("Rzp Timeout U");
    // The request reaches Razorpay and is processed, but the answer is lost.
    fake.failNext(/refund/, "timeout");
    const r = await refundOrder(c.accounts, { orderId, amountPaise: 300_000, reason: "Timeout case" });
    expect(r.status).toBe("requested");
    expect(r.message).toMatch(/didn't answer in time.*check with Razorpay again/);
    // Can't be refunded twice meanwhile.
    await expect(refundOrder(c.accounts, { orderId, amountPaise: 900_000, reason: "Over the reserve" })).rejects.toThrow(/at most ₹8,800/);
    // Razorpay did make the refund (our id travels in notes and receipt).
    const [payment] = [...fake.payments.values()];
    fake.refunds.set("rfnd_LateAnswer001", { id: "rfnd_LateAnswer001", payment_id: payment.id, amount: 300_000, status: "processed", notes: { refundId: r.refundId }, receipt: r.refundId });
    const now = new Date(Date.now() + 5 * 60_000);
    const out = await reconcileRefunds(systemActorFor(c.uni.id), now);
    expect(out.changed).toBe(1);
    const [row] = await systemDb().select().from(payRefunds).where(eq(payRefunds.id, r.refundId));
    expect(row).toMatchObject({ status: "processed", gatewayRefundId: "rfnd_LateAnswer001" });
    const told = await systemDb().select().from(notifications).where(and(eq(notifications.userId, s.userId), eq(notifications.kind, "payment.refunded")));
    expect(told).toHaveLength(1);
    // Running it again changes nothing.
    expect((await reconcileRefunds(systemActorFor(c.uni.id), now)).changed).toBe(0);
    expect(await eventsOfType("payment.refunded", c.uni.id)).toHaveLength(1);
  });

  it("an unconfirmed refund Razorpay never made is failed after a day", async () => {
    const { c, orderId } = await razorpayPaid("Rzp Lost U");
    fake.failNext(/refund/, "network");
    const r = await refundOrder(c.accounts, { orderId, amountPaise: 100_000, reason: "Network dropped" });
    expect(r.status).toBe("requested");
    await reconcileRefunds(systemActorFor(c.uni.id), new Date(Date.now() + 10 * 60_000));
    expect((await systemDb().select().from(payRefunds).where(eq(payRefunds.id, r.refundId)))[0].status).toBe("requested");
    await reconcileRefunds(systemActorFor(c.uni.id), new Date(Date.now() + 25 * 3600_000));
    const [row] = await systemDb().select().from(payRefunds).where(eq(payRefunds.id, r.refundId));
    expect(row.status).toBe("failed");
    expect(row.failureReason).toMatch(/no record/);
  });
});
