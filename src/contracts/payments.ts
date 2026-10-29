/**
 * Payment gateway contract (contracts.md section 7). Core holds seats and creates
 * orders through `gateway().createOrder`; the mock gateway lives in core and the
 * payments module registers Razorpay through `paymentGateway`.
 */
export type GatewayOrder = { gatewayOrderId: string; checkout: Record<string, unknown> };

export type GatewayRefund = { gatewayRefundId: string; status: "pending" | "processed" | "failed" };

export interface PaymentGateway {
  /** "mock" for the built-in test gateway, "razorpay" for the real one. */
  name: string;
  createOrder(o: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder>;
  /** Signature sent back by the checkout widget after a successful payment. */
  verifyPayment(p: { gatewayOrderId: string; gatewayPaymentId: string; signature: string }): boolean;
  /** Signature on server-to-server webhooks. */
  verifyWebhook(rawBody: string, signature: string): boolean;
  /** Full or partial refund of a captured payment. */
  refund(r: { gatewayPaymentId: string; amountPaise: number; notes?: Record<string, string> }): Promise<GatewayRefund>;
}
