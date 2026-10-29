/**
 * Razorpay gateway (contracts.md section 7). Registered through `paymentGateway` in
 * index.ts when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set; until then core uses
 * its mock gateway.
 *
 * Besides the PaymentGateway contract (create order, verify payment, verify webhook,
 * refund) it exposes the few read calls payments needs to double-check a payment with
 * Razorpay before trusting it: fetch a payment, capture it, list an order's payments,
 * list a payment's refunds.
 *
 * API reference: https://razorpay.com/docs/api/ — amounts are paise, currency INR.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { GatewayOrder, GatewayRefund, PaymentGateway } from "@/contracts/payments";

export const RAZORPAY_API = "https://api.razorpay.com/v1";
export const RAZORPAY_CHECKOUT_JS = "https://checkout.razorpay.com/v1/checkout.js";

/** A call to Razorpay failed. `message` is safe to show to staff. */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null = null,
    /** True for network errors, timeouts and 5xx: trying again later may work. */
    public readonly retriable = false,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  /** created | authorized | captured | refunded | failed */
  status: string;
  method?: string | null;
  captured?: boolean;
  amount_refunded?: number;
  error_code?: string | null;
  error_description?: string | null;
  notes?: Record<string, string> | unknown[];
  created_at?: number;
};

export type RazorpayRefund = {
  id: string;
  payment_id: string;
  amount: number;
  currency?: string;
  /** pending | processed | failed */
  status: string;
  notes?: Record<string, string> | unknown[];
  receipt?: string | null;
  created_at?: number;
};

export type RazorpayConfig = {
  keyId: string;
  keySecret: string;
  /** Empty means webhooks can't be verified, so every webhook is rejected. */
  webhookSecret: string;
  apiBase?: string;
  /** Per-request timeout. Razorpay usually answers in well under a second. */
  timeoutMs?: number;
};

export interface RazorpayGateway extends PaymentGateway {
  name: "razorpay";
  /** Public key id for Checkout.js (never the secret). */
  keyId: string;
  /** "test" for rzp_test_ keys, "live" for rzp_live_ keys. */
  mode: "test" | "live";
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
  capturePayment(paymentId: string, amountPaise: number): Promise<RazorpayPayment>;
  orderPayments(gatewayOrderId: string): Promise<RazorpayPayment[]>;
  paymentRefunds(paymentId: string): Promise<RazorpayRefund[]>;
}

export function isRazorpay(g: PaymentGateway | null | undefined): g is RazorpayGateway {
  return !!g && g.name === "razorpay" && typeof (g as RazorpayGateway).fetchPayment === "function";
}

/** Constant-time comparison of two hex signatures. */
function safeEqual(expected: string, given: string) {
  if (typeof given !== "string" || given.length === 0) return false;
  const x = Buffer.from(expected);
  const y = Buffer.from(given);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hmacHex(secret: string, data: string) {
  return createHmac("sha256", secret).update(data).digest("hex");
}

/** Signature Razorpay Checkout returns after a successful payment: HMAC-SHA256(order_id|payment_id, key_secret). */
export function checkoutSignature(keySecret: string, gatewayOrderId: string, gatewayPaymentId: string) {
  return hmacHex(keySecret, `${gatewayOrderId}|${gatewayPaymentId}`);
}

/** Razorpay notes: at most 15 pairs, each value at most 256 characters. */
function cleanNotes(notes: Record<string, string> | undefined) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(notes ?? {}).slice(0, 15)) out[k.slice(0, 256)] = String(v).slice(0, 256);
  return out;
}

const PAYMENT_ID = /^pay_[A-Za-z0-9]{6,40}$/;
const ORDER_ID = /^order_[A-Za-z0-9]{6,40}$/;

export function razorpayGateway(cfg: RazorpayConfig): RazorpayGateway {
  const base = (cfg.apiBase ?? RAZORPAY_API).replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`;
  const timeoutMs = cfg.timeoutMs ?? 15_000;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown, opts: { retry?: boolean } = {}): Promise<T> {
    const attempts = opts.retry ? 2 : 1;
    let last: GatewayError | null = null;
    for (let i = 0; i < attempts; i++) {
      let res: Response;
      try {
        res = await fetch(`${base}${path}`, {
          method,
          headers: { authorization: auth, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
      } catch (e) {
        const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
        last = new GatewayError(
          timedOut ? "Razorpay didn't answer in time. Try again in a minute." : "Couldn't reach Razorpay. Check the connection and try again.",
          0,
          timedOut ? "timeout" : "network",
          true,
        );
        continue;
      }
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (res.ok) {
        if (json === null || typeof json !== "object") throw new GatewayError("Razorpay sent an answer we couldn't read.", res.status, "bad_response");
        return json as T;
      }
      const err = (json as { error?: { code?: string; description?: string } } | null)?.error;
      const description = err?.description?.trim();
      last = new GatewayError(
        res.status === 401
          ? "Razorpay rejected the API keys. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."
          : description
            ? `Razorpay: ${/[.!?]$/.test(description) ? description : `${description}.`}`
            : `Razorpay answered with an error (${res.status}).`,
        res.status,
        err?.code ?? null,
        res.status >= 500 || res.status === 429,
      );
      if (!last.retriable) break;
    }
    throw last!;
  }

  return {
    name: "razorpay",
    keyId: cfg.keyId,
    mode: cfg.keyId.startsWith("rzp_live_") ? "live" : "test",

    async createOrder({ amountPaise, receipt, notes }): Promise<GatewayOrder> {
      if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) {
        throw new GatewayError("Razorpay needs an amount of at least ₹1.", 0, "amount_too_small");
      }
      // A duplicate order from a retried request is harmless: it is never paid.
      const order = await call<{ id: string; amount: number; currency: string }>(
        "POST",
        "/orders",
        { amount: amountPaise, currency: "INR", receipt: receipt.slice(0, 40), notes: cleanNotes(notes), partial_payment: false },
        { retry: true },
      );
      if (!order.id || order.amount !== amountPaise) throw new GatewayError("Razorpay created an order with the wrong amount.", 0, "bad_response");
      return { gatewayOrderId: order.id, checkout: { key: cfg.keyId, order_id: order.id, amount: amountPaise, currency: "INR" } };
    },

    verifyPayment({ gatewayOrderId, gatewayPaymentId, signature }) {
      if (!gatewayOrderId || !gatewayPaymentId || !signature) return false;
      return safeEqual(checkoutSignature(cfg.keySecret, gatewayOrderId, gatewayPaymentId), signature);
    },

    verifyWebhook(rawBody, signature) {
      if (!cfg.webhookSecret || !signature) return false;
      return safeEqual(hmacHex(cfg.webhookSecret, rawBody), signature);
    },

    async refund({ gatewayPaymentId, amountPaise, notes }): Promise<GatewayRefund> {
      if (!PAYMENT_ID.test(gatewayPaymentId)) throw new GatewayError("This payment id isn't a Razorpay payment, so Razorpay can't refund it.", 0, "bad_payment_id");
      if (!Number.isSafeInteger(amountPaise) || amountPaise < 100) throw new GatewayError("Razorpay refunds start at ₹1.", 0, "amount_too_small");
      // Never retried: a timed-out refund may still have gone through. Reconciliation checks it later.
      const r = await call<RazorpayRefund>("POST", `/payments/${encodeURIComponent(gatewayPaymentId)}/refund`, {
        amount: amountPaise,
        speed: "normal",
        notes: cleanNotes(notes),
        ...(notes?.refundId ? { receipt: notes.refundId.slice(0, 40) } : {}),
      });
      return { gatewayRefundId: r.id, status: r.status === "processed" ? "processed" : r.status === "failed" ? "failed" : "pending" };
    },

    async fetchPayment(paymentId) {
      if (!PAYMENT_ID.test(paymentId)) throw new GatewayError("That isn't a Razorpay payment id.", 0, "bad_payment_id");
      return call<RazorpayPayment>("GET", `/payments/${encodeURIComponent(paymentId)}`, undefined, { retry: true });
    },

    async capturePayment(paymentId, amountPaise) {
      if (!PAYMENT_ID.test(paymentId)) throw new GatewayError("That isn't a Razorpay payment id.", 0, "bad_payment_id");
      return call<RazorpayPayment>("POST", `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: amountPaise, currency: "INR" });
    },

    async orderPayments(gatewayOrderId) {
      if (!ORDER_ID.test(gatewayOrderId)) return [];
      const r = await call<{ items?: RazorpayPayment[] }>("GET", `/orders/${encodeURIComponent(gatewayOrderId)}/payments`, undefined, { retry: true });
      return r.items ?? [];
    },

    async paymentRefunds(paymentId) {
      if (!PAYMENT_ID.test(paymentId)) return [];
      const r = await call<{ items?: RazorpayRefund[] }>("GET", `/payments/${encodeURIComponent(paymentId)}/refunds?count=100`, undefined, { retry: true });
      return r.items ?? [];
    },
  };
}
