import type { Metadata } from "next";
import Link from "next/link";
import { cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { BookCard, ShopShelf } from "@/modules/marketplace/components/jacket";
import { browseMarketplace, marketplaceAccess, marketplaceInstitute, marketplaceInstitutes, type CatalogItem, type CatalogSort } from "@/modules/marketplace/service";
import { getSite } from "@/modules/website-builder/cached";

export const dynamic = "force-dynamic";

type Search = { q?: string; kind?: string; institute?: string; offer?: string; sort?: string };

export async function generateMetadata({ searchParams }: { searchParams: Promise<Search> }): Promise<Metadata> {
  const sp = await searchParams;
  const institute = sp.institute ? await marketplaceInstitute(sp.institute) : null;
  return { title: institute ? `${institute.name} on the marketplace` : "Marketplace" };
}

/** Below this many recordings, the shop front doesn't say how many there are. */
const COUNT_FROM = 12;
/** Up to this many recordings (or with one institute selling), one grid instead of rows by deal and institute. */
const ONE_GRID_UP_TO = 8;

const shell = "mx-auto max-w-6xl px-4 sm:px-6";

const KINDS = [
  { key: "", label: "Everything" },
  { key: "course", label: "Courses" },
  { key: "lecture", label: "Lectures" },
  { key: "combo", label: "Combos" },
] as const;

const SORTS: { key: CatalogSort; label: string }[] = [
  { key: "new", label: "Newest" },
  { key: "price-low", label: "Price, low to high" },
  { key: "price-high", label: "Price, high to low" },
  { key: "deals", label: "Biggest discount" },
];

function Shelf({ items, showInstitute = true }: { items: CatalogItem[]; showInstitute?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 sm:gap-x-7 lg:grid-cols-4">
      {items.map((item) => (
        <BookCard key={item.id} item={item} showInstitute={showInstitute} />
      ))}
    </div>
  );
}

function SectionHead({ title, href, more }: { title: string; href?: string; more?: string }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-6 border-b border-line pb-4">
      <h2 className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">{title}</h2>
      {href && more && (
        <Link href={href} className="shrink-0 pb-1 text-[14px] font-medium text-brand hover:underline">
          {more}
        </Link>
      )}
    </div>
  );
}

export default async function Marketplace({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const userId = await currentUserId();
  const q = (sp.q ?? "").trim();
  const kind = sp.kind === "course" || sp.kind === "lecture" || sp.kind === "combo" ? sp.kind : undefined;
  const sort = SORTS.some((s) => s.key === sp.sort) ? (sp.sort as CatalogSort) : undefined;
  const onOffer = sp.offer === "1";
  const institute = sp.institute ? await marketplaceInstitute(sp.institute) : null;
  const browsing = Boolean(q || kind || sort || onOffer || institute);

  const [{ canShop }, all, institutes, site, results] = await Promise.all([
    userId ? marketplaceAccess(userId) : { canShop: false },
    browseMarketplace(),
    marketplaceInstitutes(),
    institute ? getSite(institute.slug) : null,
    browsing ? browseMarketplace({ q, kind, institute: institute?.slug, onOffer, sort }) : null,
  ]);

  const href = (over: Partial<Record<"kind" | "offer" | "sort", string>>) => {
    const p = new URLSearchParams({
      ...(institute ? { institute: institute.slug } : {}),
      ...(q ? { q } : {}),
      ...(kind ? { kind } : {}),
      ...(onOffer ? { offer: "1" } : {}),
      ...(sort ? { sort } : {}),
      ...over,
    });
    for (const [k, v] of [...p.entries()]) if (!v || (k === "sort" && v === "new")) p.delete(k);
    const s = p.toString();
    return s ? `/marketplace?${s}` : "/marketplace";
  };
  const shelfBooks = (institute ? all.filter((i) => i.instituteSlug === institute.slug) : all).slice(0, 16);
  const deals = all.filter((i) => i.percentOff).sort((a, b) => (b.percentOff ?? 0) - (a.percentOff ?? 0));

  return (
    <>
      <section aria-labelledby="shopfront" className="overflow-hidden bg-brand-deep text-canvas">
        <div className={cx(shell, "grid gap-10 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14")}>
          <div className="lg:pb-20">
            {institute && (
              <Link href="/marketplace" className="text-[14px] text-canvas/65 hover:text-canvas">
                All institutes
              </Link>
            )}
            <h1 id="shopfront" className="mt-2 max-w-[13ch] text-[clamp(2.6rem,6.4vw,4.75rem)] leading-[1.02] font-semibold [text-wrap:balance]">
              {institute ? institute.name : "Learn from the institutes themselves."}
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-canvas/75">
              {institute
                ? `Recorded courses and lectures sold by ${institute.name}. Buy once and watch at your own pace.`
                : "Recorded courses, single lectures and combos, sold directly by the institutes that teach them. Buy once and watch at your own pace."}
              {site && institute && (
                <>
                  {" "}
                  <Link href={`/site/${institute.slug}`} className="font-medium text-gold underline-offset-4 hover:underline">
                    Visit their website
                  </Link>
                </>
              )}
            </p>

            <form action="/marketplace" role="search" className="mt-8 flex max-w-xl items-center rounded-full bg-canvas p-1.5 shadow-[0_18px_40px_-20px_rgb(0_0_0/0.6)]">
              {institute && <input type="hidden" name="institute" value={institute.slug} />}
              {kind && <input type="hidden" name="kind" value={kind} />}
              <svg aria-hidden viewBox="0 0 20 20" className="ml-4 size-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.7">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <path d="m13 13 4 4" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search courses"
                aria-label="Search the marketplace"
                className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[16px] text-ink outline-none placeholder:text-muted [&:focus-visible]:outline-none"
              />
              <button className="shrink-0 rounded-full bg-brand px-5 py-2.5 text-[15px] font-medium text-canvas [transition-property:background-color] duration-150 hover:bg-brand-strong">
                Search
              </button>
            </form>

            <nav aria-label="Browse by type" className="mt-5 flex flex-wrap gap-2 text-[14px]">
              {KINDS.map((k) => {
                const on = (kind ?? "") === k.key;
                return (
                  <Link
                    key={k.key}
                    href={href({ kind: k.key })}
                    aria-current={on ? "page" : undefined}
                    className={cx(
                      "rounded-full px-4 py-1.5 [transition-property:background-color,color] duration-150",
                      on ? "bg-canvas font-medium text-brand-deep" : "text-canvas/80 ring-1 ring-canvas/25 hover:bg-canvas/10 hover:text-canvas",
                    )}
                  >
                    {k.label}
                  </Link>
                );
              })}
              {(deals.length > 0 || onOffer) && (
                <Link
                  href={href({ offer: onOffer ? "" : "1" })}
                  aria-current={onOffer ? "page" : undefined}
                  className={cx(
                    "rounded-full px-4 py-1.5 [transition-property:background-color,color] duration-150",
                    onOffer ? "bg-canvas font-medium text-brand-deep" : "text-canvas/80 ring-1 ring-canvas/25 hover:bg-canvas/10 hover:text-canvas",
                  )}
                >
                  On offer
                </Link>
              )}
            </nav>

            <p className="mt-7 text-[14px] text-canvas/60">
              {all.length === 0
                ? "The shelves are being stocked."
                : `${all.length >= COUNT_FROM ? `${all.length} recordings from ${institutes.length} ${institutes.length === 1 ? "institute" : "institutes"}. ` : ""}Prices are before GST, which is added at checkout.`}
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

          <ShopShelf items={shelfBooks} empty="Recordings land here as institutes list them." />
        </div>
      </section>

      <div className={cx(shell, "pt-14 sm:pt-20")}>
        {results ? (
          <section aria-labelledby="results">
            <div className="mb-8 flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 id="results" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">
                  {results.length} {results.length === 1 ? "recording" : "recordings"}
                  {onOffer && " on offer"}
                  {q && <span className="text-muted"> for &ldquo;{q}&rdquo;</span>}
                </h2>
                {(q || kind || sort || onOffer) && (
                  <Link href={institute ? `/marketplace?institute=${institute.slug}` : "/marketplace"} className="mt-1 inline-block text-[14px] text-brand hover:underline">
                    Clear filters
                  </Link>
                )}
              </div>
              <nav aria-label="Sort" className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
                {SORTS.map((s) => {
                  const on = (sort ?? "new") === s.key;
                  return (
                    <Link
                      key={s.key}
                      href={href({ sort: s.key })}
                      aria-current={on ? "page" : undefined}
                      className={on ? "font-medium text-ink underline decoration-gold decoration-2 underline-offset-[6px]" : "text-muted hover:text-ink"}
                    >
                      {s.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            {results.length === 0 ? (
              <div className="rounded-[20px] bg-surface px-6 py-14 text-center">
                <p className="text-[19px] font-medium">{q ? "Nothing on the shelves matches that yet." : "Nothing here yet."}</p>
                <p className="mt-2 text-[15px] text-muted">{q ? "Try a shorter word, or browse everything." : "Institutes add recordings all the time. Check back soon."}</p>
                <Link href="/marketplace" className="mt-5 inline-block rounded-full bg-brand px-5 py-2.5 text-[15px] font-medium text-canvas hover:bg-brand-strong">
                  Browse everything
                </Link>
              </div>
            ) : (
              <Shelf items={results} showInstitute={!institute} />
            )}
          </section>
        ) : all.length === 0 ? (
          <div className="max-w-xl">
            <h2 className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">The first recordings are on their way.</h2>
            <p className="mt-3 text-[16px] leading-relaxed text-muted">
              Institutes on Zinny list their recorded courses here. Create a free account now and you can buy the moment they arrive.
            </p>
          </div>
        ) : institutes.length <= 1 || all.length <= ONE_GRID_UP_TO ? (
          // A small catalogue reads better as one shelf than as rows that repeat the same books.
          <section>
            <SectionHead title="All recordings" />
            <Shelf items={all} />
          </section>
        ) : (
          <div className="space-y-20">
            {deals.length > 0 && (
              <section>
                <SectionHead title="On offer now" href={href({ offer: "1", sort: "deals" })} more={deals.length > 4 ? `All ${deals.length} deals` : undefined} />
                <Shelf items={deals.slice(0, 4)} />
              </section>
            )}
            {institutes.map((inst) => {
              const books = all.filter((i) => i.instituteSlug === inst.slug);
              return (
                <section key={inst.slug}>
                  <SectionHead title={`From ${inst.name}`} href={`/marketplace?institute=${inst.slug}`} more={books.length > 8 ? `All ${books.length} from them` : "Their shelf"} />
                  <Shelf items={books.slice(0, 8)} showInstitute={false} />
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
