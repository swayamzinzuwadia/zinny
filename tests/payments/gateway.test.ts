import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateway } from "@/server/core";
import { razorpayFromEnv, testModeAllowed, appUrl } from "@/modules/payments/config";
import { GatewayError, isRazorpay, razorpayGateway } from "@/modules/payments/razorpay";
import { amount, decimal, inr, numberInWords, parseRupees, rupeesInWords } from "@/modules/payments/money";
import { API, checkoutSig, fakeRazorpay, KEY_ID, KEY_SECRET, useRazorpay, WEBHOOK_SECRET, webhookSig, type FakeRazorpay } from "./helpers";

describe("Razorpay gateway registration", () => {
  afterEach(() => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  it("without keys the core mock gateway stays in place", () => {
    expect(razorpayFromEnv()).toBeNull();
    expect(gateway().name).toBe("mock");
  });

  it("with RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET set, core uses Razorpay", () => {
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    const g = gateway();
    expect(g.name).toBe("razorpay");
    expect(isRazorpay(g) && g.keyId).toBe(KEY_ID);
    expect(isRazorpay(g) && g.mode).toBe("test");
    // Only the key id is exposed, never the secret.
    expect(JSON.stringify(g)).not.toContain(KEY_SECRET);
  });

  it("needs both keys", () => {
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    expect(gateway().name).toBe("mock");
  });

  it("test mode is on in development and demo sites only", () => {
    expect(testModeAllowed({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(true);
    expect(testModeAllowed({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(testModeAllowed({ NODE_ENV: "production", ZINNY_DEMO: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("builds email links from APP_URL, then Vercel, then localhost", () => {
    expect(appUrl({ APP_URL: "https://app.zinny.in/" } as unknown as NodeJS.ProcessEnv)).toBe("https://app.zinny.in");
    expect(appUrl({ VERCEL_PROJECT_PRODUCTION_URL: "zinny.vercel.app" } as unknown as NodeJS.ProcessEnv)).toBe("https://zinny.vercel.app");
    expect(appUrl({ PORT: "3106" } as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3106");
  });
});

describe("Razorpay signatures (real HMAC-SHA256)", () => {
  const g = razorpayGateway({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, apiBase: API });

  it("accepts the checkout signature Razorpay computes and rejects anything else", () => {
    const sig = checkoutSig("order_ABC123", "pay_XYZ789");
    expect(g.verifyPayment({ gatewayOrderId: "order_ABC123", gatewayPaymentId: "pay_XYZ789", signature: sig })).toBe(true);
    expect(g.verifyPayment({ gatewayOrderId: "order_ABC123", gatewayPaymentId: "pay_OTHER1", signature: sig })).toBe(false);
    expect(g.verifyPayment({ gatewayOrderId: "order_OTHER", gatewayPaymentId: "pay_XYZ789", signature: sig })).toBe(false);
    expect(g.verifyPayment({ gatewayOrderId: "order_ABC123", gatewayPaymentId: "pay_XYZ789", signature: checkoutSig("order_ABC123", "pay_XYZ789", "wrong") })).toBe(false);
    expect(g.verifyPayment({ gatewayOrderId: "order_ABC123", gatewayPaymentId: "pay_XYZ789", signature: "" })).toBe(false);
    expect(g.verifyPayment({ gatewayOrderId: "order_ABC123", gatewayPaymentId: "pay_XYZ789", signature: sig.slice(0, 10) })).toBe(false);
  });

  it("matches Razorpay's documented formula: HMAC(order_id|payment_id, key_secret)", () => {
    // Independent reference value computed with openssl:
    // printf 'order_IluGWxBm9U8zJ8|pay_IluGZ0yuP9EMzg' | openssl dgst -sha256 -hmac 'EnLs21M47BllR3X8PSFtjtbd'
    const ref = razorpayGateway({ keyId: "rzp_test_x", keySecret: "EnLs21M47BllR3X8PSFtjtbd", webhookSecret: "whsec_ref_123" });
    const expected = "155eb1b22fe4fb98072947e98ca1a285d76bae5ccc6c6bfded937cf7c57f1eb1";
    expect(ref.verifyPayment({ gatewayOrderId: "order_IluGWxBm9U8zJ8", gatewayPaymentId: "pay_IluGZ0yuP9EMzg", signature: expected })).toBe(true);
    // printf '{"event":"payment.captured"}' | openssl dgst -sha256 -hmac 'whsec_ref_123'
    expect(ref.verifyWebhook('{"event":"payment.captured"}', "d5d0f6aff5dc08223cb79e294db9ccc13026a0019b2a986a687fc0b8cba37d70")).toBe(true);
  });

  it("accepts a webhook signed with the webhook secret and rejects a changed body or another secret", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: {} });
    expect(g.verifyWebhook(body, webhookSig(body))).toBe(true);
    expect(g.verifyWebhook(`${body} `, webhookSig(body))).toBe(false);
    expect(g.verifyWebhook(body, webhookSig(body, KEY_SECRET))).toBe(false);
    expect(g.verifyWebhook(body, "")).toBe(false);
  });

  it("rejects every webhook when no webhook secret is set", () => {
    const noSecret = razorpayGateway({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: "" });
    const body = "{}";
    expect(noSecret.verifyWebhook(body, webhookSig(body, ""))).toBe(false);
  });
});

describe("Razorpay API calls (against a fake Razorpay)", () => {
  let fake: FakeRazorpay;
  let undo: () => void;
  beforeEach(() => {
    fake = fakeRazorpay();
    undo = useRazorpay(fake);
  });
  afterEach(() => undo());
  const g = () => razorpayGateway({ keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET, apiBase: API, timeoutMs: 1000 });

  it("creates an INR order for the exact amount, with Basic auth, a 40-character receipt and notes", async () => {
    const o = await g().createOrder({ amountPaise: 1_180_000, receipt: "x".repeat(60), notes: { orderId: "o1", universityId: "u1" } });
    expect(o.gatewayOrderId).toMatch(/^order_/);
    expect(o.checkout).toEqual({ key: KEY_ID, order_id: o.gatewayOrderId, amount: 1_180_000, currency: "INR" });
    expect(fake.calls[0]).toMatchObject({ method: "POST", path: "/orders", body: { amount: 1_180_000, currency: "INR", receipt: "x".repeat(40), notes: { orderId: "o1", universityId: "u1" } } });
  });

  it("refuses amounts under ₹1 without calling Razorpay", async () => {
    await expect(g().createOrder({ amountPaise: 50, receipt: "r", notes: {} })).rejects.toThrow(/at least ₹1/);
    expect(fake.calls).toHaveLength(0);
  });

  it("retries an order once after a 5xx, then reports a clear error", async () => {
    fake.failNext(/POST \/orders/, { status: 502 });
    const ok = await g().createOrder({ amountPaise: 10_000, receipt: "r", notes: {} });
    expect(ok.gatewayOrderId).toMatch(/^order_/);
    fake.failNext(/POST \/orders/, "network");
    fake.failNext(/POST \/orders/, "network");
    await expect(g().createOrder({ amountPaise: 10_000, receipt: "r", notes: {} })).rejects.toThrow(/Couldn't reach Razorpay/);
  });

  it("reports wrong keys plainly", async () => {
    const bad = razorpayGateway({ keyId: KEY_ID, keySecret: "nope", webhookSecret: "", apiBase: API });
    await expect(bad.createOrder({ amountPaise: 10_000, receipt: "r", notes: {} })).rejects.toThrow(/rejected the API keys/);
  });

  it("refunds a payment in part, never retries a refund, and passes Razorpay's reason through", async () => {
    const order = await g().createOrder({ amountPaise: 10_000, receipt: "r", notes: {} });
    const p = fake.pay(order.gatewayOrderId);
    const r = await g().refund({ gatewayPaymentId: p.id, amountPaise: 4_000, notes: { refundId: "ref-1" } });
    expect(r).toMatchObject({ status: "processed" });
    expect(fake.calls.at(-1)).toMatchObject({ method: "POST", path: `/payments/${p.id}/refund`, body: { amount: 4_000, speed: "normal", receipt: "ref-1" } });
    await expect(g().refund({ gatewayPaymentId: p.id, amountPaise: 7_000 })).rejects.toThrow(/greater than amount captured/);
    fake.failNext(/refund/, "timeout");
    const before = fake.calls.length;
    const err = await g()
      .refund({ gatewayPaymentId: p.id, amountPaise: 1_000 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).retriable).toBe(true);
    expect(fake.calls.length - before).toBe(1);
    await expect(g().refund({ gatewayPaymentId: "mock_pay_1", amountPaise: 1_000 })).rejects.toThrow(/isn't a Razorpay payment/);
  });

  it("fetches and captures payments, and lists an order's payments and a payment's refunds", async () => {
    const order = await g().createOrder({ amountPaise: 10_000, receipt: "r", notes: {} });
    const p = fake.pay(order.gatewayOrderId, { status: "authorized" });
    expect((await g().fetchPayment(p.id)).status).toBe("authorized");
    expect((await g().capturePayment(p.id, 10_000)).status).toBe("captured");
    expect((await g().orderPayments(order.gatewayOrderId)).map((x) => x.id)).toEqual([p.id]);
    await g().refund({ gatewayPaymentId: p.id, amountPaise: 2_000 });
    expect(await g().paymentRefunds(p.id)).toHaveLength(1);
    expect(await g().orderPayments("not-an-order")).toEqual([]);
  });
});

describe("money", () => {
  it("formats rupees the Indian way", () => {
    expect(inr(1_416_000)).toBe("₹14,160");
    expect(inr(1_234_567_850)).toBe("₹1,23,45,678.50");
    expect(inr(5)).toBe("₹0.05");
    expect(amount(1_416_000)).toBe("14,160.00");
    expect(decimal(1_416_050)).toBe("14160.50");
    expect(decimal(-150)).toBe("-1.50");
  });

  it("reads typed amounts", () => {
    expect(parseRupees("1,200.5")).toBe(120_050);
    expect(parseRupees("₹ 500")).toBe(50_000);
    expect(parseRupees("12.345")).toBeNull();
    expect(parseRupees("-5")).toBeNull();
    expect(parseRupees("abc")).toBeNull();
  });

  it("writes totals in words with lakh and crore", () => {
    expect(numberInWords(14_160)).toBe("Fourteen Thousand One Hundred Sixty");
    expect(numberInWords(1_234_567)).toBe("Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven");
    expect(numberInWords(25_00_00_000)).toBe("Twenty Five Crore");
    expect(numberInWords(0)).toBe("Zero");
    expect(rupeesInWords(1_416_000)).toBe("Indian Rupees Fourteen Thousand One Hundred Sixty Only");
    expect(rupeesInWords(472_050)).toBe("Indian Rupees Four Thousand Seven Hundred Twenty and Fifty Paise Only");
  });
});
