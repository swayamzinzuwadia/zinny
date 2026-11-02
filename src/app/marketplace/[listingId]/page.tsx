import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, ButtonLink, Card, Notice } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { buyAction } from "@/modules/marketplace/actions";
import { listingDetail, marketplaceAccess } from "@/modules/marketplace/service";
import { getSite } from "@/modules/website-builder/cached";
import { CodeField } from "@/modules/marketplace/components/code-field";
import { KIND_LABEL, Price } from "@/modules/marketplace/components/price";

export const metadata = { title: "Marketplace" };
export const dynamic = "force-dynamic";

export default async function Listing({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const userId = await currentUserId();
  const [item, { canShop }] = await Promise.all([listingDetail(listingId, userId), userId ? marketplaceAccess(userId) : { canShop: false }]);
  if (!item) notFound();
  const site = await getSite(item.instituteSlug);

  return (
    <>
      <Link href="/marketplace" className="text-sm text-muted">
        Marketplace
      </Link>
      <div className="mt-3 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/marketplace?institute=${item.instituteSlug}`} className="text-[14px] text-muted hover:text-brand hover:underline">
              {item.institute}
            </Link>
            <Badge tone={item.kind === "lecture" ? "neutral" : "brand"}>{KIND_LABEL[item.kind]}</Badge>
            {item.percentOff && <Badge tone="gold">{item.percentOff}% off</Badge>}
          </div>
          <h1 className="mt-3 text-[clamp(2rem,5vw,3.25rem)] leading-[1.05] font-medium">{item.title}</h1>
          {item.description && <p className="mt-4 max-w-2xl text-[16px] leading-relaxed whitespace-pre-line text-muted">{item.description}</p>}
          {item.includes.length > 0 && (
            <p className="mt-4 max-w-2xl text-[15px]">
              <span className="text-muted">Together in this combo: </span>
              <span className="font-medium">{item.includes.join(", ")}</span>
            </p>
          )}

          <h2 className="mt-10 text-[23px] font-medium">What&apos;s inside</h2>
          <div className="mt-4 space-y-5">
            {item.outline.sections.map((s) => (
              <section key={s.title}>
                <h3 className="text-[14px] font-medium text-muted">{s.title}</h3>
                <ul className="mt-2 divide-y divide-line rounded-[18px] border border-line bg-surface">
                  {s.lessons.map((l) => (
                    <li key={l.title} className="flex items-baseline justify-between gap-4 px-4 py-3 text-[14px]">
                      <span className="min-w-0">{l.title}</span>
                      {l.durationMinutes > 0 && <span className="tabular shrink-0 text-[13px] text-muted">{l.durationMinutes} min</span>}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-5 sm:p-6">
            <Price totalPaise={item.totalPaise} compareAtTotalPaise={item.compareAtTotalPaise} className="block text-[30px] leading-none font-semibold" />
            <p className="mt-1.5 text-[13px] text-muted">
              {item.percentOff ? `You save ${item.percentOff}% on the usual price. ` : ""}Includes GST. A GST invoice comes with your purchase.
            </p>
            <div className="mt-5">
              {item.ownedEnrolmentId ? (
                <>
                  <Notice>This is in your library.</Notice>
                  <div className="mt-3">
                    <ButtonLink href={`/${item.instituteSlug}/learn/my/${item.ownedEnrolmentId}`}>Open it</ButtonLink>
                  </div>
                </>
              ) : canShop ? (
                <ActionForm action={buyAction} resetOnSuccess={false} className="space-y-3">
                  <input type="hidden" name="listingId" value={item.id} />
                  <CodeField />
                  <SubmitButton pendingText="Opening checkout…">Buy now</SubmitButton>
                </ActionForm>
              ) : userId ? (
                <Notice tone="neutral">Buying is for learner accounts: students, alumni and people who signed up for the marketplace.</Notice>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <ButtonLink href="/signup">Create an account to buy</ButtonLink>
                  <Link href={`/login?next=/marketplace/${item.id}`} className="text-[15px] font-medium text-brand">
                    Sign in
                  </Link>
                </div>
              )}
            </div>
          </Card>
          <div className="mt-4 px-1 text-[14px] leading-relaxed">
            <div className="text-muted">Sold by</div>
            <div className="font-medium">{item.institute}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <Link href={`/marketplace?institute=${item.instituteSlug}`} className="text-brand hover:underline">
                More from them
              </Link>
              {site && (
                <Link href={`/site/${item.instituteSlug}`} className="text-brand hover:underline">
                  Their website
                </Link>
              )}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
