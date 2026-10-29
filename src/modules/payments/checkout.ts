/**
 * Checkout (brief "Checkout page"): the student's own order, paid through Razorpay
 * Checkout (UPI, cards, netbanking) or, while the mock gateway is active, a test-mode
 * button.
 *
 *  - Success: the Checkout signature is verified (HMAC with the key secret), the payment
 *    is checked with Razorpay (order, amount, currency; captured if only authorised),
 *    then core `confirmPayment` enrols the student and issues the GST invoice.
 *  - Dismiss or failure: core `failPayment` releases the seat straight away.
 *
 * Every function starts with core `orderForCheckout`, which only returns the student's
 * own order in the university they're working in: an order from another university is
 * "not found".
 */
import { eq } from "drizzle-orm";
import { invoices, users } from "@/db/schema";
import { audit, confirmPayment, failPayment, gateway, orderForCheckout, withTenant, type Actor, type CheckoutOrder } from "@/server/core";
import { ValidationError } from "@/server/errors";
import { testModeAllowed } from "./config";
import { refundTotals, universityRow } from "./internal";
import { GatewayError, isRazorpay, RAZORPAY_CHECKOUT_JS } from "./razorpay";

export type CheckoutState = "pay" | "paid" | "closed" | "refund_due" | "refunded" | "unavailable";

/** Options handed to Razorpay Checkout in the browser. Public values only (the key id, never the secret). */
export type RazorpayCheckoutOptions = {
  key: string;
  order_id: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  image?: string;
  prefill: { name: string; email: string; contact?: string };
  notes: Record<string, string>;
  theme: { color: string };
  config: unknown;
  retry: { enabled: boolean; max_count: number };
  timeout: number;
  remember_customer: boolean;
};

export type CheckoutView = CheckoutOrder & {
  state: CheckoutState;
  /** Intra-state split for the summary (core issues invoices as intra-state supply). */
  split: { cgstPaise: number; sgstPaise: number; halfRatePercent: number };
  gateway: { kind: "mock"; testMode: boolean } | { kind: "razorpay"; scriptUrl: string; options: RazorpayCheckoutOptions; mode: "test" | "live" } | { kind: "other"; name: string };
  invoice: { id: string; number: string } | null;
  refundedPaise: number;
  universityName: string;
  /** Why payment can't start, when state is "unavailable". */
  problem: string | null;
};

/** Razorpay Checkout shows only UPI, cards and netbanking (no wallets, EMI or pay later). */
const DISPLAY_CONFIG = {
  display: {
    blocks: {
      main: {
        name: "Pay with",
        instruments: [{ method: "upi" }, { method: "card" }, { method: "netbanking" }],
      },
    },
    sequence: ["block.main"],
    preferences: { show_default_blocks: false },
  },
};

export async function checkoutView(actor: Actor, orderId: string): Promise<CheckoutView> {
  const co = await orderForCheckout(actor, orderId);
  const { order, course, batch } = co;
  const extra = await withTenant(actor, async (tx) => {
    const [inv] = await tx.select({ id: invoices.id, number: invoices.number }).from(invoices).where(eq(invoices.orderId, order.id));
    const [me] = await tx.select({ name: users.name, email: users.email, phone: users.phone }).from(users).where(eq(users.id, actor.userId));
    const u = await universityRow(tx);
    const totals = await refundTotals(tx, order.id);
    return { invoice: inv ?? null, me, u, refunded: totals.processedPaise };
  });

  const g = gateway();
  const half = course.gstRateBp / 200;
  const cgstPaise = Math.floor(order.gstPaise / 2);
  let problem: string | null = null;
  let gw: CheckoutView["gateway"];
  if (isRazorpay(g)) {
    if (order.gateway !== "razorpay" || !order.gatewayOrderId) {
      problem = "We couldn't start the payment for this seat. Cancel it and pick the batch again.";
    }
    gw = {
      kind: "razorpay",
      scriptUrl: RAZORPAY_CHECKOUT_JS,
      mode: g.mode,
      options: {
        key: g.keyId,
        order_id: order.gatewayOrderId ?? "",
        amount: order.totalPaise,
        currency: "INR",
        name: extra.u.name,
        description: `${course.title} · ${batch.name}`.slice(0, 255),
        ...(extra.u.branding?.logoUrl?.startsWith("https://") ? { image: extra.u.branding.logoUrl } : {}),
        prefill: { name: extra.me?.name ?? actor.name, email: extra.me?.email ?? actor.email, ...(extra.me?.phone ? { contact: extra.me.phone } : {}) },
        notes: { orderId: order.id, universityId: order.universityId },
        theme: { color: "#0B5E4C" },
        config: DISPLAY_CONFIG,
        retry: { enabled: true, max_count: 3 },
        // Close the widget when the seat hold runs out (at least a minute, at most 15).
        timeout: Math.min(900, Math.max(60, Math.floor(((co.enrolment?.holdExpiresAt?.getTime() ?? Date.now() + 600_000) - Date.now()) / 1000))),
        remember_customer: false,
      },
    };
  } else if (g.name === "mock") {
    gw = { kind: "mock", testMode: testModeAllowed() };
    if (!testModeAllowed()) problem = "Online payments aren't set up for this space yet. Contact the institute's accounts team.";
    if (order.gateway !== "mock") problem = "This order was started with Razorpay, which isn't set up here any more. Cancel it and pick the batch again.";
  } else {
    gw = { kind: "other", name: g.name };
    problem = "This payment method isn't available. Contact the institute's accounts team.";
  }

  const state: CheckoutState =
    order.status === "paid"
      ? "paid"
      : order.status === "refund_due"
        ? "refund_due"
        : order.status === "refunded"
          ? "refunded"
          : order.status === "pending"
            ? problem
              ? "unavailable"
              : "pay"
            : "closed";

  return {
    ...co,
    state,
    split: { cgstPaise, sgstPaise: order.gstPaise - cgstPaise, halfRatePercent: half },
    gateway: gw,
    invoice: extra.invoice,
    refundedPaise: extra.refunded,
    universityName: extra.u.name,
    problem: state === "unavailable" ? problem : null,
  };
}

export type PaymentConfirmation = { status: "enrolled" | "already_paid" | "refund_due"; enrolmentId: string; invoiceNumber?: string };

/**
 * The success callback from Razorpay Checkout. Refuses a bad signature, a payment for a
 * different order, and anything that isn't the student's own order in this university.
 */
export async function verifyCheckoutPayment(
  actor: Actor,
  input: { orderId: string; razorpayOrderId: string; razorpayPaymentId: string; signature: string },
): Promise<PaymentConfirmation> {
  const { order } = await orderForCheckout(actor, input.orderId);
  const g = gateway();
  if (!isRazorpay(g) || order.gateway !== "razorpay") throw new ValidationError("This order isn't paid through Razorpay.");
  if (!order.gatewayOrderId || input.razorpayOrderId !== order.gatewayOrderId) {
    await logRefusal(actor, order.id, "order_mismatch", input);
    throw new ValidationError("This payment belongs to a different order, so it can't be used here.", "order_mismatch");
  }
  if (!g.verifyPayment({ gatewayOrderId: order.gatewayOrderId, gatewayPaymentId: input.razorpayPaymentId, signature: input.signature })) {
    await logRefusal(actor, order.id, "bad_signature", input);
    throw new ValidationError("We couldn't verify this payment with Razorpay. If money left your account, it's refunded automatically; otherwise try again.", "bad_signature");
  }

  // The signature proves Razorpay authorised this payment for this order. Double-check
  // the details and capture it if the account doesn't capture automatically.
  try {
    let p = await g.fetchPayment(input.razorpayPaymentId);
    if (p.order_id !== order.gatewayOrderId || p.amount !== order.totalPaise || p.currency !== "INR") {
      await logRefusal(actor, order.id, "payment_mismatch", input);
      throw new ValidationError("This payment doesn't match the order amount, so it wasn't accepted. Contact the accounts team.", "payment_mismatch");
    }
    if (p.status === "failed") throw new ValidationError("Razorpay says this payment failed. Try again.", "payment_failed");
    if (p.status === "authorized") p = await g.capturePayment(p.id, order.totalPaise);
  } catch (e) {
    if (!(e instanceof GatewayError)) throw e;
    // Razorpay unreachable: the verified signature is enough; the webhook and the
    // reconcile job confirm the capture later.
  }

  return confirmPayment(order.universityId, { orderId: order.id, gatewayPaymentId: input.razorpayPaymentId });
}

async function logRefusal(actor: Actor, orderId: string, why: string, input: { razorpayOrderId: string; razorpayPaymentId: string }) {
  await withTenant(actor, (tx) =>
    audit(tx, actor, "payment.verify_refused", "order", orderId, { why, razorpayOrderId: input.razorpayOrderId.slice(0, 64), razorpayPaymentId: input.razorpayPaymentId.slice(0, 64) }),
  );
}

/**
 * Checkout was dismissed or the payment failed: release the seat now (core failPayment
 * only changes pending orders, so a payment that succeeded meanwhile is never undone).
 */
export async function abandonCheckout(actor: Actor, orderId: string, info: { reason: "dismissed" | "failed"; code?: string; description?: string }) {
  const { order } = await orderForCheckout(actor, orderId);
  await withTenant(actor, (tx) =>
    audit(tx, actor, info.reason === "failed" ? "payment.checkout_failed" : "payment.checkout_dismissed", "order", order.id, {
      code: info.code?.slice(0, 64) ?? null,
      description: info.description?.slice(0, 300) ?? null,
    }),
  );
  if (order.status !== "pending") return { status: order.status };
  await failPayment(order.universityId, order.id);
  return { status: "failed" as const };
}

function assertTestMode(order: CheckoutOrder["order"]) {
  if (gateway().name !== "mock" || order.gateway !== "mock") throw new ValidationError("Test payments are off. Use the real checkout.");
  if (!testModeAllowed()) throw new ValidationError("Test payments are off on this site.");
}

/** Test-mode payment (mock gateway, development and demo sites only). */
export async function payInTestMode(actor: Actor, orderId: string): Promise<PaymentConfirmation> {
  const { order } = await orderForCheckout(actor, orderId);
  assertTestMode(order);
  if (order.status !== "pending") {
    if (order.status === "paid") return { status: "already_paid", enrolmentId: "" };
    throw new ValidationError("This checkout has closed. Pick the batch again to get a new one.");
  }
  return confirmPayment(order.universityId, { orderId: order.id, gatewayPaymentId: `mock_pay_${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}` });
}

/** Test-mode failed payment, to try the failure path. */
export async function failInTestMode(actor: Actor, orderId: string) {
  const { order } = await orderForCheckout(actor, orderId);
  assertTestMode(order);
  return abandonCheckout(actor, orderId, { reason: "failed", code: "TEST_FAILURE", description: "Simulated in test mode" });
}


