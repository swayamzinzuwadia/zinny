/**
 * Test helpers for payments: a fake Razorpay API (a fetch stub with in-memory orders,
 * payments and refunds, checking Basic auth), real HMAC signing for checkout and
 * webhooks, and fixtures for paid courses.
 */
import { createHmac, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { systemDb } from "@/db/client";
import { batches, courses, departments, invoices, orders, universities, users } from "@/db/schema";
import { holdSeat } from "@/server/services/enrolment";
import type { Actor } from "@/server/core";
import type { RazorpayPayment, RazorpayRefund } from "@/modules/payments/razorpay";
import { person, setupCourse, uniqueCode } from "../fixtures";

export const KEY_ID = "rzp_test_ZinnyKey01";
export const KEY_SECRET = "test_key_secret_8f2b";
export const WEBHOOK_SECRET = "test_webhook_secret_51c";
export const API = "https://razorpay.test/v1";

const rid = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

type FakeOrder = { id: string; amount: number; currency: string; receipt: string; notes: Record<string, string>; status: string };
type Failure = { status: number; body?: unknown } | "network" | "timeout";

export function fakeRazorpay() {
  const state = {
    orders: new Map<string, FakeOrder>(),
    payments: new Map<string, RazorpayPayment>(),
    refunds: new Map<string, RazorpayRefund & { notes: Record<string, string> }>(),
    calls: [] as { method: string; path: string; body: Record<string, unknown> | null }[],
    /** Next calls whose path matches fail like this (first match wins, used once). */
    failures: [] as { match: RegExp; failure: Failure }[],
    /** Status new refunds get. */
    refundStatus: "processed" as "processed" | "pending" | "failed",
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const auth = `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;

  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.href.startsWith(API)) throw new Error(`Unexpected network call to ${url.href}`);
    const path = url.pathname.replace(/^\/v1/, "");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    state.calls.push({ method, path, body });
    const i = state.failures.findIndex((f) => f.match.test(`${method} ${path}`));
    if (i >= 0) {
      const [{ failure }] = state.failures.splice(i, 1);
      if (failure === "network") throw new TypeError("fetch failed");
      if (failure === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      return json(failure.status, failure.body ?? { error: { code: "SERVER_ERROR", description: "Something went wrong" } });
    }
    if (new Headers(init?.headers).get("authorization") !== auth) return json(401, { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } });

    let m: RegExpMatchArray | null;
    if (method === "POST" && path === "/orders") {
      const o: FakeOrder = { id: rid("order"), amount: Number(body!.amount), currency: String(body!.currency), receipt: String(body!.receipt), notes: (body!.notes ?? {}) as Record<string, string>, status: "created" };
      state.orders.set(o.id, o);
      return json(200, { ...o, entity: "order" });
    }
    if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)$/))) {
      const p = state.payments.get(m[1]);
      return p ? json(200, p) : json(400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } });
    }
    if (method === "POST" && (m = path.match(/^\/payments\/([^/]+)\/capture$/))) {
      const p = state.payments.get(m[1]);
      if (!p) return json(400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } });
      p.status = "captured";
      p.captured = true;
      return json(200, p);
    }
    if (method === "GET" && (m = path.match(/^\/orders\/([^/]+)\/payments$/))) {
      return json(200, { entity: "collection", items: [...state.payments.values()].filter((p) => p.order_id === m![1]) });
    }
    if (method === "POST" && (m = path.match(/^\/payments\/([^/]+)\/refund$/))) {
      const p = state.payments.get(m[1]);
      if (!p) return json(400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } });
      const already = [...state.refunds.values()].filter((r) => r.payment_id === p.id && r.status !== "failed").reduce((n, r) => n + r.amount, 0);
      if (already + Number(body!.amount) > p.amount) {
        return json(400, { error: { code: "BAD_REQUEST_ERROR", description: "The refund amount provided is greater than amount captured" } });
      }
      const r = { id: rid("rfnd"), entity: "refund", payment_id: p.id, amount: Number(body!.amount), currency: "INR", status: state.refundStatus, notes: (body!.notes ?? {}) as Record<string, string>, receipt: (body!.receipt as string) ?? null };
      state.refunds.set(r.id, r);
      p.amount_refunded = (p.amount_refunded ?? 0) + r.amount;
      return json(200, r);
    }
    if (method === "GET" && (m = path.match(/^\/payments\/([^/]+)\/refunds$/))) {
      return json(200, { entity: "collection", items: [...state.refunds.values()].filter((r) => r.payment_id === m![1]) });
    }
    return json(404, { error: { code: "NOT_FOUND", description: "No route" } });
  });

  return {
    ...state,
    fetch: fetchImpl,
    /** The student pays a Razorpay order: a payment appears on Razorpay's side. */
    pay(orderId: string, o: { status?: string; amount?: number; currency?: string; notes?: Record<string, string> } = {}): RazorpayPayment {
      const order = state.orders.get(orderId);
      const p: RazorpayPayment = {
        id: rid("pay"),
        order_id: orderId,
        amount: o.amount ?? order?.amount ?? 0,
        currency: o.currency ?? "INR",
        status: o.status ?? "captured",
        method: "upi",
        captured: (o.status ?? "captured") === "captured",
        notes: o.notes ?? order?.notes ?? {},
      };
      state.payments.set(p.id, p);
      return p;
    },
    failNext(match: RegExp, failure: Failure) {
      state.failures.push({ match, failure });
    },
  };
}

export type FakeRazorpay = ReturnType<typeof fakeRazorpay>;

/** Switches the payments module to Razorpay against the fake API. Call the returned function to undo. */
export function useRazorpay(fake: FakeRazorpay) {
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.RAZORPAY_API_BASE = API;
  vi.stubGlobal("fetch", fake.fetch);
  return () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_API_BASE;
    vi.unstubAllGlobals();
  };
}

export const checkoutSig = (orderId: string, paymentId: string, secret = KEY_SECRET) => createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
export const webhookSig = (body: string, secret = WEBHOOK_SECRET) => createHmac("sha256", secret).update(body).digest("hex");

export function paymentEvent(event: "payment.captured" | "payment.failed" | "order.paid", payment: RazorpayPayment) {
  return JSON.stringify({ entity: "event", account_id: "acc_test", event, contains: ["payment"], payload: { payment: { entity: payment } }, created_at: Math.floor(Date.now() / 1000) + Math.random() });
}

export function refundEvent(event: "refund.processed" | "refund.failed", refund: RazorpayRefund, payment?: RazorpayPayment) {
  return JSON.stringify({
    entity: "event",
    account_id: "acc_test",
    event,
    contains: payment ? ["refund", "payment"] : ["refund"],
    payload: { refund: { entity: refund }, ...(payment ? { payment: { entity: payment } } : {}) },
    created_at: Math.floor(Date.now() / 1000) + Math.random(),
  });
}

/** POSTs a webhook to the real route handler. */
export async function postWebhook(body: string, o: { signature?: string; eventId?: string } = {}) {
  const { POST } = await import("@/app/api/payments/razorpay/route");
  const headers: Record<string, string> = { "content-type": "application/json", "x-razorpay-signature": o.signature ?? webhookSig(body) };
  headers["x-razorpay-event-id"] = o.eventId ?? `evt_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const res = await POST(new Request("http://localhost/api/payments/razorpay", { method: "POST", body, headers }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, eventId: headers["x-razorpay-event-id"] };
}

/** A university with a published paid course (₹10,000 + 18% GST = ₹11,800), its staff, and a student helper. */
export async function paidCourse(name = "Pay University", opts: { seatLimit?: number; pricePaise?: number } = {}) {
  const c = await setupCourse({ name, pricePaise: opts.pricePaise ?? 1_000_000, seatLimit: opts.seatLimit ?? 20 });
  const accounts = await (await person("Arun Accounts", "accounts_fees", { universityId: c.uni.id })).actor();
  const board = await (await person("Bharat Board", "board_owner", { universityId: c.uni.id })).actor();
  const faculty = await (await import("@/server/actor")).loadActor(c.facultyUserId, c.uni.id);
  return { ...c, accounts, board, faculty };
}

/** Holds a seat for the student and returns the order (checkout started). */
export async function startCheckout(student: Actor, batchId: string) {
  const r = await holdSeat(student, { batchId, acknowledgeClash: true });
  if (r.status !== "held") throw new Error(`expected a held seat, got ${r.status}`);
  const [o] = await systemDb().select().from(orders).where(eq(orders.id, r.orderId));
  return { ...r, order: o };
}

export async function orderRow(orderId: string) {
  const [o] = await systemDb().select().from(orders).where(eq(orders.id, orderId));
  return o;
}

export async function invoiceOf(orderId: string) {
  const [i] = await systemDb().select().from(invoices).where(eq(invoices.orderId, orderId));
  return i;
}

/**
 * Inserts a paid order with its invoice straight into the database for university `uniId`
 * (for isolation tests that need a valid order row without going through checkout).
 */
export async function rawPaidOrder(uniId: string) {
  const db = systemDb();
  const [d] = await db.insert(departments).values({ universityId: uniId, code: uniqueCode(), name: "Dept" }).returning();
  const [c] = await db.insert(courses).values({ universityId: uniId, departmentId: d.id, title: "Raw course", pricePaise: 10_000, status: "published" }).returning();
  const [b] = await db
    .insert(batches)
    .values({ universityId: uniId, courseId: c.id, departmentId: d.id, name: "Raw batch", startDate: "2030-01-01", endDate: "2030-02-01", seatLimit: 5 })
    .returning();
  const [u] = await db.insert(users).values({ email: `${uniqueCode("u").toLowerCase()}@raw.test`, name: "Raw Student" }).returning();
  const [o] = await db
    .insert(orders)
    .values({ universityId: uniId, userId: u.id, courseId: c.id, batchId: b.id, basePaise: 10_000, gstPaise: 1_800, totalPaise: 11_800, status: "paid", gatewayPaymentId: "mock_pay_raw" })
    .returning();
  const [uni] = await db.select().from(universities).where(eq(universities.id, uniId));
  const [inv] = await db
    .insert(invoices)
    .values({
      universityId: uniId,
      orderId: o.id,
      number: `TU/26-27/${uniqueCode("").slice(0, 5)}`,
      financialYear: "26-27",
      sellerName: uni.name,
      buyerName: u.name,
      buyerEmail: u.email,
      placeOfSupply: "27",
      description: "Raw course — Raw batch",
      basePaise: 10_000,
      cgstPaise: 900,
      sgstPaise: 900,
      totalPaise: 11_800,
    })
    .returning();
  return { order: o, invoice: inv };
}
