import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { ShopShelf } from "@/modules/marketplace/components/jacket";
import { LibraryCard } from "@/modules/marketplace/components/library";
import { marketplaceAccess, myLibrary } from "@/modules/marketplace/service";

export const metadata = { title: "My library" };
export const dynamic = "force-dynamic";

const shell = "mx-auto max-w-6xl px-4 sm:px-6";

/** Everything this person has bought and paid for, from every institute: their own shelf. */
export default async function Library({ searchParams }: { searchParams: Promise<{ bought?: string }> }) {
  const sp = await searchParams;
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/marketplace/library");
  const [items, { canShop }] = await Promise.all([myLibrary(userId), marketplaceAccess(userId)]);
  const institutes = new Set(items.map((i) => i.institute));

  return (
    <>
      <section aria-labelledby="library" className="overflow-hidden bg-brand-deep text-canvas">
        <div className={cx(shell, "grid gap-8 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14")}>
          <div className="pb-2 lg:pb-16">
            <h1 id="library" className="text-[clamp(2.6rem,6vw,4.25rem)] leading-[1.02] font-semibold">
              My library
            </h1>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-canvas/75">
              {items.length === 0
                ? "What you buy on the marketplace lands on this shelf once your payment is confirmed."
                : `${items.length} ${items.length === 1 ? "recording" : "recordings"} on your shelf, from ${institutes.size === 1 ? items[0].institute : `${institutes.size} institutes`}.`}
            </p>
            {sp.bought && items.length > 0 && (
              <p className="mt-5 inline-flex rounded-full bg-gold px-4 py-1.5 text-[14px] font-medium text-brand-deep">Payment confirmed. {items[0].title} is ready to watch.</p>
            )}
          </div>
          <ShopShelf
            items={items.map((i) => ({ id: i.listingId, kind: i.kind, title: i.title, institute: i.institute, lessons: i.lessons, percentOff: null }))}
            empty="Your books will stand here."
          />
        </div>
      </section>

      <div className={cx(shell, "pt-14")}>
        {items.length === 0 ? (
          <div className="max-w-lg">
            <h2 className="text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">Your shelf is empty, for now.</h2>
            {canShop ? (
              <>
                <p className="mt-3 text-[16px] leading-relaxed text-muted">Recorded courses, lectures and combos from institutes are waiting on the marketplace.</p>
                <div className="mt-6">
                  <ButtonLink href="/marketplace">Browse the marketplace</ButtonLink>
                </div>
              </>
            ) : (
              <Link href="/" className="mt-4 inline-block font-medium text-brand hover:underline">
                Back to your space
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-12 sm:grid-cols-3 sm:gap-x-7 lg:grid-cols-4">
            {items.map((item) => (
              <LibraryCard key={item.orderId} item={item} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
