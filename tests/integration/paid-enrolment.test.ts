/**
 * Cross-module flow (wave 1 integration): paid enrolment.
 * The student pays through the Razorpay flow with test signatures (payments, against the
 * fake Razorpay API) → core enrols them and issues the GST invoice → payments renders the
 * invoice PDF → the transactions report shows it (reports-board) → Accounts refunds it →
 * `payment.refunded` → the student is notified, and the report shows the refund.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { enrolments, notifications } from "@/db/schema";
import { verifyCheckoutPayment } from "@/modules/payments/checkout";
import { invoiceDownload } from "@/modules/payments/invoices";
import { refundOrder } from "@/modules/payments/refunds";
import { runTransactions } from "@/modules/reports-board/reports";
import { todayIn } from "@/server/lib/dates";
import { drainEvents, eventsOfType } from "../helpers/events";
import { checkoutSig, fakeRazorpay, invoiceOf, orderRow, paidCourse, startCheckout, useRazorpay, type FakeRazorpay } from "../payments/helpers";

let fake: FakeRazorpay;
let undo: () => void;
beforeEach(() => {
  fake = fakeRazorpay();
  undo = useRazorpay(fake);
});
afterEach(() => undo());
afterAll(closeDb);

describe("paid enrolment across modules", () => {
  it("Razorpay payment → enrolled → invoice PDF → transactions report → refund → student notified", async () => {
    const c = await paidCourse("Paid Flow University");
    const s = await c.student("Kabir Pays");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    expect(order.gateway).toBe("razorpay");

    // Payments: a signed Razorpay payment, verified and confirmed through core.
    const p = fake.pay(order.gatewayOrderId!);
    const out = await verifyCheckoutPayment(s, {
      orderId,
      razorpayOrderId: order.gatewayOrderId!,
      razorpayPaymentId: p.id,
      signature: checkoutSig(order.gatewayOrderId!, p.id),
    });
    expect(out.status).toBe("enrolled");
    await drainEvents({ universityId: c.uni.id });

    // Core: enrolled, with a GST invoice for the GST-inclusive total.
    const [enrolment] = await systemDb().select().from(enrolments).where(eq(enrolments.id, out.enrolmentId));
    expect(enrolment.status).toBe("active");
    const invoice = await invoiceOf(orderId);
    expect(invoice.totalPaise).toBe(1_180_000);

    // Payments: the student downloads the invoice PDF.
    const pdf = await invoiceDownload(s, invoice.id);
    expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe("%PDF-");

    // Reports: the transactions report lists the invoice.
    const today = todayIn("Asia/Kolkata");
    const before = (await runTransactions(c.accounts, { from: today, to: today })).rows.find((r) => r.invoice === invoice.number);
    expect(before).toMatchObject({ status: "Paid", total: 1_180_000, refund: null });

    // Payments: Accounts refunds in full → payment.refunded once → core marks the order refunded.
    await refundOrder(c.accounts, { orderId, amountPaise: 1_180_000, reason: "Student withdrew from the course" });
    await drainEvents({ universityId: c.uni.id });
    const refunded = (await eventsOfType("payment.refunded", c.uni.id)).filter((e) => e.payload.orderId === orderId);
    expect(refunded.map((e) => e.payload.amountPaise)).toEqual([1_180_000]);
    expect((await orderRow(orderId)).status).toBe("refunded");

    // The student is told.
    const notices = await systemDb()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, s.userId), eq(notifications.kind, "payment.refunded")));
    expect(notices).toHaveLength(1);

    // Reports: the refund shows against the invoice.
    const after = (await runTransactions(c.accounts, { from: today, to: today })).rows.find((r) => r.invoice === invoice.number);
    expect(after).toMatchObject({ total: 1_180_000, refund: 1_180_000 });
  });
});
