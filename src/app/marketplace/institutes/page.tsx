import type { Metadata } from "next";
import Link from "next/link";
import { cx } from "@/components/ui";
import { BrowseTop, EmptyShelf, SearchBar, instituteFaces, shell } from "@/modules/marketplace/components/browse";
import { InstituteCard } from "@/modules/marketplace/components/live";
import { marketplaceDirectory } from "@/modules/marketplace/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Institutes",
  description: "Every institute on Zinny, with the recorded lectures and live batches each one offers on the marketplace.",
};

/** The directory: every active institute, the ones with something on sale first. */
export default async function Institutes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  const directory = await marketplaceDirectory({ q });
  const faces = await instituteFaces(directory);
  const selling = directory.filter((i) => i.listings > 0).length;

  return (
    <>
      <BrowseTop
        id="institutes"
        crumb={{ href: "/marketplace", label: "Marketplace" }}
        title="Institutes"
        lede="Everything on the marketplace is taught and sold by an institute. Open one to see its recorded lectures, its live batches and what it has coming up."
      >
        <SearchBar action="/marketplace/institutes" q={q} placeholder="Search institutes by name" label="Search institutes" />
      </BrowseTop>

      <div className={cx(shell, "pt-12 sm:pt-16")}>
        <section aria-labelledby="results">
          <div className="mb-8 border-b border-line pb-4">
            <h2 id="results" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">
              {directory.length} {directory.length === 1 ? "institute" : "institutes"}
              {q && <span className="text-muted"> for &ldquo;{q}&rdquo;</span>}
            </h2>
            <p className="mt-1 text-[14px] text-muted">
              {q ? (
                <Link href="/marketplace/institutes" className="text-brand hover:underline">
                  Clear search
                </Link>
              ) : selling > 0 ? (
                `${selling} with something on sale now, listed first.`
              ) : (
                "None has put anything on sale yet."
              )}
            </p>
          </div>
          {faces.length === 0 ? (
            <EmptyShelf title={q ? "No institute goes by that name." : "Institutes are on their way."} href={q ? "/marketplace/institutes" : undefined} action="See all institutes">
              {q ? "Check the spelling, or try one word of the name." : "Each institute on Zinny gets a page here with what it sells."}
            </EmptyShelf>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {faces.map((face) => (
                <InstituteCard key={face.slug} face={face} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
