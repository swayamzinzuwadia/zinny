import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ButtonLink, Input, cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { cartView } from "@/modules/marketplace/cart";
import { removeFromCartAction } from "@/modules/marketplace/actions";
import { Jacket, lessonsLine } from "@/modules/marketplace/components/jacket";
import { datesLine, seatsLine } from "@/modules/marketplace/components/live";
import { FORMAT_LINE, Price } from "@/modules/marketplace/components/price";
import { fewSeatsLeft } from "@/modules/marketplace/service";
import { inr } from "@/modules/payments/money";
import { checkoutCartAction } from "./actions";

export const metadata = { title: "Your cart" };
export const dynamic = "force-dynamic";

const shell = "mx-auto max-w-6xl px-4 sm:px-6";

/** The cart: everything the learner means to buy, paid for in one go. */
export default async function Cart() {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/marketplace/cart");
  const cart = await cartView(userId);
  const n = cart.lines.length;
  const institutes = new Set(cart.lines.map((l) => l.institute)).size;

  return (
    <>
      <section aria-labelledby="cart" className="bg-brand-deep text-canvas">
        <div className={cx(shell, "pt-10 pb-12 sm:pt-14 sm:pb-16")}>
          <h1 id="cart" className="text-[clamp(2.6rem,6vw,4.25rem)] leading-[1.02] font-semibold">
            Your cart
          </h1>
          <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-canvas/75">
            {n === 0
              ? "Nothing in it yet. Add recordings and seats in live batches from any institute and pay for them together."
              : `${n} ${n === 1 ? "item" : "items"}${institutes > 1 ? ` from ${institutes} institutes` : ""}, paid for in one go. Each one comes with its own GST invoice from the institute that sells it.`}
          </p>
        </div>
      </section>

      <div className={cx(shell, "pt-12")}>
        {cart.dropped > 0 && (
          <p className="mb-6 rounded-2xl bg-gold-soft px-4 py-3 text-[14px] text-brand-deep">
            {cart.dropped === 1 ? "One item left your cart: it went off sale, or you already own it." : `${cart.dropped} items left your cart: they went off sale, or you already own them.`}
          </p>
        )}
        {n === 0 ? (
          <div className="max-w-lg">
            <h2 className="text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">The shelves are this way.</h2>
            <div className="mt-6">
              <ButtonLink href="/marketplace">Browse the marketplace</ButtonLink>
            </div>
          </div>
        ) : (
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
            <ul className="divide-y divide-line border-y border-line">
              {cart.lines.map((l) => (
                <li key={l.id} className="flex gap-5 py-6">
                  <Link href={`/marketplace/${l.id}`} className="w-20 shrink-0 sm:w-24">
                    <Jacket item={l} />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link href={`/marketplace/${l.id}`} className="line-clamp-2 text-[16px] leading-snug font-medium hover:text-brand">
                      {l.title}
                    </Link>
                    <span className="mt-1 text-[13px] text-muted">
                      <Link href={`/marketplace/institutes/${l.instituteSlug}`} className="hover:text-brand hover:underline">
                        {l.institute}
                      </Link>{" "}
                      · {l.live ? `${l.live.batchName} · ${datesLine(l.live)}` : lessonsLine(l.lessons, l.minutes)}
                    </span>
                    <span className="mt-1 text-[12.5px] font-medium text-brand">{l.live ? `${FORMAT_LINE.live} · ${l.live.timings}` : FORMAT_LINE.recorded}</span>
                    {l.live && (l.live.seatsLeft === 0 || fewSeatsLeft(l.live)) && (
                      <span className={cx("mt-2 self-start rounded-full px-2.5 py-1 text-[12.5px] leading-none font-medium", l.live.seatsLeft === 0 ? "bg-line text-ink" : "bg-gold text-brand-deep")}>
                        {l.live.seatsLeft === 0 ? "Batch full: take it out to check out" : seatsLine(l.live.seatsLeft)}
                      </span>
                    )}
                    <div className="mt-auto flex flex-wrap items-end justify-between gap-3 pt-3">
                      <Price pricePaise={l.pricePaise} compareAtPaise={l.compareAtPaise} />
                      <ActionForm action={removeFromCartAction} resetOnSuccess={false}>
                        <input type="hidden" name="listingId" value={l.id} />
                        <SubmitButton variant="ghost" size="sm" pendingText="Taking it out…">
                          Remove
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <aside>
              <div className="rounded-[22px] bg-surface p-6 shadow-[0_24px_50px_-28px_rgb(6_58_47/0.55)] ring-1 ring-line lg:sticky lg:top-24">
                <dl className="space-y-2 text-[15px]">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">
                      {n} {n === 1 ? "item" : "items"}, before GST
                    </dt>
                    <dd className="tabular">{inr(cart.subtotalPaise)}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">GST</dt>
                    <dd className="tabular">{inr(cart.gstPaise)}</dd>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-line pt-3 text-[18px] font-semibold">
                    <dt>To pay</dt>
                    <dd className="tabular">{inr(cart.totalPaise)}</dd>
                  </div>
                </dl>
                <ActionForm action={checkoutCartAction} resetOnSuccess={false} className="mt-5 space-y-3">
                  <Input name="code" placeholder="Discount code" aria-label="Discount code" maxLength={24} autoComplete="off" className="uppercase placeholder:normal-case" />
                  <SubmitButton pendingText="Getting checkout ready…">Check out</SubmitButton>
                </ActionForm>
                <p className="mt-4 text-[13px] leading-relaxed text-muted">A code takes effect on what it was made for. The final amount shows at checkout, before you pay.{cart.lines.some((l) => l.live) && " Seats in live batches are held for 10 minutes once you check out."}</p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </>
  );
}
