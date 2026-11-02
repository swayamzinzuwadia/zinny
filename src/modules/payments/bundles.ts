/**
 * Bundles: one payment for several orders, so a marketplace cart with courses from different
 * institutes is paid in one go. Each order stays an ordinary order at its own institute (seat,
 * GST invoice, refunds); the bundle carries only the shared Razorpay order and payment.
 *
 *  - start: the learner's own pending orders, one gateway order for their total.
 *  - pay: the Checkout signature is verified, the payment checked against the bundle total
 *    (captured if only authorised), then core `confirmPayment` runs for every order with the
 *    same payment id. The webhook does the same when the browser never comes back.
 *  - dismiss or failure: core `failPayment` releases every seat.
 *
 * Exception to "never use systemDb()", like the marketplace: a bundle spans institutes, so
 * its two tables have no university_id and are read and written through the system
 * connection. Everything that changes an order goes through core under that order's
 * institute.
 */
import { and, eq, inArray } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { courses, orders, universities, users } from "@/db/schema";
import { audit, confirmPayment, failPayment, gateway, systemActorFor, withTenant } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { testModeAllowed } from "./config";
import { GatewayError, isRazorpay, RAZORPAY_CHECKOUT_JS } from "./razorpay";
import { payBundleOrders, payBundles, type BundleStatus } from "./schema";
import type { RazorpayCheckoutOptions } from "./checkout";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function bundleOrders(bundleId: string) {
  return systemDb()
    .select({
      id: orders.id,
      universityId: orders.universityId,
      userId: orders.userId,
      status: orders.status,
      basePaise: orders.basePaise,
      gstPaise: orders.gstPaise,
      totalPaise: orders.totalPaise,
      gatewayPaymentId: orders.gatewayPaymentId,
      title: courses.title,
      institute: universities.name,
      instituteSlug: universities.slug,
    })
    .from(payBundleOrders)
    .innerJoin(orders, eq(orders.id, payBundleOrders.orderId))
    .innerJoin(courses, eq(courses.id, orders.courseId))
    .innerJoin(universities, eq(universities.id, orders.universityId))
    .where(eq(payBundleOrders.bundleId, bundleId))
    .orderBy(universities.name, courses.title);
}

async function ownBundle(userId: string, bundleId: string) {
  if (!UUID.test(bundleId)) throw new NotFoundError("Checkout");
  const [b] = await systemDb().select().from(payBundles).where(eq(payBundles.id, bundleId));
  if (!b || b.userId !== userId) throw new NotFoundError("Checkout");
  return b;
}

/**
 * One gateway order for these pending orders, all the learner's own. An order that was in an
 * earlier unpaid bundle moves to this one, and the earlier bundle expires.
 */
export async function startBundle(userId: string, orderIds: string[]): Promise<{ bundleId: string }> {
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) throw new ValidationError("There's nothing to pay for.");
  const db = systemDb();
  const rows = await db.select().from(orders).where(inArray(orders.id, ids));
  if (rows.length !== ids.length || rows.some((o) => o.userId !== userId)) throw new NotFoundError("Order");
  if (rows.some((o) => o.status !== "pending")) throw new ValidationError("One of these checkouts has closed. Go back to your cart and try again.");
  const totalPaise = rows.reduce((n, o) => n + o.totalPaise, 0);

  const bundleId = crypto.randomUUID();
  const g = gateway();
  const go = await g.createOrder({ amountPaise: totalPaise, receipt: `bundle_${bundleId.slice(0, 30)}`, notes: { bundleId } });

  await db.transaction(async (tx) => {
    const earlier = await tx.select({ bundleId: payBundleOrders.bundleId }).from(payBundleOrders).where(inArray(payBundleOrders.orderId, ids));
    if (earlier.length) {
      await tx.delete(payBundleOrders).where(inArray(payBundleOrders.orderId, ids));
      await tx
        .update(payBundles)
        .set({ status: "expired" })
        .where(and(inArray(payBundles.id, [...new Set(earlier.map((e) => e.bundleId))]), eq(payBundles.status, "pending")));
    }
    await tx.insert(payBundles).values({ id: bundleId, userId, totalPaise, gateway: g.name, gatewayOrderId: go.gatewayOrderId });
    await tx.insert(payBundleOrders).values(ids.map((orderId) => ({ bundleId, orderId })));
  });
  for (const o of rows) {
    const sys = systemActorFor(o.universityId);
    await withTenant(sys, (tx) => audit(tx, sys, "payment.bundle_start", "order", o.id, { bundleId, totalPaise }));
  }
  return { bundleId };
}

export type BundleView = {
  id: string;
  status: BundleStatus;
  totalPaise: number;
  items: Awaited<ReturnType<typeof bundleOrders>>;
  gateway: { kind: "mock"; testMode: boolean } | { kind: "razorpay"; scriptUrl: string; options: RazorpayCheckoutOptions; mode: "test" | "live" } | { kind: "other"; name: string };
  problem: string | null;
};

export async function bundleView(userId: string, bundleId: string): Promise<BundleView> {
  const b = await ownBundle(userId, bundleId);
  const [items, [me]] = await Promise.all([
    bundleOrders(b.id),
    systemDb().select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, userId)),
  ]);
  const g = gateway();
  let problem: string | null = null;
  let gw: BundleView["gateway"];
  if (isRazorpay(g)) {
    if (b.gateway !== "razorpay") problem = "This checkout was started before online payments were switched on. Go back to your cart and check out again.";
    gw = {
      kind: "razorpay",
      scriptUrl: RAZORPAY_CHECKOUT_JS,
      mode: g.mode,
      options: {
        key: g.keyId,
        order_id: b.gatewayOrderId,
        amount: b.totalPaise,
        currency: "INR",
        name: "Zinny marketplace",
        description: `${items.length} ${items.length === 1 ? "recording" : "recordings"}`,
        prefill: { name: me?.name ?? "", email: me?.email ?? "", ...(me?.phone ? { contact: me.phone } : {}) },
        notes: { bundleId: b.id },
        theme: { color: "#0B5E4C" },
        config: undefined,
        retry: { enabled: true, max_count: 3 },
        timeout: 900,
        remember_customer: false,
      },
    };
  } else if (g.name === "mock") {
    gw = { kind: "mock", testMode: testModeAllowed() };
    if (!testModeAllowed()) problem = "Online payments aren't set up yet. Try again later.";
    if (b.gateway !== "mock") problem = "This checkout was started with Razorpay, which isn't set up here any more. Go back to your cart and check out again.";
  } else {
    gw = { kind: "other", name: g.name };
    problem = "This payment method isn't available.";
  }
  if (b.status === "pending" && items.some((i) => i.status !== "pending" && i.status !== "paid")) {
    problem = "Part of this checkout has closed. Go back to your cart and check out again.";
  }
  return { id: b.id, status: b.status, totalPaise: b.totalPaise, items, gateway: gw, problem };
}

/** Confirms every order in the bundle with one payment. Safe to repeat: core skips orders already paid. */
export async function settleBundle(bundleId: string, gatewayPaymentId: string) {
  const items = await bundleOrders(bundleId);
  for (const o of items) {
    await confirmPayment(o.universityId, { orderId: o.id, gatewayPaymentId });
  }
  await systemDb().update(payBundles).set({ status: "paid", gatewayPaymentId, paidAt: new Date() }).where(eq(payBundles.id, bundleId));
  return { orders: items.length };
}

/** The bundle a Razorpay order belongs to, for the webhook. */
export async function bundleByGatewayOrder(gatewayOrderId: string) {
  const [b] = await systemDb().select().from(payBundles).where(eq(payBundles.gatewayOrderId, gatewayOrderId));
  return b ?? null;
}

/** The success callback from Razorpay Checkout, for a bundle. */
export async function verifyBundlePayment(userId: string, input: { bundleId: string; razorpayOrderId: string; razorpayPaymentId: string; signature: string }) {
  const b = await ownBundle(userId, input.bundleId);
  const g = gateway();
  if (!isRazorpay(g) || b.gateway !== "razorpay") throw new ValidationError("This checkout isn't paid through Razorpay.");
  if (input.razorpayOrderId !== b.gatewayOrderId) throw new ValidationError("This payment belongs to a different checkout, so it can't be used here.", "order_mismatch");
  if (!g.verifyPayment({ gatewayOrderId: b.gatewayOrderId, gatewayPaymentId: input.razorpayPaymentId, signature: input.signature })) {
    throw new ValidationError("We couldn't verify this payment with Razorpay. If money left your account, it's refunded automatically; otherwise try again.", "bad_signature");
  }
  try {
    let p = await g.fetchPayment(input.razorpayPaymentId);
    if (p.order_id !== b.gatewayOrderId || p.amount !== b.totalPaise || p.currency !== "INR") {
      throw new ValidationError("This payment doesn't match the checkout total, so it wasn't accepted. Contact support.", "payment_mismatch");
    }
    if (p.status === "failed") throw new ValidationError("Razorpay says this payment failed. Try again.", "payment_failed");
    if (p.status === "authorized") p = await g.capturePayment(p.id, b.totalPaise);
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    // Razorpay unreachable: the verified signature is enough; the webhook confirms the capture later.
  }
  return settleBundle(b.id, input.razorpayPaymentId);
}

/** Test-mode payment for a bundle (mock gateway, development and demo sites only). */
export async function payBundleInTestMode(userId: string, bundleId: string) {
  const b = await ownBundle(userId, bundleId);
  if (gateway().name !== "mock" || b.gateway !== "mock") throw new ValidationError("Test payments are off. Use the real checkout.");
  if (!testModeAllowed()) throw new ValidationError("Test payments are off on this site.");
  if (b.status === "paid") return { orders: 0 };
  if (b.status !== "pending") throw new ValidationError("This checkout has closed. Go back to your cart and check out again.");
  return settleBundle(b.id, `mock_pay_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`);
}

/** Checkout dismissed or the payment failed: release every seat (core only changes pending orders). */
export async function abandonBundle(userId: string, bundleId: string) {
  const b = await ownBundle(userId, bundleId);
  return releaseBundle(b.id);
}

/** Fails every pending order in the bundle and closes it. Used by abandon and by the webhook's payment.failed. */
export async function releaseBundle(bundleId: string) {
  const items = await bundleOrders(bundleId);
  for (const o of items) if (o.status === "pending") await failPayment(o.universityId, o.id);
  await systemDb()
    .update(payBundles)
    .set({ status: "failed" })
    .where(and(eq(payBundles.id, bundleId), eq(payBundles.status, "pending")));
  return { released: items.filter((o) => o.status === "pending").length };
}

/**
 * For the webhook, which logs every event under one institute: a bundle's events are logged
 * under the institute of its first order (the bundle spans several; the log needs one).
 */
export async function bundleUniversity(gatewayOrderId: string) {
  const [row] = await systemDb()
    .select({ universityId: orders.universityId })
    .from(payBundles)
    .innerJoin(payBundleOrders, eq(payBundleOrders.bundleId, payBundles.id))
    .innerJoin(orders, eq(orders.id, payBundleOrders.orderId))
    .where(eq(payBundles.gatewayOrderId, gatewayOrderId))
    .limit(1);
  return row?.universityId ?? null;
}
