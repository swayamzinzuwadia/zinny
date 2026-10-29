import { confirmPayment, failPayment, gateway, orderUniversity, systemActorFor, withTenant } from "@/server/core";
import { orders } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Razorpay webhook (owned by payments, which finishes it: replay protection, refunds).
 * Configure in the Razorpay dashboard with events payment.captured and payment.failed,
 * pointing at /api/payments/razorpay.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const g = gateway();
  if (g.name !== "razorpay" || !g.verifyWebhook(raw, req.headers.get("x-razorpay-signature") ?? "")) {
    return new Response("invalid signature", { status: 400 });
  }
  const event = JSON.parse(raw) as {
    event: string;
    payload: { payment?: { entity: { id: string; order_id: string } } };
  };
  const payment = event.payload.payment?.entity;
  if (!payment) return Response.json({ ignored: true });

  // Find which university the order belongs to, then work inside that university only.
  const universityId = await orderUniversity(payment.order_id);
  if (!universityId) return Response.json({ ignored: true });
  const [order] = await withTenant(systemActorFor(universityId), (tx) =>
    tx.select({ id: orders.id }).from(orders).where(eq(orders.gatewayOrderId, payment.order_id)),
  );
  if (!order) return Response.json({ ignored: true });

  if (event.event === "payment.captured") {
    const out = await confirmPayment(universityId, { orderId: order.id, gatewayPaymentId: payment.id });
    return Response.json(out);
  }
  if (event.event === "payment.failed") {
    await failPayment(universityId, order.id);
    return Response.json({ status: "failed" });
  }
  return Response.json({ ignored: true });
}
