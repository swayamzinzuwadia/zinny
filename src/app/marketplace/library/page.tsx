import Link from "next/link";
import { redirect } from "next/navigation";
import { ButtonLink, cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { ShopShelf } from "@/modules/marketplace/components/jacket";
import { LibraryCard, LiveLibraryCard } from "@/modules/marketplace/components/library";
import { marketplaceAccess, myLibrary, type LibraryItem } from "@/modules/marketplace/service";

export const metadata = { title: "My library" };
export const dynamic = "force-dynamic";

const shell = "mx-auto max-w-6xl px-4 sm:px-6";

type LiveItem = LibraryItem & { live: NonNullable<LibraryItem["live"]> };

/** Everything this person has bought and paid for, from every institute: their seats in live batches, then their own shelf of recordings. */
export default async function Library({ searchParams }: { searchParams: Promise<{ bought?: string }> }) {
  const sp = await searchParams;
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/marketplace/library");
  const [items, { canShop }] = await Promise.all([myLibrary(userId), marketplaceAccess(userId)]);
  const institutes = new Set(items.map((i) => i.institute));
  const live = items.filter((i): i is LiveItem => !!i.live);
  const recorded = items.filter((i) => !i.live);
  const summary = [
    recorded.length > 0 && `${recorded.length} ${recorded.length === 1 ? "recording" : "recordings"}`,
    live.length > 0 && `${live.length} live ${live.length === 1 ? "batch" : "batches"}`,
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <>
      <section aria-labelledby="library" className="overflow-hidden bg-brand-deep text-canvas">
        <div className={cx(shell, "grid gap-8 pt-10 sm:pt-14", items.length === 0 && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14")}>
          <div className={items.length === 0 ? "pb-2 lg:pb-16" : "pb-12 sm:pb-14"}>
            <h1 id="library" className="text-[clamp(2.6rem,6vw,4.25rem)] leading-[1.02] font-semibold">
              My library
            </h1>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-canvas/75">
              {items.length === 0
                ? "What you buy on the marketplace lands here once your payment is confirmed."
                : `${summary}, from ${institutes.size === 1 ? items[0].institute : `${institutes.size} institutes`}.`}
            </p>
            {sp.bought && items.length > 0 && (
              <p className="mt-5 inline-flex rounded-full bg-gold px-4 py-1.5 text-[14px] font-medium text-brand-deep">
                Payment confirmed. {items[0].live ? `Your seat in ${items[0].title} is booked.` : `${items[0].title} is ready to watch.`}
              </p>
            )}
          </div>
          {/* The books themselves are just below, so the shelf up here only stands in for them while there are none. */}
          {items.length === 0 && <ShopShelf items={[]} empty="Your books will stand here." />}
        </div>
      </section>

      <div className={cx(shell, "pt-14")}>
        {items.length === 0 ? (
          <div className="max-w-lg">
            <h2 className="text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">Your shelf is empty, for now.</h2>
            {canShop ? (
              <>
                <p className="mt-3 text-[16px] leading-relaxed text-muted">Recorded lectures to watch any time and seats in live batches are waiting on the marketplace.</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <ButtonLink href="/marketplace/recorded">Browse recorded lectures</ButtonLink>
                  <ButtonLink href="/marketplace/live" variant="secondary">
                    Browse live batches
                  </ButtonLink>
                </div>
              </>
            ) : (
              <Link href="/" className="mt-4 inline-block font-medium text-brand hover:underline">
                Back to your space
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-16">
            {live.length > 0 && (
              <section aria-labelledby="my-live">
                <h2 id="my-live" className="mb-2 text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">
                  Live batches
                </h2>
                <p className="mb-7 text-[14px] text-muted">Your classes are on your timetable at the institute. Join opens 15 minutes before each class.</p>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {live.map((item) => (
                    <LiveLibraryCard key={item.orderId} item={item} />
                  ))}
                </div>
              </section>
            )}
            {recorded.length > 0 && (
              <section aria-labelledby="my-recorded">
                {live.length > 0 && (
                  <h2 id="my-recorded" className="mb-7 text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">
                    Recordings
                  </h2>
                )}
                <div className="grid grid-cols-2 gap-x-5 gap-y-12 sm:grid-cols-3 sm:gap-x-7 lg:grid-cols-4">
                  {recorded.map((item) => (
                    <LibraryCard key={item.orderId} item={item} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
