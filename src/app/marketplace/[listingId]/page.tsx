import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { ActionForm } from "@/components/forms";
import { ButtonLink, cx } from "@/components/ui";
import { currentUserId } from "@/server/auth/session";
import { buyAction } from "@/modules/marketplace/actions";
import { inCart } from "@/modules/marketplace/cart";
import { AddToCart } from "@/modules/marketplace/components/add-to-cart";
import { BuyNow } from "@/modules/marketplace/components/buy-now";
import { CodeField } from "@/modules/marketplace/components/code-field";
import { BookCard, Jacket, lessonsLine } from "@/modules/marketplace/components/jacket";
import { ListingBook } from "@/modules/marketplace/components/listing-book";
import { instituteFaces } from "@/modules/marketplace/components/browse";
import { datesLine } from "@/modules/marketplace/components/live";
import { FORMAT_LINE, KIND_LABEL, Price } from "@/modules/marketplace/components/price";
import { browseMarketplace, listingDetail, marketplaceAccess, splitCatalog } from "@/modules/marketplace/service";
import { LiveListing } from "./live-listing";
import { inr } from "@/modules/payments/money";
import { getSite } from "@/modules/website-builder/cached";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ listingId: string }> }): Promise<Metadata> {
  const { listingId } = await params;
  const item = await listingDetail(listingId, null);
  if (!item) return { title: "Marketplace" };
  if (item.live) {
    return {
      title: `${item.title}: live batch from ${item.institute}`,
      description: item.description || `Live batch from ${item.institute}: ${datesLine(item.live)}, ${item.live.timings}. ${item.live.classes} classes.`,
    };
  }
  return { title: item.title, description: item.description || `${KIND_LABEL[item.kind]} from ${item.institute} on the Zinny marketplace. Recorded: watch any time.` };
}

/** "A", "A and B", "A, B and C". */
function listOf(names: string[]) {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const shell = "mx-auto max-w-6xl px-4 sm:px-6";

function Tick() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="mt-1 size-4 shrink-0 text-brand" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The listing is a book on the desk: it opens to a title page with the way to buy, and the contents written out beside it. */
export default async function Listing({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const userId = await currentUserId();
  const [item, { canShop }] = await Promise.all([listingDetail(listingId, userId), userId ? marketplaceAccess(userId) : { canShop: false }]);
  if (!item) notFound();
  const [site, everything, carted] = await Promise.all([
    getSite(item.instituteSlug),
    browseMarketplace({ institute: item.instituteSlug, format: "all" }),
    userId && canShop && !item.ownedEnrolmentId ? inCart(userId, item.id) : false,
  ]);
  const theirs = splitCatalog(everything);
  const siblings = theirs.recorded;

  // A seat in a live batch is a different thing to buy, so it gets a page of its own shape.
  if (item.live) {
    const [face] = await instituteFaces([{ name: item.institute, slug: item.instituteSlug, recorded: theirs.recorded.length, live: theirs.live.length }]);
    return (
      <LiveListing
        item={item}
        live={item.live}
        canShop={canShop}
        signedIn={!!userId}
        carted={carted}
        face={face}
        hasSite={face.hasSite}
        moreLive={theirs.live.filter((l) => l.id !== item.id).slice(0, 3)}
        moreRecorded={theirs.recorded.slice(0, 4)}
      />
    );
  }
  const lessonCount = item.outline.sections.reduce((n, s) => n + s.lessons.length, 0);
  // Each lesson's place in the whole list, so the contents write in one after another.
  const lessonsBefore = item.outline.sections.map((_, si) => item.outline.sections.slice(0, si).reduce((n, s) => n + s.lessons.length, 0));
  const facts = `${KIND_LABEL[item.kind]} · ${lessonsLine(lessonCount, item.minutes)}`;
  const more = siblings.filter((s) => s.id !== item.id).slice(0, 4);
  const shelf = `/marketplace/institutes/${item.instituteSlug}`;

  const titlePage = (
    <>
      <div className="flex items-center gap-3">
        <div id="listing-book" className="w-11 shrink-0">
          <Jacket item={item} />
        </div>
        <div className="min-w-0 text-[14px] leading-snug">
          <Link href={shelf} className="font-medium text-brand hover:underline">
            {item.institute}
          </Link>
          <div className="text-muted">{facts}</div>
        </div>
      </div>
      <p className="mt-6 inline-flex rounded-full bg-brand-soft px-3 py-1 text-[13px] font-medium text-brand-deep">{FORMAT_LINE.recorded}</p>
      <h1 className="mt-3 text-[clamp(2.2rem,4.4vw,3.4rem)] leading-[1.04] font-semibold [text-wrap:balance]">
        {item.title}
      </h1>
      {item.description && <p className="mt-4 text-[16px] leading-relaxed whitespace-pre-line text-ink/80">{item.description}</p>}
      {item.includes.length > 0 && (
        <p className="mt-4 text-[15px] text-ink/80">
          <span className="text-muted">This combo brings together </span>
          {listOf(item.includes)}.
        </p>
      )}

      <div className="mt-8 border-t border-line pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Price pricePaise={item.pricePaise} compareAtPaise={item.compareAtPaise} size="lg" />
          {item.percentOff && item.compareAtPaise && (
            <span data-stamp className="rounded-full bg-gold px-3 py-1 text-[13.5px] font-semibold text-brand-deep">
              Save {inr(item.compareAtPaise - item.pricePaise)}, {item.percentOff}% off
            </span>
          )}
        </div>
        <p className="mt-2 text-[13.5px] text-muted">GST is added at checkout, and a GST invoice comes with your purchase.</p>

        <div className="mt-5 max-w-sm">
          {item.ownedEnrolmentId ? (
            <div className="space-y-3">
              <p className="text-[15px] font-medium text-brand">This is on your shelf.</p>
              <ButtonLink href={`/${item.instituteSlug}/learn/my/${item.ownedEnrolmentId}`}>Open it</ButtonLink>
            </div>
          ) : canShop ? (
            <ActionForm action={buyAction} resetOnSuccess={false} className="space-y-3">
              <input type="hidden" name="listingId" value={item.id} />
              <BuyNow />
              <AddToCart listingId={item.id} inCart={carted} />
              <CodeField />
            </ActionForm>
          ) : userId ? (
            <p className="text-[14px] leading-relaxed text-muted">Buying is for learner accounts: students, alumni and people who signed up for the marketplace.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="/signup">Create a free account to buy</ButtonLink>
              <Link href={`/login?next=/marketplace/${item.id}`} className="text-[15px] font-medium text-brand hover:underline">
                Sign in
              </Link>
            </div>
          )}
        </div>
      </div>

      <ul className="mt-7 space-y-1.5 text-[14px] text-ink/80">
        <li className="flex gap-2.5">
          <Tick />
          Watch at your own pace, as often as you like
        </li>
        <li className="flex gap-2.5">
          <Tick />
          Your progress is saved lesson by lesson
        </li>
        <li className="flex gap-2.5">
          <Tick />
          {/* One text box, so the link wraps with the sentence instead of becoming a column of its own. */}
          <span>
            Sold and invoiced by {item.institute}
            {site && (
              <>
                {" · "}
                <Link href={`/site/${item.instituteSlug}`} className="font-medium text-brand hover:underline">
                  their website
                </Link>
              </>
            )}
          </span>
        </li>
      </ul>
    </>
  );

  const contentsPage = (
    <section aria-labelledby="contents">
      <h2 id="contents" className="text-[clamp(1.8rem,3vw,2.4rem)] leading-tight font-semibold">
        Contents
      </h2>
      <p className="mt-1 text-[14px] text-muted">
        {lessonCount} {lessonCount === 1 ? "lesson" : "lessons"} in {item.outline.sections.length} {item.outline.sections.length === 1 ? "part" : "parts"}
      </p>
      <div className="mt-6 space-y-7">
        {item.outline.sections.map((s, si) => (
          <section key={s.title}>
            <h3 className="text-[15px] font-semibold text-brand-deep">{s.title}</h3>
            <ol className="mt-1.5">
              {s.lessons.map((l, i) => (
                <li key={`${l.title}-${i}`} data-ink-line style={{ "--i": lessonsBefore[si] + i } as CSSProperties} className="group/line flex items-baseline gap-2.5 py-1.5 text-[14.5px]">
                  <span className="min-w-0 [transition-property:color] duration-150 group-hover/line:text-brand">{l.title}</span>
                  <span aria-hidden data-leader className="h-px min-w-5 flex-1 translate-y-[-3px] border-b border-dotted border-faint [transition-property:border-color] duration-150 group-hover/line:border-brand" />
                  <span className="tabular shrink-0 text-[13.5px] text-muted">{l.durationMinutes > 0 ? `${l.durationMinutes} min` : l.kind === "video" ? "Video" : "Reading"}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </section>
  );

  return (
    <>
      <section aria-label={item.title} className="overflow-x-clip bg-brand-deep pt-6 pb-16 sm:pt-8 sm:pb-20">
        <div className={shell}>
          <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap gap-x-2 text-[14px] text-canvas/60">
            <Link href="/marketplace" className="hover:text-canvas">
              Marketplace
            </Link>
            <span aria-hidden>/</span>
            <Link href="/marketplace/recorded" className="hover:text-canvas">
              Recorded
            </Link>
            <span aria-hidden>/</span>
            <Link href={shelf} className="hover:text-canvas">
              {item.institute}
            </Link>
          </nav>
          <ListingBook left={titlePage} right={contentsPage} />
        </div>
      </section>

      {more.length > 0 && (
        <section aria-labelledby="more" className={cx(shell, "pt-16")}>
          <div className="mb-8 flex items-end justify-between gap-6 border-b border-line pb-4">
            <h2 id="more" className="text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">
              More from {item.institute}
            </h2>
            <Link href={shelf} className="shrink-0 pb-1 text-[14px] font-medium text-brand hover:underline">
              Their page
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 sm:gap-x-7 lg:grid-cols-4">
            {more.map((m) => (
              <BookCard key={m.id} item={m} showInstitute={false} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
