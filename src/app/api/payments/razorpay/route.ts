import { handleRazorpayWebhook, MAX_WEBHOOK_BYTES } from "@/modules/payments/webhooks";

/**
 * Razorpay webhook. In the Razorpay dashboard (Settings → Webhooks) point a webhook at
 * https://<your domain>/api/payments/razorpay with the secret in RAZORPAY_WEBHOOK_SECRET
 * and the events payment.captured, payment.failed, order.paid, refund.processed and
 * refund.failed. All the rules are in src/modules/payments/webhooks.ts.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_WEBHOOK_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }
  const raw = await req.text();
  const res = await handleRazorpayWebhook(raw, {
    signature: req.headers.get("x-razorpay-signature"),
    eventId: req.headers.get("x-razorpay-event-id"),
  });
  return Response.json(res.body, { status: res.status, headers: { "cache-control": "no-store" } });
}
