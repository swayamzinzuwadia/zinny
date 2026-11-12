import type { Metadata } from "next";
import Link from "next/link";
import { BookGrid, BrowseTop, EmptyShelf, Pill, SearchBar, SortLinks, query, shell } from "@/modules/marketplace/components/browse";
import { browseMarketplace, type CatalogSort } from "@/modules/marketplace/service";
import { cx } from "@/components/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recorded lectures",
  description: "Recorded courses, single lectures and combos from institutes on Zinny. Buy once and watch any time, at your own pace.",
};

type Search = { q?: string; kind?: string; offer?: string; sort?: string };

const KINDS = [
  { key: "", label: "Everything" },
  { key: "course", label: "Courses" },
  { key: "lecture", label: "Lectures" },
  { key: "combo", label: "Combos" },
] as const;

type Sort = Exclude<CatalogSort, "soonest">;
const SORTS: { key: Sort; label: string }[] = [
  { key: "new", label: "Newest" },
  { key: "price-low", label: "Price, low to high" },
  { key: "price-high", label: "Price, high to low" },
  { key: "deals", label: "Biggest discount" },
];

/** Everything recorded: courses, single lectures and combos, with their filters and sorting. */
export default async function Recorded({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const kind = sp.kind === "course" || sp.kind === "lecture" || sp.kind === "combo" ? sp.kind : undefined;
  const sort: Sort = SORTS.find((s) => s.key === sp.sort)?.key ?? "new";
  const onOffer = sp.offer === "1";
  const filtering = Boolean(q || kind || onOffer || sort !== "new");

  const [all, items] = await Promise.all([browseMarketplace(), filtering ? browseMarketplace({ q, kind, onOffer, sort }) : null]);
  const shown = items ?? all;
  const anyDeals = all.some((i) => i.percentOff);
  const href = (over: Partial<Record<"kind" | "offer" | "sort", string>>) => {
    const next = { q, kind, offer: onOffer ? "1" : "", sort: sort === "new" ? "" : sort, ...over };
    return query("/marketplace/recorded", { ...next, sort: next.sort === "new" ? "" : next.sort });
  };

  return (
    <>
      <BrowseTop
        id="recorded"
        crumb={{ href: "/marketplace", label: "Marketplace" }}
        title="Recorded lectures"
        lede="Courses, single lectures and combos, recorded by the institutes that teach them. Buy once and watch any time, as often as you like."
      >
        <SearchBar action="/marketplace/recorded" q={q} placeholder="Search recordings" label="Search recorded lectures" hidden={{ kind, offer: onOffer ? "1" : undefined, sort: sort === "new" ? undefined : sort }} />
        <nav aria-label="Browse by type" className="mt-5 flex flex-wrap gap-2 text-[14px]">
          {KINDS.map((k) => (
            <Pill key={k.key} href={href({ kind: k.key })} on={(kind ?? "") === k.key}>
              {k.label}
            </Pill>
          ))}
          {(anyDeals || onOffer) && (
            <Pill href={href({ offer: onOffer ? "" : "1" })} on={onOffer}>
              On offer
            </Pill>
          )}
        </nav>
      </BrowseTop>

      <div className={cx(shell, "pt-12 sm:pt-16")}>
        <section aria-labelledby="results">
          <div className="mb-8 flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="results" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">
                {shown.length} {shown.length === 1 ? "recording" : "recordings"}
                {onOffer && " on offer"}
                {q && <span className="text-muted"> for &ldquo;{q}&rdquo;</span>}
              </h2>
              {filtering && (
                <Link href="/marketplace/recorded" className="mt-1 inline-block text-[14px] text-brand hover:underline">
                  Clear filters
                </Link>
              )}
            </div>
            <SortLinks options={SORTS} current={sort} href={(key) => href({ sort: key })} />
          </div>
          {shown.length === 0 ? (
            all.length === 0 ? (
              <EmptyShelf title="The first recordings are on their way." href="/marketplace/live" action="See live batches">
                Institutes list their recorded courses, single lectures and combos here. Live batches may already be open.
              </EmptyShelf>
            ) : (
              <EmptyShelf title={q ? "No recordings match that yet." : "Nothing here with these filters."} href="/marketplace/recorded" action="Browse all recordings">
                {q ? "Try a shorter word, or the name of an institute." : "Take a filter off, or browse everything recorded."}
              </EmptyShelf>
            )
          ) : (
            <BookGrid items={shown} />
          )}
        </section>
        <p className="mt-14 text-[15px] text-muted">
          Would you rather learn with a teacher and a class?{" "}
          <Link href="/marketplace/live" className="font-medium text-brand hover:underline">
            See live lectures and batches
          </Link>
        </p>
      </div>
    </>
  );
}
