import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ButtonLink, cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { NotFoundError } from "@/server/errors";
import { cancelBundleAction, payBundleTestModeAction } from "@/modules/payments/bundle-actions";
import { bundleView } from "@/modules/payments/bundles";
import { BundleCheckout } from "@/modules/payments/components/bundle-checkout";
import { inr } from "@/modules/payments/money";
import { FORMAT_LINE } from "@/modules/marketplace/components/price";
import { listingTitlesByBatch, liveBatchNames } from "@/modules/marketplace/service";

export const metadata = { title: "Checkout" };
export const dynamic = "force-dynamic";

const shell = "mx-auto max-w-6xl px-4 sm:px-6";

/** Paying for a whole cart: one payment, then every course in it is confirmed and invoiced by its own institute. */
export default async function BundleCheckoutPage({ params }: { params: Promise<{ bundleId: string }> }) {
  const { bundleId } = await params;
  const userId = await currentUserId();
  if (!userId) redirect(`/login?next=/marketplace/checkout/${bundleId}`);
  const b = await bundleView(userId, bundleId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  // Each line reads as it did on the shelf, not by the name of the course behind it.
  const [titles, liveBatches] = await Promise.all([listingTitlesByBatch(b.items.map((i) => i.batchId)), liveBatchNames(b.items.map((i) => i.batchId))]);
  const seats = b.items.filter((i) => liveBatches.has(i.batchId)).length;
  const subtotal = b.items.reduce((n, i) => n + i.basePaise, 0);
  const gst = b.items.reduce((n, i) => n + i.gstPaise, 0);

  return (
    <>
      <section aria-labelledby="checkout" className="bg-brand-deep text-canvas">
        <div className={cx(shell, "pt-10 pb-12 sm:pt-14")}>
          <Link href="/marketplace/cart" className="text-[14px] text-canvas/65 hover:text-canvas">
            Your cart
          </Link>
          <h1 id="checkout" className="mt-2 text-[clamp(2.4rem,5.4vw,3.8rem)] leading-[1.04] font-semibold">
            Checkout
          </h1>
        </div>
      </section>

      <div className={cx(shell, "grid gap-10 pt-12 lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <section aria-label="What you're paying for">
          <ul className="divide-y divide-line border-y border-line">
            {b.items.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-4 py-4">
                <div className="min-w-0">
                  <div className="text-[15px] font-medium">{titles.get(i.batchId) ?? i.title}</div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    {i.institute} · {inr(i.basePaise)} + GST {inr(i.gstPaise)}
                  </div>
                  <div className="mt-1 text-[12.5px] font-medium text-brand">
                    {liveBatches.has(i.batchId) ? `${FORMAT_LINE.live} · a seat in ${liveBatches.get(i.batchId)}` : FORMAT_LINE.recorded}
                  </div>
                </div>
                <div className="tabular shrink-0 text-[15px]">{inr(i.totalPaise)}</div>
              </li>
            ))}
          </ul>
          {seats > 0 && b.status === "pending" && !b.problem && (
            <p className="mt-4 rounded-2xl bg-gold-soft px-4 py-3 text-[14px] text-brand-deep">
              {seats === 1 ? "Your seat is" : "Your seats are"} held for 10 minutes from when you started checkout. Pay within that time to keep {seats === 1 ? "it" : "them"}.
            </p>
          )}
          <p className="mt-4 text-[13px] text-muted">Each institute issues its own GST invoice for its courses. You&apos;ll find them in My library after paying.</p>
        </section>

        <aside>
          <div className="rounded-[22px] bg-surface p-6 shadow-[0_24px_50px_-28px_rgb(6_58_47/0.55)] ring-1 ring-line lg:sticky lg:top-24">
            <dl className="space-y-2 text-[15px]">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Before GST</dt>
                <dd className="tabular">{inr(subtotal)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">GST</dt>
                <dd className="tabular">{inr(gst)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-line pt-3 text-[20px] font-semibold">
                <dt>Total</dt>
                <dd className="tabular">{inr(b.totalPaise)}</dd>
              </div>
            </dl>

            <div className="mt-6">
              {b.status === "paid" ? (
                <div className="space-y-3">
                  <p className="text-[15px] font-medium text-brand">Paid. Everything is on your shelf.</p>
                  <ButtonLink href="/marketplace/library">Open My library</ButtonLink>
                </div>
              ) : b.status !== "pending" || b.problem ? (
                <div className="space-y-3">
                  <p className="text-[14px] leading-relaxed text-muted">{b.problem ?? "This checkout has closed. Nothing was charged for it."}</p>
                  <ButtonLink href="/marketplace/cart">Back to your cart</ButtonLink>
                </div>
              ) : b.gateway.kind === "razorpay" ? (
                <BundleCheckout bundleId={b.id} label={`Pay ${inr(b.totalPaise)}`} scriptUrl={b.gateway.scriptUrl} options={b.gateway.options} />
              ) : (
                <ActionForm action={payBundleTestModeAction} resetOnSuccess={false}>
                  <input type="hidden" name="bundleId" value={b.id} />
                  <SubmitButton pendingText="Paying…">Pay {inr(b.totalPaise)} (test mode)</SubmitButton>
                  <p className="mt-2 text-[13px] text-muted">Test mode: no real money moves.</p>
                </ActionForm>
              )}
            </div>

            {b.status === "pending" && !b.problem && (
              <ActionForm action={cancelBundleAction} resetOnSuccess={false} className="mt-4 border-t border-line pt-4">
                <input type="hidden" name="bundleId" value={b.id} />
                <SubmitButton variant="ghost" size="sm" pendingText="Cancelling…">
                  Cancel and go back to my cart
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
