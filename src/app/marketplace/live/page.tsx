import type { Metadata } from "next";
import Link from "next/link";
import { cx } from "@/components/ui";
import { BrowseTop, EmptyShelf, Pill, SearchBar, SortLinks, query, shell } from "@/modules/marketplace/components/browse";
import { LiveGrid } from "@/modules/marketplace/components/live";
import { browseLive, type LivePhase } from "@/modules/marketplace/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Live lectures and batches",
  description: "Seats in live batches at institutes on Zinny: set dates, days and class times, taught live, with a seat limit.",
};

type Search = { q?: string; when?: string; sort?: string };

const WHEN: { key: "" | LivePhase; label: string }[] = [
  { key: "", label: "All batches" },
  { key: "upcoming", label: "Yet to start" },
  { key: "running", label: "Running now" },
];

type Sort = "soonest" | "price-low" | "price-high";
const SORTS: { key: Sort; label: string }[] = [
  { key: "soonest", label: "Starting soonest" },
  { key: "price-low", label: "Price, low to high" },
  { key: "price-high", label: "Price, high to low" },
];

/** Everything live: seats in real batches, with when they start and how many seats are left. */
export default async function Live({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const phase = sp.when === "upcoming" || sp.when === "running" ? sp.when : undefined;
  const sort: Sort = SORTS.find((s) => s.key === sp.sort)?.key ?? "soonest";
  const filtering = Boolean(q || phase || sort !== "soonest");

  const [all, items] = await Promise.all([browseLive(), filtering ? browseLive({ q, phase, sort }) : null]);
  const shown = items ?? all;
  const href = (over: Partial<Record<"when" | "sort", string>>) => {
    const next = { q, when: phase ?? "", sort, ...over };
    return query("/marketplace/live", { ...next, sort: next.sort === "soonest" ? "" : next.sort });
  };

  return (
    <>
      <BrowseTop
        id="live"
        crumb={{ href: "/marketplace", label: "Marketplace" }}
        title="Live lectures and batches"
        lede="Take a seat in a real batch at an institute. Classes are taught live on set days and times, so each batch shows its dates, its timetable and the seats it has left."
      >
        <SearchBar action="/marketplace/live" q={q} placeholder="Search live batches" label="Search live batches" hidden={{ when: phase, sort: sort === "soonest" ? undefined : sort }} />
        <nav aria-label="Browse by start" className="mt-5 flex flex-wrap gap-2 text-[14px]">
          {WHEN.map((w) => (
            <Pill key={w.key} href={href({ when: w.key })} on={(phase ?? "") === w.key}>
              {w.label}
            </Pill>
          ))}
        </nav>
      </BrowseTop>

      <div className={cx(shell, "pt-12 sm:pt-16")}>
        <section aria-labelledby="results">
          <div className="mb-8 flex flex-col gap-4 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="results" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">
                {shown.length} live {shown.length === 1 ? "batch" : "batches"}
                {phase === "upcoming" && " yet to start"}
                {phase === "running" && " running now"}
                {q && <span className="text-muted"> for &ldquo;{q}&rdquo;</span>}
              </h2>
              {filtering && (
                <Link href="/marketplace/live" className="mt-1 inline-block text-[14px] text-brand hover:underline">
                  Clear filters
                </Link>
              )}
            </div>
            <SortLinks options={SORTS} current={sort} href={(key) => href({ sort: key })} />
          </div>
          {shown.length === 0 ? (
            all.length === 0 ? (
              <EmptyShelf title="No live batches are open right now." href="/marketplace/recorded" action="Browse recorded lectures">
                When an institute opens a batch to marketplace learners, it shows here with its dates, class times and seats. Recordings are ready to watch today.
              </EmptyShelf>
            ) : (
              <EmptyShelf title={q ? "No live batches match that yet." : phase === "running" ? "No running batch is taking late joiners." : "No batches are waiting to start."} href="/marketplace/live" action="See all live batches">
                {q ? "Try a shorter word, or the name of an institute." : "Take the filter off to see every batch that is open."}
              </EmptyShelf>
            )
          ) : (
            <LiveGrid items={shown} />
          )}
        </section>
        <p className="mt-14 text-[15px] text-muted">
          Times are shown in each institute&apos;s own time zone. Prefer to learn at your own pace?{" "}
          <Link href="/marketplace/recorded" className="font-medium text-brand hover:underline">
            See recorded lectures
          </Link>
        </p>
      </div>
    </>
  );
}
