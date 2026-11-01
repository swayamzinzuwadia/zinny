import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, ButtonLink, Empty, Input, cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { browseMarketplace, marketplaceAccess, type CatalogItem } from "@/modules/marketplace/service";
import { inr } from "@/modules/payments/money";

export const metadata = { title: "Marketplace" };
export const dynamic = "force-dynamic";

type Search = { q?: string; kind?: string };

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

function Listing({ item }: { item: CatalogItem }) {
  return (
    <Link href={`/marketplace/${item.id}`} className="group flex flex-col rounded-[22px] border border-line bg-surface p-5 hover:border-brand/40">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] text-muted">{item.institute}</span>
        <Badge tone={item.kind === "lecture" ? "neutral" : "brand"}>{item.kind === "lecture" ? "Lecture" : "Course"}</Badge>
      </div>
      <h2 className="mt-3 text-[23px] leading-[1.2] font-medium group-hover:text-brand">{item.title}</h2>
      {item.description && <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-muted">{item.description}</p>}
      <div className="mt-auto flex items-baseline justify-between gap-3 pt-5">
        <span className="text-[13px] text-muted">
          {item.lessons} {item.lessons === 1 ? "lesson" : "lessons"}
          {item.minutes > 0 && ` · ${duration(item.minutes)}`}
        </span>
        <span className="tabular text-[16px] font-medium whitespace-nowrap">{inr(item.totalPaise)}</span>
      </div>
    </Link>
  );
}

export default async function Marketplace({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/marketplace");
  const { canShop } = await marketplaceAccess(userId);

  if (!canShop) {
    return (
      <Empty title="The marketplace is for independent learners and alumni">
        Current students learn through their institute, and it opens up once you graduate.{" "}
        <Link href="/" className="text-brand">
          Back to your space
        </Link>
      </Empty>
    );
  }

  const q = (sp.q ?? "").trim();
  const kind = sp.kind === "course" || sp.kind === "lecture" ? sp.kind : undefined;
  const items = await browseMarketplace({ q, kind });
  const filterHref = (key: string) => {
    const params = new URLSearchParams({ ...(q ? { q } : {}), ...(key ? { kind: key } : {}) }).toString();
    return params ? `/marketplace?${params}` : "/marketplace";
  };

  return (
    <>
      <h1 className="max-w-3xl text-[clamp(2.25rem,6vw,3.75rem)] leading-[1.02] font-medium">Recorded courses and lectures from institutes</h1>
      <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-muted">Buy once and watch at your own pace. Everything you buy stays in My library.</p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form action="/marketplace" className="w-full sm:max-w-sm">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <Input type="search" name="q" defaultValue={q} placeholder="Search by topic or institute" aria-label="Search the marketplace" />
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
          <Empty title={q ? `Nothing matches "${q}"` : "Nothing on sale yet"}>
            {q ? "Try a shorter search." : "Institutes are adding their recordings. Check back soon."}
            {q && (
              <div className="mt-4">
                <ButtonLink href="/marketplace" variant="secondary" size="sm">
                  Clear the search
                </ButtonLink>
              </div>
            )}
          </Empty>
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Listing key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
