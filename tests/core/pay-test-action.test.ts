/**
 * Core's test-mode payment (`payTestAction`) confirms an order without money moving.
 * Wave 1 integration: it is allowed only with the mock gateway, and only in development or
 * with ZINNY_DEMO=1. Before, any space without Razorpay keys took free enrolments.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { orders } from "@/db/schema";
import type { Actor } from "@/server/core";
import type { PaymentGateway } from "@/contracts/payments";
import type { ZinnyModule } from "@/contracts/module";
import { setTestModules } from "@/server/registry";
import { testPaymentsAllowed } from "@/server/payments/gateway";
import { holdSeat } from "@/server/services/enrolment";
import { setupCourse } from "../fixtures";

const session = vi.hoisted(() => ({ actor: null as unknown }));
vi.mock("@/server/context", () => ({
  spaceContext: async () => ({ actor: session.actor, isAdminUser: false, isLearner: true, isParent: false }),
}));

const { payTestAction } = await import("@/app/[uni]/learn/actions");

let ctx: Awaited<ReturnType<typeof setupCourse>>;

beforeAll(async () => {
  ctx = await setupCourse({ name: "Pay Test University", pricePaise: 500_000 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  setTestModules([]);
});

afterAll(async () => {
  await closeDb();
});

async function heldOrder() {
  const student: Actor = await ctx.student(`Student ${Math.random().toString(36).slice(2, 7)}`);
  const r = await holdSeat(student, { batchId: ctx.batch.id });
  if (r.status !== "held") throw new Error(`expected a held seat, got ${r.status}`);
  session.actor = student;
  return r.orderId;
}

function form(orderId: string) {
  const d = new FormData();
  d.set("uni", ctx.uni.slug);
  d.set("orderId", orderId);
  return d;
}

const statusOf = async (orderId: string) => (await systemDb().select({ status: orders.status }).from(orders).where(eq(orders.id, orderId)))[0].status;

const razorpayLike: PaymentGateway = {
  name: "razorpay",
  createOrder: async () => ({ gatewayOrderId: "order_x", checkout: {} }),
  verifyPayment: () => false,
  verifyWebhook: () => false,
  refund: async () => ({ gatewayRefundId: "rfnd_x", status: "processed" }),
};

describe("testPaymentsAllowed", () => {
  it("is on with the mock gateway in development and tests, and for demo deployments", () => {
    expect(testPaymentsAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(testPaymentsAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(testPaymentsAllowed({ NODE_ENV: "production", ZINNY_DEMO: "1" })).toBe(true);
  });

  it("is off in production without ZINNY_DEMO=1", () => {
    expect(testPaymentsAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(testPaymentsAllowed({ NODE_ENV: "production", ZINNY_DEMO: "0" })).toBe(false);
    expect(testPaymentsAllowed({ NODE_ENV: "production", ZINNY_DEMO: "true" })).toBe(false);
  });

  it("is off whenever a real gateway is registered, even in development", () => {
    setTestModules([{ id: "payments", paymentGateway: razorpayLike } as ZinnyModule]);
    expect(testPaymentsAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(testPaymentsAllowed({ NODE_ENV: "production", ZINNY_DEMO: "1" })).toBe(false);
  });
});

describe("payTestAction", () => {
  it("refuses in production without ZINNY_DEMO=1 and leaves the order unpaid", async () => {
    const orderId = await heldOrder();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ZINNY_DEMO", "");
    const res = await payTestAction(null, form(orderId));
    expect(res?.error).toMatch(/Test payments are off/);
    expect(await statusOf(orderId)).toBe("pending");
  });

  it("refuses when a real gateway is registered, and leaves the order unpaid", async () => {
    const orderId = await heldOrder();
    setTestModules([{ id: "payments", paymentGateway: razorpayLike } as ZinnyModule]);
    const res = await payTestAction(null, form(orderId));
    expect(res?.error).toMatch(/Test payments are off/);
    expect(await statusOf(orderId)).toBe("pending");
  });

  it("pays with the mock gateway on a demo deployment (redirects to the timetable)", async () => {
    const orderId = await heldOrder();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ZINNY_DEMO", "1");
    await expect(payTestAction(null, form(orderId))).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    expect(await statusOf(orderId)).toBe("paid");
  });
});
