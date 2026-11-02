import Link from "next/link";
import { Badge, ButtonLink, Empty, Input, Notice, cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { browseMarketplace, marketplaceAccess, marketplaceInstitute, type CatalogItem } from "@/modules/marketplace/service";
import { inr } from "@/modules/payments/money";
import { getSite } from "@/modules/website-builder/cached";

export const metadata = { title: "Marketplace" };
export const dynamic = "force-dynamic";

type Search = { q?: string; kind?: string; institute?: string };

const KINDS = [
  { key: "", label: "All" },
  { key: "course", label: "Courses" },
  { key: "lecture", label: "Lectures" },
] as const;

function duration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`;
}

/** The whole card opens the listing; the institute name above it is its own link. */
function Listing({ item, showInstitute }: { item: CatalogItem; showInstitute: boolean }) {
  return (
    <article className="group relative flex flex-col rounded-[22px] border border-line bg-surface p-5 hover:border-brand/40">
      <div className="flex items-center justify-between gap-3">
        {showInstitute ? (
          <Link href={`/marketplace?institute=${item.instituteSlug}`} className="relative z-10 min-w-0 truncate text-[13px] text-muted hover:text-brand hover:underline">
            {item.institute}
          </Link>
        ) : (
          <span />
        )}
        <Badge tone={item.kind === "lecture" ? "neutral" : "brand"}>{item.kind === "lecture" ? "Lecture" : "Course"}</Badge>
      </div>
      <h2 className="mt-3 text-[23px] leading-[1.2] font-medium group-hover:text-brand">
        <Link href={`/marketplace/${item.id}`} className="after:absolute after:inset-0 after:rounded-[22px]">
          {item.title}
        </Link>
      </h2>
      {item.description && <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-muted">{item.description}</p>}
      <div className="mt-auto flex items-baseline justify-between gap-3 pt-5">
        <span className="text-[13px] text-muted">
          {item.lessons} {item.lessons === 1 ? "lesson" : "lessons"}
          {item.minutes > 0 && ` · ${duration(item.minutes)}`}
        </span>
        <span className="tabular text-[16px] font-medium whitespace-nowrap">{inr(item.totalPaise)}</span>
      </div>
    </article>
  );
}

export default async function Marketplace({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const userId = await currentUserId();
  const { canShop } = userId ? await marketplaceAccess(userId) : { canShop: false };

  const q = (sp.q ?? "").trim();
  const kind = sp.kind === "course" || sp.kind === "lecture" ? sp.kind : undefined;
  const institute = sp.institute ? await marketplaceInstitute(sp.institute) : null;
  const [items, site] = await Promise.all([browseMarketplace({ q, kind, institute: institute?.slug }), institute ? getSite(institute.slug) : null]);
  const filterHref = (key: string) => {
    const params = new URLSearchParams({ ...(institute ? { institute: institute.slug } : {}), ...(q ? { q } : {}), ...(key ? { kind: key } : {}) }).toString();
    return params ? `/marketplace?${params}` : "/marketplace";
  };

  return (
    <>
      {institute ? (
        <>
          <Link href="/marketplace" className="text-sm text-muted hover:text-ink">
            All institutes
          </Link>
          <h1 className="mt-3 max-w-3xl text-[clamp(2.25rem,6vw,3.75rem)] leading-[1.02] font-medium">{institute.name}</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">
            Recorded courses and lectures sold by {institute.name}. Buy once and watch at your own pace.
            {site && (
              <>
                {" "}
                <Link href={`/site/${institute.slug}`} className="font-medium text-brand">
                  Visit their website
                </Link>
              </>
            )}
          </p>
        </>
      ) : (
        <>
          <h1 className="max-w-3xl text-[clamp(2.25rem,6vw,3.75rem)] leading-[1.02] font-medium">Recorded courses and lectures from institutes</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">Buy once and watch at your own pace. Everything you buy stays in My library.</p>
        </>
      )}
      {!userId ? (
        <p className="mt-3 text-[15px] text-muted">
          <Link href="/signup" className="font-medium text-brand">
            Create a free account
          </Link>{" "}
          to buy, or{" "}
          <Link href="/login?next=/marketplace" className="font-medium text-brand">
            sign in
          </Link>
          .
        </p>
      ) : (
        !canShop && (
          <div className="mt-5 max-w-2xl">
            <Notice tone="neutral">You can look around. Buying is open to independent learners and alumni; current students learn through their institute.</Notice>
          </div>
        )
      )}

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form action="/marketplace" className="w-full sm:max-w-sm">
          {institute && <input type="hidden" name="institute" value={institute.slug} />}
          {kind && <input type="hidden" name="kind" value={kind} />}
          <Input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={institute ? `Search ${institute.name}` : "Search by topic or institute"}
            aria-label="Search the marketplace"
          />
        </form>
        <nav aria-label="Filter" className="flex gap-1 self-start rounded-full border border-line bg-surface p-1">
          {KINDS.map((k) => (
            <Link
              key={k.key}
              href={filterHref(k.key)}
              aria-current={(kind ?? "") === k.key ? "page" : undefined}
              className={cx("rounded-full px-4 py-1.5 text-[14px]", (kind ?? "") === k.key ? "bg-brand font-medium text-canvas" : "text-muted hover:text-ink")}
            >
              {k.label}
            </Link>
          ))}
        </nav>
      </div>

      {items.length === 0 ? (
        <div className="mt-8">
          <Empty title={q ? `Nothing matches "${q}"` : institute ? `${institute.name} has nothing on sale yet` : "Nothing on sale yet"}>
            {q ? "Try a shorter search." : institute ? "Their recorded courses will show here once they list them." : "Institutes are adding their recordings. Check back soon."}
            {(q || institute) && (
              <div className="mt-4">
                <ButtonLink href={q && institute ? `/marketplace?institute=${institute.slug}` : "/marketplace"} variant="secondary" size="sm">
                  {q ? "Clear the search" : "See every institute"}
                </ButtonLink>
              </div>
            )}
          </Empty>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Listing key={item.id} item={item} showInstitute={!institute} />
          ))}
        </div>
      )}
    </>
  );
}
