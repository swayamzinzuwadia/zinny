/**
 * Razorpay gateway draft, moved here from core by foundation-lock. Not registered yet:
 * payments registers it through `paymentGateway` in its index.ts when
 * RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set. Until then core uses its mock gateway.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentGateway } from "@/contracts/payments";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function razorpayGateway(keyId: string, keySecret: string, webhookSecret: string): PaymentGateway {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;
  return {
    name: "razorpay",
    async createOrder({ amountPaise, receipt, notes }) {
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
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
      if (!webhookSecret) return false;
      const expected = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      return safeEqual(expected, signature);
    },
    async refund({ gatewayPaymentId, amountPaise, notes }) {
      // Draft: payments finishes this (speed, error handling, refund.processed webhook).
      const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(gatewayPaymentId)}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: auth },
        body: JSON.stringify({ amount: amountPaise, notes }),
      });
      if (!res.ok) throw new Error(`Razorpay refund failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { id: string; status: string };
      return { gatewayRefundId: body.id, status: body.status === "processed" ? "processed" : body.status === "failed" ? "failed" : "pending" };
    },
  };
}
