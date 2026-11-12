import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cx } from "@/components/ui";
import { formatDate } from "@/server/lib/dates";
import { BookGrid, EmptyShelf, instituteFaces, shell } from "@/modules/marketplace/components/browse";
import { DateLeaf, InstituteMark, LiveGrid, classesLine, countsLine, firstLine, seatsLine } from "@/modules/marketplace/components/live";
import { Price } from "@/modules/marketplace/components/price";
import { fewSeatsLeft, instituteShelves, startsSoon, type LiveCatalogItem } from "@/modules/marketplace/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> };

const TABS = [
  { key: "recorded", label: "Recorded" },
  { key: "live", label: "Live batches" },
  { key: "upcoming", label: "Upcoming" },
] as const;
type Tab = (typeof TABS)[number]["key"];

async function load(slug: string) {
  const shelves = await instituteShelves(slug);
  if (!shelves) return null;
  const { institute, recorded, live, upcoming } = shelves;
  const [face] = await instituteFaces([{ ...institute, recorded: recorded.length, live: live.length }]);
  return { institute, recorded, live, upcoming, face };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).slug);
  if (!data) return { title: "Institutes" };
  const { face, institute } = data;
  const selling = countsLine(face);
  return {
    title: `${institute.name} on the marketplace`,
    description: face.fullAbout
      ? firstLine(face.fullAbout, 155)
      : `${institute.name} on the Zinny marketplace${face.recorded + face.live > 0 ? `: ${selling}` : ""}. See its recorded lectures, live batches and what is coming up.`,
  };
}

/** "Starts 12 Jan" and how far off that is, for the Upcoming tab. */
function startsOn(item: LiveCatalogItem) {
  const { startDate, startsInDays } = item.live;
  return { on: `Starts ${formatDate(startDate, { year: false })}`, away: startsInDays === 1 ? "Starts tomorrow" : `Starts in ${startsInDays} days` };
}

/** One batch that hasn't started yet, as a line in the Upcoming list. */
function UpcomingRow({ item }: { item: LiveCatalogItem }) {
  const live = item.live;
  const when = startsOn(item);
  const full = live.seatsLeft === 0;
  return (
    <li>
      <Link href={`/marketplace/${item.id}`} className="group flex gap-4 py-5 outline-offset-2 sm:items-center sm:gap-6">
        <DateLeaf live={live} />
        <span className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <span className={cx("rounded-full px-2.5 py-1 leading-none font-medium", startsSoon(live) ? "bg-gold text-brand-deep" : "bg-brand-soft text-brand-deep")}>{when.on}</span>
              <span className="text-muted">{when.away}</span>
            </span>
            <span className="mt-1.5 block text-[17px] leading-snug font-medium group-hover:text-brand">{item.title}</span>
            <span className="mt-0.5 block text-[13.5px] text-muted">
              {live.batchName} · {live.timings} · {classesLine(live.classes)}
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 sm:flex-col sm:items-end sm:gap-1">
            <Price pricePaise={item.pricePaise} compareAtPaise={item.compareAtPaise} />
            {full ? (
              <span className="text-[13px] font-medium text-ink">Batch full</span>
            ) : (
              fewSeatsLeft(live) && <span className="rounded-full bg-gold px-2.5 py-1 text-[12.5px] leading-none font-medium text-brand-deep">{seatsLine(live.seatsLeft)}</span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** An institute's page inside the marketplace: who they are, then what they sell under three tabs. */
export default async function Institute({ params, searchParams }: Params) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { institute, recorded, live, upcoming, face } = data;
  const counts: Record<Tab, number> = { recorded: recorded.length, live: live.length, upcoming: upcoming.length };
  const asked = (await searchParams).tab;
  // With nothing asked for, open on the first tab that has something in it.
  const tab: Tab = TABS.find((t) => t.key === asked)?.key ?? TABS.find((t) => counts[t.key] > 0)?.key ?? "recorded";
  const base = `/marketplace/institutes/${institute.slug}`;
  const running = live.filter((i) => i.live.phase === "running");

  return (
    <>
      <section aria-labelledby="institute" className="bg-brand-deep text-canvas">
        <div className={cx(shell, "pt-8 sm:pt-12")}>
          <Link href="/marketplace/institutes" className="text-[14px] text-canvas/65 hover:text-canvas">
            Institutes
          </Link>
          <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
            <InstituteMark face={face} size={84} />
            <div className="min-w-0">
              <h1 id="institute" className="max-w-[20ch] text-[clamp(2.2rem,5.2vw,3.75rem)] leading-[1.04] font-semibold [text-wrap:balance]">
                {institute.name}
              </h1>
              <p className="mt-2 text-[14px] text-canvas/65">
                {face.city ? `${face.city} · ` : ""}
                {countsLine(face)}
              </p>
              <p className="mt-4 max-w-2xl text-[16.5px] leading-relaxed whitespace-pre-line text-canvas/80">
                {face.fullAbout || `${institute.name} teaches on Zinny. What it sells to learners everywhere is on this page: recordings to watch any time, and seats in its live batches.`}
              </p>
              {face.hasSite && (
                <a
                  href={`/site/${institute.slug}`}
                  className="mt-5 inline-flex rounded-full px-4 py-2 text-[14px] font-medium text-canvas ring-1 ring-canvas/30 [transition-property:background-color] duration-150 hover:bg-canvas/10"
                >
                  Visit their website
                </a>
              )}
            </div>
          </div>

          <nav aria-label="What they offer" className="mt-10 -mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <Link
                  key={t.key}
                  href={`${base}?tab=${t.key}`}
                  scroll={false}
                  aria-current={on ? "page" : undefined}
                  className={cx(
                    "shrink-0 rounded-t-[14px] px-4 py-3 text-[15px] whitespace-nowrap [transition-property:background-color,color] duration-150 sm:px-5",
                    on ? "bg-canvas font-medium text-brand-deep" : "text-canvas/75 hover:bg-canvas/10 hover:text-canvas",
                  )}
                >
                  {t.label}
                  <span className={cx("tabular ml-2 text-[13px]", on ? "text-muted" : "text-canvas/55")}>{counts[t.key]}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </section>

      <div className={cx(shell, "pt-10 sm:pt-14")}>
        {tab === "recorded" && (
          <section aria-labelledby="tab-title">
            <h2 id="tab-title" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">
              Recorded
            </h2>
            <p className="mt-1 mb-8 text-[14px] text-muted">Courses, single lectures and combos. Buy once and watch any time.</p>
            {recorded.length > 0 ? (
              <BookGrid items={recorded} showInstitute={false} />
            ) : (
              <EmptyShelf title="No recordings here yet." href={live.length > 0 ? `${base}?tab=live` : "/marketplace/recorded"} action={live.length > 0 ? "See their live batches" : "Browse other recordings"}>
                When {institute.name} lists a recorded course, a single lecture or a combo, it shows here, ready to watch the day you buy it.
              </EmptyShelf>
            )}
          </section>
        )}

        {tab === "live" && (
          <section aria-labelledby="tab-title">
            <h2 id="tab-title" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">
              Live batches
            </h2>
            <p className="mt-1 mb-8 text-[14px] text-muted">
              {live.length > 0
                ? `${running.length > 0 ? `${running.length} running now and still taking learners, ` : ""}${upcoming.length} yet to start. Times are in the institute's time zone.`
                : "Batches taught live, on set days and times, with limited seats."}
            </p>
            {live.length > 0 ? (
              <LiveGrid items={live} showInstitute={false} />
            ) : (
              <EmptyShelf title="No live batches are open here right now." href={recorded.length > 0 ? `${base}?tab=recorded` : "/marketplace/live"} action={recorded.length > 0 ? "See their recordings" : "Browse other live batches"}>
                When {institute.name} opens a batch to marketplace learners, it shows here with its dates, class times and the seats it has left.
              </EmptyShelf>
            )}
          </section>
        )}

        {tab === "upcoming" && (
          <section aria-labelledby="tab-title">
            <h2 id="tab-title" className="text-[clamp(1.7rem,3.4vw,2.4rem)] leading-tight font-semibold">
              Upcoming
            </h2>
            <p className="mt-1 mb-4 text-[14px] text-muted">Live batches that haven&apos;t started yet, the soonest first.</p>
            {upcoming.length > 0 ? (
              <ul className="divide-y divide-line border-y border-line">
                {upcoming.map((item) => (
                  <UpcomingRow key={item.id} item={item} />
                ))}
              </ul>
            ) : (
              <div className="mt-4">
                <EmptyShelf
                  title="Nothing is waiting to start."
                  href={running.length > 0 ? `${base}?tab=live` : recorded.length > 0 ? `${base}?tab=recorded` : "/marketplace/live"}
                  action={running.length > 0 ? "See batches running now" : recorded.length > 0 ? "See their recordings" : "Browse other live batches"}
                >
                  New batches from {institute.name} show here as soon as they are listed, with the day they start and how long is left to join.
                </EmptyShelf>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
