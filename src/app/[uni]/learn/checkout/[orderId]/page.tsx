import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ButtonLink, Card, Notice } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { cancelCheckoutAction, failTestModeAction, payTestModeAction } from "@/modules/payments/actions";
import { checkoutView } from "@/modules/payments/checkout";
import { RazorpayCheckout } from "@/modules/payments/components/razorpay-checkout";
import { inr } from "@/modules/payments/money";
import { Countdown } from "./countdown";

export const metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

const pct = (n: number) => `${Number(n.toFixed(2))}%`;

export default async function Checkout({ params }: { params: Promise<{ uni: string; orderId: string }> }) {
  const { uni, orderId } = await params;
  const { actor } = await spaceContext(uni);
  const v = await checkoutView(actor, orderId);
  const { order, course, batch, enrolment } = v;
  const coursePage = `/${uni}/learn/courses/${course.id}`;

  const cancel = (
    <ActionForm action={cancelCheckoutAction}>
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="orderId" value={order.id} />
      <input type="hidden" name="courseId" value={course.id} />
      <SubmitButton variant="ghost" size="sm" pendingText="Releasing your seat…">
        Cancel and pick another batch
      </SubmitButton>
    </ActionForm>
  );

  return (
    <div className="mx-auto max-w-md">
      <Link href={coursePage} className="text-sm text-muted">
        ← {course.title}
      </Link>
      <h1 className="mb-5 mt-2 text-[26px] font-semibold tracking-tight">Checkout</h1>

      <Card className="p-5 sm:p-6">
        <div className="text-[17px] font-semibold leading-snug">{course.title}</div>
        <div className="text-sm text-muted">{batch.name}</div>

        <dl className="mt-5 space-y-2 text-[14px]">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Course fee</dt>
            <dd className="tabular">{inr(order.basePaise)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">CGST {pct(v.split.halfRatePercent)}</dt>
            <dd className="tabular">{inr(v.split.cgstPaise)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">SGST {pct(v.split.halfRatePercent)}</dt>
            <dd className="tabular">{inr(v.split.sgstPaise)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-3 text-[16px] font-semibold">
            <dt>Total</dt>
            <dd className="tabular">{inr(order.totalPaise)}</dd>
          </div>
        </dl>

        {v.state === "pay" && enrolment?.holdExpiresAt && (
          <div className="mt-5 flex items-center gap-2.5 rounded-2xl bg-gold-soft px-4 py-3 text-[14px] text-gold-strong">
            <span className="now-dot h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
            <Countdown until={enrolment.holdExpiresAt.toISOString()} />
          </div>
        )}

        <div className="mt-5 space-y-3">
          {v.state === "pay" && v.gateway.kind === "razorpay" && (
            <>
              <RazorpayCheckout uni={uni} orderId={order.id} label={`Pay ${inr(order.totalPaise)}`} scriptUrl={v.gateway.scriptUrl} options={v.gateway.options} />
              <p className="text-center text-[13px] text-muted">
                UPI, cards or netbanking, through Razorpay.
                {v.gateway.mode === "test" && " Razorpay test mode: no real money moves."}
              </p>
              {cancel}
            </>
          )}

          {v.state === "pay" && v.gateway.kind === "mock" && (
            <>
              <ActionForm action={payTestModeAction} resetOnSuccess={false}>
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="orderId" value={order.id} />
                <SubmitButton pendingText="Paying…">Pay {inr(order.totalPaise)} (test mode)</SubmitButton>
              </ActionForm>
              <p className="text-[13px] text-muted">Test mode: no real money moves. Online payments open here once Razorpay keys are set.</p>
              <div className="flex flex-wrap items-center gap-2">
                {cancel}
                <ActionForm action={failTestModeAction}>
                  <input type="hidden" name="uni" value={uni} />
                  <input type="hidden" name="orderId" value={order.id} />
                  <SubmitButton variant="ghost" size="sm" pendingText="Failing…">
                    Simulate a failed payment
                  </SubmitButton>
                </ActionForm>
              </div>
            </>
          )}

          {v.state === "unavailable" && (
            <>
              <Notice tone="warn">{v.problem}</Notice>
              {cancel}
            </>
          )}

          {v.state === "paid" && (
            <>
              <Notice>Payment received. You&apos;re enrolled in {batch.name}.</Notice>
              <div className="flex flex-wrap gap-2">
                <ButtonLink href={`/${uni}/learn/timetable`}>Open my timetable</ButtonLink>
                {v.invoice && (
                  <a href={`/${uni}/learn/invoices/${v.invoice.id}`} className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-5 text-[14px] font-medium hover:border-brand/40">
                    Download invoice
                  </a>
                )}
              </div>
            </>
          )}

          {v.state === "refund_due" && (
            <>
              <Notice tone="gold">
                The batch filled up before your payment finished, so you weren&apos;t enrolled. Your {inr(order.totalPaise)} will be refunded in full
                {v.refundedPaise > 0 ? `; ${inr(v.refundedPaise)} is refunded so far.` : "."} You&apos;ll get a notification when the refund is sent.
              </Notice>
              <ButtonLink href={coursePage} variant="secondary">
                Pick another batch
              </ButtonLink>
            </>
          )}

          {v.state === "refunded" && (
            <>
              <Notice tone="neutral">This payment was refunded in full. It reaches your account in 5 to 7 working days.</Notice>
              <ButtonLink href={coursePage} variant="secondary">
                See the batches
              </ButtonLink>
            </>
          )}

          {v.state === "closed" && (
            <>
              <Notice tone="neutral">
                {order.status === "failed" ? "The payment didn't go through, so your seat was released." : "This checkout timed out and your seat was released."} Pick a batch again to
                try once more.
              </Notice>
              <ButtonLink href={coursePage}>Pick a batch again</ButtonLink>
            </>
          )}
        </div>
      </Card>

      <p className="mt-3 text-center text-xs text-muted">
        After payment, your GST invoice is emailed to you and kept in{" "}
        <Link href={`/${uni}/learn/invoices`} className="underline underline-offset-2">
          Invoices
        </Link>
        .
      </p>
    </div>
  );
}
