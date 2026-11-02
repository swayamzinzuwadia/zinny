import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ButtonLink, cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { buyAction } from "@/modules/marketplace/actions";
import { CodeField } from "@/modules/marketplace/components/code-field";
import { BookCard, Jacket, lessonsLine } from "@/modules/marketplace/components/jacket";
import { KIND_LABEL, Price } from "@/modules/marketplace/components/price";
import { browseMarketplace, listingDetail, marketplaceAccess } from "@/modules/marketplace/service";
import { inr } from "@/modules/payments/money";
import { getSite } from "@/modules/website-builder/cached";

export const metadata = { title: "Marketplace" };
export const dynamic = "force-dynamic";

const shell = "mx-auto max-w-6xl px-4 sm:px-6";

function Tick() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="mt-1 size-4 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function Listing({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const userId = await currentUserId();
  const [item, { canShop }] = await Promise.all([listingDetail(listingId, userId), userId ? marketplaceAccess(userId) : { canShop: false }]);
  if (!item) notFound();
  const [site, siblings] = await Promise.all([getSite(item.instituteSlug), browseMarketplace({ institute: item.instituteSlug })]);
  const more = siblings.filter((s) => s.id !== item.id).slice(0, 4);
  const shelf = `/marketplace?institute=${item.instituteSlug}`;

  return (
    <div className="overflow-x-clip">
      <div className={cx(shell, "grid gap-x-12 lg:grid-cols-[minmax(0,1fr)_360px]")}>
        <section className="relative isolate pt-6 pb-14 text-canvas before:absolute before:inset-y-0 before:-inset-x-[100vw] before:-z-10 before:bg-brand-deep sm:pt-8 sm:pb-16">
          <nav aria-label="Breadcrumb" className="flex flex-wrap gap-x-2 text-[14px] text-canvas/60">
            <Link href="/marketplace" className="hover:text-canvas">
              Marketplace
            </Link>
            <span aria-hidden>/</span>
            <Link href={shelf} className="hover:text-canvas">
              {item.institute}
            </Link>
          </nav>
          <div className="mt-8 grid items-end gap-8 sm:grid-cols-[11rem_minmax(0,1fr)] lg:grid-cols-[13.5rem_minmax(0,1fr)]">
            <div className="w-40 sm:w-auto">
              <Jacket item={item} />
            </div>
            <div className="min-w-0">
              <Link href={shelf} className="text-[15px] font-medium text-gold hover:underline">
                {item.institute}
              </Link>
              <h1 className="mt-2 text-[clamp(2.2rem,4.8vw,3.6rem)] leading-[1.04] font-semibold [text-wrap:balance]">{item.title}</h1>
              <p className="mt-4 text-[15px] text-canvas/70">
                {KIND_LABEL[item.kind]} · {lessonsLine(item.outline.sections.reduce((n, s) => n + s.lessons.length, 0), item.minutes)}
              </p>
            </div>
          </div>
          {item.description && <p className="mt-8 max-w-2xl text-[17px] leading-relaxed whitespace-pre-line text-canvas/80">{item.description}</p>}
          {item.includes.length > 0 && (
            <p className="mt-5 max-w-2xl text-[15px] text-canvas/80">
              <span className="text-canvas/60">This combo brings together </span>
              {item.includes.join(", ")}.
            </p>
          )}
        </section>

        <aside id="buy" className="relative -mt-6 lg:row-span-2 lg:mt-0 lg:pt-8">
          <div className="rounded-[22px] bg-surface p-6 shadow-[0_24px_50px_-28px_rgb(6_58_47/0.55),0_1px_0_rgb(6_58_47/0.06)] ring-1 ring-line lg:sticky lg:top-24">
            <Price pricePaise={item.pricePaise} compareAtPaise={item.compareAtPaise} size="lg" />
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted">GST is added at checkout, and a GST invoice comes with your purchase.</p>
            {item.percentOff && item.compareAtPaise && (
              <p className="mt-3 inline-flex rounded-full bg-gold-soft px-3 py-1 text-[13.5px] font-medium text-brand-deep">
                You save {inr(item.compareAtPaise - item.pricePaise)}, {item.percentOff}% off the usual price
              </p>
            )}

            <div className="mt-5">
              {item.ownedEnrolmentId ? (
                <div className="space-y-3">
                  <p className="text-[15px] font-medium text-brand">This is on your shelf.</p>
                  <ButtonLink href={`/${item.instituteSlug}/learn/my/${item.ownedEnrolmentId}`}>Open it</ButtonLink>
                </div>
              ) : canShop ? (
                <ActionForm action={buyAction} resetOnSuccess={false} className="space-y-3">
                  <input type="hidden" name="listingId" value={item.id} />
                  <CodeField />
                  <SubmitButton pendingText="Opening checkout…">Buy now</SubmitButton>
                </ActionForm>
              ) : userId ? (
                <p className="text-[14px] leading-relaxed text-muted">Buying is for learner accounts: students, alumni and people who signed up for the marketplace.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <ButtonLink href="/signup">Create an account to buy</ButtonLink>
                  <Link href={`/login?next=/marketplace/${item.id}`} className="text-[15px] font-medium text-brand hover:underline">
                    Sign in
                  </Link>
                </div>
              )}
            </div>

            <ul className="mt-6 space-y-2 border-t border-line pt-5 text-[14px] text-ink/85">
              <li className="flex gap-2.5">
                <Tick />
                Watch at your own pace, as often as you like
              </li>
              <li className="flex gap-2.5">
                <Tick />
                Your progress is saved lesson by lesson
              </li>
              <li className="flex gap-2.5">
                <Tick />
                Sold and invoiced by {item.institute}
              </li>
            </ul>

            <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-4 text-[14px]">
              <Link href={shelf} className="font-medium text-brand hover:underline">
                More from them
              </Link>
              {site && (
                <Link href={`/site/${item.instituteSlug}`} className="font-medium text-brand hover:underline">
                  Their website
                </Link>
              )}
            </div>
          </div>
        </aside>

        <div className="min-w-0 pt-12 sm:pt-16">
          <section aria-labelledby="contents">
            <h2 id="contents" className="border-b border-line pb-4 text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">
              Contents
            </h2>
            <div className="mt-8 space-y-10">
              {item.outline.sections.map((s) => (
                <section key={s.title}>
                  <h3 className="flex items-baseline justify-between gap-4 text-[17px] font-semibold">
                    {s.title}
                    <span className="shrink-0 text-[13px] font-normal text-muted">
                      {s.lessons.length} {s.lessons.length === 1 ? "lesson" : "lessons"}
                    </span>
                  </h3>
                  <ol className="mt-3">
                    {s.lessons.map((l, i) => (
                      <li key={`${l.title}-${i}`} className="flex items-baseline gap-3 py-2 text-[15px]">
                        <span className="min-w-0">{l.title}</span>
                        <span aria-hidden className="h-px min-w-6 flex-1 translate-y-[-3px] border-b border-dotted border-faint" />
                        <span className="tabular shrink-0 text-[14px] text-muted">{l.durationMinutes > 0 ? `${l.durationMinutes} min` : l.kind === "video" ? "Video" : "Reading"}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </section>

          {more.length > 0 && (
            <section aria-labelledby="more" className="mt-20">
              <div className="mb-8 flex items-end justify-between gap-6 border-b border-line pb-4">
                <h2 id="more" className="text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">
                  More from {item.institute}
                </h2>
                <Link href={shelf} className="shrink-0 pb-1 text-[14px] font-medium text-brand hover:underline">
                  Their shelf
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 sm:gap-x-7 lg:grid-cols-3">
                {more.slice(0, 3).map((m) => (
                  <BookCard key={m.id} item={m} showInstitute={false} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
