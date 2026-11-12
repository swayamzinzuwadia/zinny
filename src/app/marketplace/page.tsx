import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { BookGrid, EmptyShelf, SearchBar, SectionHead, instituteFaces, query, shell } from "@/modules/marketplace/components/browse";
import { ShopShelf } from "@/modules/marketplace/components/jacket";
import { InstituteCard, LiveGrid } from "@/modules/marketplace/components/live";
import { browseMarketplace, marketplaceAccess, marketplaceDirectory, splitCatalog } from "@/modules/marketplace/service";

export const dynamic = "force-dynamic";

type Search = { q?: string; kind?: string; institute?: string; offer?: string; sort?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const q = ((await searchParams).q ?? "").trim();
  return {
    title: q ? `"${q}" on the marketplace` : "Marketplace",
    description: "Recorded lectures to watch any time and seats in live batches, sold directly by the institutes that teach them.",
  };
}

/** One of the two ways to learn, as a door on the shop front. */
function OptionDoor({ href, title, line, count, children }: { href: string; title: string; line: string; count: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-[20px] bg-canvas p-4 text-ink shadow-[0_22px_44px_-26px_rgb(0_0_0/0.65)] outline-offset-2 [transition-property:translate,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1 sm:p-6"
    >
      <span className="flex size-10 items-center justify-center rounded-[12px] bg-brand-soft text-brand sm:size-12">
        <svg aria-hidden viewBox="0 0 24 24" className="size-5 sm:size-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </svg>
      </span>
      <h2 className="mt-4 text-[clamp(1.2rem,3.6vw,1.75rem)] leading-[1.12] font-semibold group-hover:text-brand">{title}</h2>
      <p className="mt-2 text-[13.5px] leading-snug text-ink/75 sm:text-[15px] sm:leading-relaxed">{line}</p>
      <span className="mt-auto pt-4 text-[13px] font-medium text-brand sm:text-[14px]">{count}</span>
    </Link>
  );
}

/** The shop front: the two ways to learn side by side, a shelf of each, and the institutes behind them. Search looks in both. */
export default async function Marketplace({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  // Links from before the marketplace had two halves: an institute's shelf, and the recorded filters.
  if (sp.institute && /^[a-z0-9-]{1,64}$/.test(sp.institute)) redirect(`/marketplace/institutes/${sp.institute}`);
  const q = (sp.q ?? "").trim();
  if (!q && (sp.kind || sp.offer || sp.sort)) redirect(query("/marketplace/recorded", { kind: sp.kind, offer: sp.offer, sort: sp.sort }));

  const userId = await currentUserId();
  const [{ canShop }, everything, directory, found] = await Promise.all([
    userId ? marketplaceAccess(userId) : { canShop: false },
    browseMarketplace({ format: "all" }),
    marketplaceDirectory(),
    q ? browseMarketplace({ format: "all", q }) : null,
  ]);
  const all = splitCatalog(everything);
  const results = found ? splitCatalog(found) : null;
  const selling = directory.filter((i) => i.listings > 0);
  const faces = results ? [] : await instituteFaces(directory.slice(0, 6));

  return (
    <>
      <section aria-labelledby="shopfront" className="overflow-hidden bg-brand-deep text-canvas">
        <div className={cx(shell, "grid gap-10 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14")}>
          <div className="lg:pb-16">
            <h1 id="shopfront" className="max-w-[13ch] text-[clamp(2.6rem,6.4vw,4.75rem)] leading-[1.02] font-semibold [text-wrap:balance]">
              Learn from the institutes themselves.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-canvas/75">
              Two ways to learn, both sold directly by the institutes that teach them: recorded lectures you watch any time, and live batches with dates, class times and a seat with your name on it.
            </p>
            <SearchBar action="/marketplace" q={q} placeholder="Search courses, batches and institutes" label="Search the marketplace" />
            <p className="mt-6 text-[14px] text-canvas/60">
              {everything.length === 0 ? "The shelves are being stocked." : "Prices are before GST, which is added at checkout."}
            </p>
            {!userId ? (
              <p className="mt-2 text-[14px] text-canvas/75">
                <Link href="/signup" className="font-medium text-gold underline-offset-4 hover:underline">
                  Create a free account
                </Link>{" "}
                to buy, or{" "}
                <Link href="/login?next=/marketplace" className="font-medium text-canvas underline-offset-4 hover:underline">
                  sign in
                </Link>
                .
              </p>
            ) : (
              !canShop && <p className="mt-2 max-w-xl text-[14px] text-canvas/75">You can look around. Buying is for learner accounts: students, alumni and people who signed up for the marketplace.</p>
            )}
          </div>
          <ShopShelf items={all.recorded.slice(0, 16)} empty="Recordings land here as institutes list them." />
        </div>
      </section>

      {/* The two options, side by side on every screen: they are the marketplace's whole map. */}
      <section aria-label="Two ways to learn" className="bg-brand-deep pt-10 pb-12 sm:pb-16">
        <div className={cx(shell, "grid grid-cols-2 gap-3 sm:gap-6")}>
          <OptionDoor
            href="/marketplace/recorded"
            title="Recorded lectures"
            line="Courses, single lectures and combos. Buy once, watch any time."
            count={all.recorded.length > 0 ? `${all.recorded.length} to watch` : "Coming soon"}
          >
            <path d="M4 5.5h16v10H4zM9 19.5h6M12 15.5v4M10.5 8.5v4l3.5-2z" />
          </OptionDoor>
          <OptionDoor
            href="/marketplace/live"
            title="Live lectures and batches"
            line="Join an institute's batch: set dates, days and times, limited seats."
            count={all.live.length > 0 ? `${all.live.length} ${all.live.length === 1 ? "batch" : "batches"} open` : "Coming soon"}
          >
            <path d="M5 6.5h14v13H5zM5 10.5h14M9 4v4M15 4v4M9 14h2M13 14h2M9 16.5h2" />
          </OptionDoor>
        </div>
      </section>

      <div className={cx(shell, "pt-14 sm:pt-20")}>
        {results ? (
          <div className="space-y-16">
            <div>
              <p className="text-[15px] text-muted">
                {found!.length} {found!.length === 1 ? "result" : "results"} for &ldquo;{q}&rdquo; ·{" "}
                <Link href="/marketplace" className="font-medium text-brand hover:underline">
                  Clear search
                </Link>
              </p>
            </div>
            {found!.length === 0 ? (
              <EmptyShelf title="Nothing on the marketplace matches that yet." href="/marketplace" action="Back to the marketplace">
                Try a shorter word, or the name of an institute. Search looks through recorded lectures and live batches.
              </EmptyShelf>
            ) : (
              <>
                <section aria-labelledby="found-recorded">
                  <SectionHead
                    id="found-recorded"
                    title={`Recorded lectures (${results.recorded.length})`}
                    note="Watch any time."
                    href={query("/marketplace/recorded", { q })}
                    more={results.recorded.length > 0 ? "Filter and sort these" : undefined}
                  />
                  {results.recorded.length > 0 ? <BookGrid items={results.recorded} /> : <p className="text-[15px] text-muted">No recordings match &ldquo;{q}&rdquo;.</p>}
                </section>
                <section aria-labelledby="found-live">
                  <SectionHead
                    id="found-live"
                    title={`Live lectures and batches (${results.live.length})`}
                    note="Fixed dates, days and times."
                    href={query("/marketplace/live", { q })}
                    more={results.live.length > 0 ? "Filter and sort these" : undefined}
                  />
                  {results.live.length > 0 ? <LiveGrid items={results.live} /> : <p className="text-[15px] text-muted">No live batches match &ldquo;{q}&rdquo;.</p>}
                </section>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-20">
            <section aria-labelledby="shelf-recorded">
              <SectionHead
                id="shelf-recorded"
                title="Recorded lectures"
                note="Watch any time, at your own pace."
                href="/marketplace/recorded"
                more={all.recorded.length > 0 ? (all.recorded.length > 8 ? `All ${all.recorded.length} recordings` : "Browse recorded") : undefined}
              />
              {all.recorded.length > 0 ? (
                <BookGrid items={all.recorded.slice(0, 8)} />
              ) : (
                <EmptyShelf title="The first recordings are on their way.">Institutes list their recorded courses, single lectures and combos here. Check back soon.</EmptyShelf>
              )}
            </section>

            <section aria-labelledby="shelf-live">
              <SectionHead
                id="shelf-live"
                title="Live lectures and batches"
                note="Taught live, on set days and times, with limited seats."
                href="/marketplace/live"
                more={all.live.length > 0 ? (all.live.length > 6 ? `All ${all.live.length} live batches` : "Browse live") : undefined}
              />
              {all.live.length > 0 ? (
                <LiveGrid items={all.live.slice(0, 6)} />
              ) : (
                <EmptyShelf title="No live batches are open right now.">When an institute opens a batch to marketplace learners, it shows here with its dates, class times and seats.</EmptyShelf>
              )}
            </section>

            <section aria-labelledby="shelf-institutes">
              <SectionHead
                id="shelf-institutes"
                title="Institutes"
                note={selling.length > 0 ? `${selling.length} ${selling.length === 1 ? "institute is" : "institutes are"} selling here now.` : "Every institute on Zinny has a page here."}
                href="/marketplace/institutes"
                more={directory.length > 0 ? (directory.length > 6 ? `All ${directory.length} institutes` : "See all institutes") : undefined}
              />
              {faces.length > 0 ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {faces.map((face) => (
                    <InstituteCard key={face.slug} face={face} />
                  ))}
                </div>
              ) : (
                <EmptyShelf title="Institutes are on their way.">Each institute on Zinny gets a page here with what it sells.</EmptyShelf>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}
