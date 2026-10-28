/**
 * Payment gateways. Razorpay for production (India: UPI, cards, netbanking),
 * and a mock gateway for local development and tests.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type GatewayOrder = { gatewayOrderId: string; checkout: Record<string, unknown> };

export interface PaymentGateway {
  name: "mock" | "razorpay";
  createOrder(o: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder>;
  /** Signature sent back by the checkout widget after a successful payment. */
  verifyPayment(p: { gatewayOrderId: string; gatewayPaymentId: string; signature: string }): boolean;
  /** Signature on server-to-server webhooks. */
  verifyWebhook(rawBody: string, signature: string): boolean;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const mockGateway: PaymentGateway = {
  name: "mock",
  async createOrder() {
    const id = `mock_order_${randomUUID().slice(0, 12)}`;
    return { gatewayOrderId: id, checkout: { mock: true, orderId: id } };
  },
  verifyPayment: () => true,
  verifyWebhook: () => true,
};

export function razorpayGateway(keyId: string, keySecret: string, webhookSecret: string): PaymentGateway {
  return {
    name: "razorpay",
    async createOrder({ amountPaise, receipt, notes }) {
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
        },
        body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: receipt.slice(0, 40), notes }),
      });
      if (!res.ok) throw new Error(`Razorpay order failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { id: string };
      return { gatewayOrderId: body.id, checkout: { key: keyId, order_id: body.id, amount: amountPaise, currency: "INR" } };
    },
    verifyPayment({ gatewayOrderId, gatewayPaymentId, signature }) {
      const expected = createHmac("sha256", keySecret).update(`${gatewayOrderId}|${gatewayPaymentId}`).digest("hex");
      return safeEqual(expected, signature);
    },
    verifyWebhook(rawBody, signature) {
      const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      return safeEqual(expected, signature);
    },
  };
}

export function gateway(): PaymentGateway {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET } = process.env;
  if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) {
    return razorpayGateway(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET ?? "");
  }
  return mockGateway;
}
