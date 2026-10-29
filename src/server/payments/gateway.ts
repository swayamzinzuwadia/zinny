/**
 * The payment gateway core uses (contracts.md section 7). Core's seat hold calls
 * `gateway().createOrder`, so it never imports the payments module: payments registers
 * Razorpay through `paymentGateway`, and until it does the mock gateway below is used.
 */
import { randomUUID } from "node:crypto";
import type { PaymentGateway } from "@/contracts/payments";
import { paymentGateway } from "../registry";

export type { GatewayOrder, GatewayRefund, PaymentGateway } from "@/contracts/payments";

/** Test gateway for development and tests: every payment succeeds, every signature is accepted. */
export const mockGateway: PaymentGateway = {
  name: "mock",
  async createOrder() {
    const id = `mock_order_${randomUUID().slice(0, 12)}`;
    return { gatewayOrderId: id, checkout: { mock: true, orderId: id } };
  },
  verifyPayment: () => true,
  verifyWebhook: () => true,
  async refund() {
    return { gatewayRefundId: `mock_refund_${randomUUID().slice(0, 12)}`, status: "processed" };
  },
};

export function gateway(): PaymentGateway {
  return paymentGateway() ?? mockGateway;
}

/**
 * Test-mode payments confirm an order without any money moving. They are allowed only while
 * the mock gateway is active, and only in development or a demo deployment (ZINNY_DEMO=1),
 * so a live space without Razorpay keys can never hand out free enrolments.
 */
export function testPaymentsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return gateway().name === "mock" && (env.NODE_ENV !== "production" || env.ZINNY_DEMO === "1");
}
