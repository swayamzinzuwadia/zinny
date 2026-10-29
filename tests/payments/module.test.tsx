import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static.node";
import { closeDb } from "@/db/client";
import { confirmPayment, systemActorFor, universityLite, withTenant } from "@/server/core";
import { eventHandlers, jobs, slotsInReach, visibleSlots } from "@/server/registry";
import { holdSeat } from "@/server/services/enrolment";
import payments from "@/modules/payments";
import { payInTestMode } from "@/modules/payments/checkout";
import { RefundsDueCard } from "@/modules/payments/components/finance-card";
import { InvoicesHubSection } from "@/modules/payments/components/invoices-hub-section";
import { reconcilePayments } from "@/modules/payments/jobs";
import { abandonCheckout } from "@/modules/payments/checkout";
import { fakeRazorpay, orderRow, paidCourse, startCheckout, useRazorpay, type FakeRazorpay } from "./helpers";

afterAll(closeDb);

async function html(node: ReactNode) {
  const { prelude } = await prerenderToNodeStream(<>{node}</>);
  let out = "";
  for await (const chunk of prelude) out += chunk.toString();
  return out.replaceAll("<!-- -->", "").replaceAll("&#x27;", "'");
}

describe("what payments registers", () => {
  it("an invoices hub section for learners, a refunds card for Accounts, its handler and its job", async () => {
    expect(payments.learnerHubSections?.map((s) => [s.key, s.action])).toEqual([["invoices", "self.view_invoices"]]);
    expect(payments.dashboardCards?.map((s) => [s.key, s.action])).toEqual([["refunds-due", "finance.refund"]]);
    expect(eventHandlers().map((h) => h.id)).toContain("payments.invoice-ready");
    expect(jobs("hour").map((j) => j.id)).toContain("payments.reconcile");
    const c = await paidCourse("Slots U");
    const s = await c.student("Slot Student");
    expect(visibleSlots("learnerHubSections", s, { universityId: c.uni.id, ownerUserId: s.userId }).map((x) => x.key)).toContain("invoices");
    expect(slotsInReach("dashboardCards", c.accounts, c.uni.id).map((x) => x.key)).toContain("refunds-due");
    for (const who of [c.hod, c.faculty, c.board]) expect(slotsInReach("dashboardCards", who, c.uni.id).map((x) => x.key)).not.toContain("refunds-due");
  });

  it("the hub section lists the learner's invoices and is empty without any", async () => {
    const c = await paidCourse("Hub U");
    const s = await c.student("Hub Student");
    const university = await withTenant(s, (tx) => universityLite(tx));
    expect(await InvoicesHubSection({ uni: university.slug, actor: s, university, enrolments: [] })).toBeNull();
    const { orderId } = await startCheckout(s, c.batch.id);
    await payInTestMode(s, orderId);
    const out = await html(await InvoicesHubSection({ uni: university.slug, actor: s, university, enrolments: [] }));
    expect(out).toContain("Invoices");
    expect(out).toContain("Data Analytics");
    expect(out).toContain("₹11,800");
    expect(out).toContain(`/${university.slug}/learn/invoices/`);
  });

  it("the dashboard card shows refund_due orders, gold, only when there are some", async () => {
    const c = await paidCourse("Card U");
    const university = await withTenant(c.accounts, (tx) => universityLite(tx));
    const props = { uni: university.slug, actor: c.accounts, university, today: "2030-01-01" };
    expect(await RefundsDueCard(props)).toBeNull();
    const s = await c.student("Two Checkouts");
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
    await confirmPayment(c.uni.id, { orderId: second.orderId, gatewayPaymentId: "mock_pay_b" });
    await confirmPayment(c.uni.id, { orderId: first.orderId, gatewayPaymentId: "mock_pay_a" });
    const out = await html(await RefundsDueCard(props));
    expect(out).toContain("Refunds to send");
    expect(out).toContain("Two Checkouts");
    expect(out).toContain("₹11,800");
    expect(out).toContain("border-gold");
    // The HOD gets nothing even if the card were rendered for them.
    expect(await RefundsDueCard({ ...props, actor: c.hod })).toBeNull();
  });
});

describe("hourly reconcile: payments", () => {
  let fake: FakeRazorpay;
  let undo: () => void;
  beforeEach(() => {
    fake = fakeRazorpay();
    undo = useRazorpay(fake);
  });
  afterEach(() => undo());

  it("confirms a payment Razorpay captured when the browser and the webhook both missed it", async () => {
    const c = await paidCourse("Reconcile Pay U");
    const s = await c.student("Closed Tab");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    const p = fake.pay(order.gatewayOrderId!);
    const sys = systemActorFor(c.uni.id);
    // Too recent: left alone (the student may still be in checkout).
    expect(await reconcilePayments(sys)).toEqual({ checked: 0, confirmed: 0 });
    const later = new Date(Date.now() + 20 * 60_000);
    expect(await reconcilePayments(sys, later)).toEqual({ checked: 1, confirmed: 1 });
    expect(await orderRow(orderId)).toMatchObject({ status: "paid", gatewayPaymentId: p.id });
    expect(await reconcilePayments(sys, later)).toEqual({ checked: 0, confirmed: 0 });
  });

  it("captures an authorised payment on a failed order, and leaves unpaid orders alone", async () => {
    const c = await paidCourse("Reconcile Auth U");
    const s = await c.student("Authorised Only");
    const { orderId, order } = await startCheckout(s, c.batch.id);
    await abandonCheckout(s, orderId, { reason: "dismissed" });
    const p = fake.pay(order.gatewayOrderId!, { status: "authorized" });
    const s2 = await c.student("Never Paid");
    const unpaid = await startCheckout(s2, c.batch.id);
    const later = new Date(Date.now() + 20 * 60_000);
    const out = await reconcilePayments(systemActorFor(c.uni.id), later);
    expect(out).toEqual({ checked: 2, confirmed: 1 });
    expect(fake.payments.get(p.id)?.status).toBe("captured");
    expect((await orderRow(orderId)).status).toBe("paid");
    expect((await orderRow(unpaid.orderId)).status).toBe("pending");
  });

  it("does nothing with the mock gateway", async () => {
    undo();
    const c = await paidCourse("Reconcile Mock U");
    expect(await reconcilePayments(systemActorFor(c.uni.id))).toEqual({ checked: 0, confirmed: 0 });
    undo = useRazorpay(fake);
  });
});
