import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Card, Notice } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { gateway, orderForCheckout } from "@/server/core";
import { formatINR } from "@/server/services/finance";
import { cancelHoldAction, payTestAction } from "../../actions";
import { Countdown } from "./countdown";

export const metadata = { title: "Checkout" };

export default async function Checkout({ params }: { params: Promise<{ uni: string; orderId: string }> }) {
  const { uni, orderId } = await params;
  const { actor } = await spaceContext(uni);
  const { order, course, batch, enrolment } = await orderForCheckout(actor, orderId);
  if (order.status === "paid") redirect(`/${uni}/learn/timetable?enrolled=1`);
  const isMock = gateway().name === "mock";

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-5 text-[26px] font-semibold tracking-tight">Checkout</h1>
      <Card>
        <div className="font-semibold">{course.title}</div>
        <div className="text-sm text-muted">{batch.name}</div>
        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Course fee</dt>
            <dd className="tabular-nums">{formatINR(order.basePaise)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">GST</dt>
            <dd className="tabular-nums">{formatINR(order.gstPaise)}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatINR(order.totalPaise)}</dd>
          </div>
        </dl>
        {enrolment?.holdExpiresAt && order.status === "pending" && (
          <div className="mt-4 text-sm text-muted">
            <Countdown until={enrolment.holdExpiresAt.toISOString()} />
          </div>
        )}
        {order.status === "refund_due" ? (
          <Notice tone="danger">The batch filled up before your payment finished. Your money will be refunded.</Notice>
        ) : (
          <div className="mt-5 space-y-3">
            {isMock ? (
              <ActionForm action={payTestAction} resetOnSuccess={false}>
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="orderId" value={orderId} />
                <SubmitButton pendingText="Paying…">Pay {formatINR(order.totalPaise)} (test mode)</SubmitButton>
              </ActionForm>
            ) : (
              <Notice tone="warn">Razorpay checkout loads here once keys are set (see README).</Notice>
            )}
            <ActionForm action={cancelHoldAction}>
              <input type="hidden" name="uni" value={uni} />
              <input type="hidden" name="enrolmentId" value={enrolment?.id ?? ""} />
              <SubmitButton variant="ghost" size="sm">
                Cancel and pick another batch
              </SubmitButton>
            </ActionForm>
          </div>
        )}
      </Card>
      <p className="mt-3 text-center text-xs text-muted">A GST invoice is emailed and kept in your account after payment.</p>
    </div>
  );
}
