import Link from "next/link";
import { ActionForm } from "@/components/forms";
import { ButtonLink, cx } from "@/components/ui";
import { formatDate, formatTime } from "@/server/lib/dates";
import { buyAction } from "@/modules/marketplace/actions";
import { AddToCart } from "@/modules/marketplace/components/add-to-cart";
import { BookGrid, SectionHead, shell } from "@/modules/marketplace/components/browse";
import { BuyNow } from "@/modules/marketplace/components/buy-now";
import { CodeField } from "@/modules/marketplace/components/code-field";
import { DateLeaf, FactIcon, InstituteCard, LiveBadges, LiveGrid, classesLine, seatsLine, type InstituteFace } from "@/modules/marketplace/components/live";
import { FORMAT_LINE, Price } from "@/modules/marketplace/components/price";
import { fewSeatsLeft, type ListingDetail, type LiveCatalogItem, type LiveInfo, type RecordedCatalogItem } from "@/modules/marketplace/service";
import { inr } from "@/modules/payments/money";

/** "IST" for Asia/Kolkata: the short name people use for the institute's time zone. */
function zoneName(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? timezone;
  } catch {
    return timezone;
  }
}

function Fact({ icon, label, children }: { icon: Parameters<typeof FactIcon>[0]["name"]; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-3.5">
      <FactIcon name={icon} />
      <div className="min-w-0">
        <dt className="text-[13px] text-muted">{label}</dt>
        <dd className="mt-0.5 text-[15px] leading-snug font-medium">{children}</dd>
      </div>
    </div>
  );
}

/**
 * A live batch's listing: the course and what it covers, when it meets, who teaches it, the
 * seats left and the price, then the institute behind it. Shaped like a ticket, not a book:
 * what you buy is a seat at set times.
 */
export function LiveListing({
  item,
  live,
  canShop,
  signedIn,
  carted,
  face,
  hasSite,
  moreLive,
  moreRecorded,
}: {
  item: ListingDetail;
  live: LiveInfo;
  canShop: boolean;
  signedIn: boolean;
  carted: boolean;
  face: InstituteFace;
  hasSite: boolean;
  moreLive: LiveCatalogItem[];
  moreRecorded: RecordedCatalogItem[];
}) {
  const institutePage = `/marketplace/institutes/${item.instituteSlug}`;
  const full = live.seatsLeft === 0;
  const zone = zoneName(live.timezone);
  const covers = item.course.description.trim();
  const parts = item.outline.sections.filter((s) => s.lessons.length > 0);

  return (
    <>
      <section aria-label={item.title} className="bg-brand-deep pt-6 pb-12 text-canvas sm:pt-8 sm:pb-16">
        <div className={shell}>
          <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap gap-x-2 text-[14px] text-canvas/60">
            <Link href="/marketplace" className="hover:text-canvas">
              Marketplace
            </Link>
            <span aria-hidden>/</span>
            <Link href="/marketplace/live" className="hover:text-canvas">
              Live
            </Link>
            <span aria-hidden>/</span>
            <Link href={institutePage} className="hover:text-canvas">
              {item.institute}
            </Link>
          </nav>

          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_390px] lg:gap-14">
            <div>
              <div className="flex items-center gap-4">
                <DateLeaf live={live} size="lg" />
                <div className="min-w-0 text-[14px] leading-snug">
                  <div className="font-medium text-gold">{FORMAT_LINE.live}</div>
                  <div className="mt-1 text-canvas/75">
                    Live batch from{" "}
                    <Link href={institutePage} className="font-medium text-canvas underline-offset-4 hover:underline">
                      {item.institute}
                    </Link>
                  </div>
                </div>
              </div>
              <h1 className="mt-7 max-w-[18ch] text-[clamp(2.2rem,4.8vw,3.6rem)] leading-[1.04] font-semibold [text-wrap:balance]">{item.title}</h1>
              <p className="mt-3 text-[16px] text-canvas/75">
                {live.batchName} · {formatDate(live.startDate)} to {formatDate(live.endDate)}
              </p>
              {item.description && <p className="mt-5 max-w-2xl text-[16px] leading-relaxed whitespace-pre-line text-canvas/85">{item.description}</p>}
            </div>

            {/* The ticket: price, seats and the way to buy. */}
            <aside aria-label="Buy a seat" className="self-start rounded-[22px] bg-canvas p-6 text-ink shadow-[0_30px_60px_-30px_rgb(0_0_0/0.7)]">
              <div className="flex flex-wrap items-center gap-3">
                <Price pricePaise={item.pricePaise} compareAtPaise={item.compareAtPaise} size="lg" />
                {item.percentOff && item.compareAtPaise && (
                  <span className="rounded-full bg-gold px-3 py-1 text-[13.5px] font-semibold text-brand-deep">
                    Save {inr(item.compareAtPaise - item.pricePaise)}, {item.percentOff}% off
                  </span>
                )}
              </div>
              <p className="mt-2 text-[13.5px] text-muted">For one seat. GST is added at checkout, and a GST invoice comes with your purchase.</p>
              <LiveBadges live={live} className="mt-4" />
              {!full && !fewSeatsLeft(live) && (
                <p className="mt-3 text-[14px] text-ink/80">
                  {seatsLine(live.seatsLeft)} of {live.seatLimit}
                </p>
              )}

              <div className="mt-5 border-t border-dashed border-line pt-5">
                {item.ownedEnrolmentId ? (
                  <div className="space-y-3">
                    <p className="text-[15px] font-medium text-brand">{item.ownedHere ? "You have a seat in this batch." : `You already have this course from ${item.institute}.`}</p>
                    <div className="flex flex-wrap gap-2">
                      {item.ownedHere && <ButtonLink href={`/${item.instituteSlug}/learn/timetable`}>Open my timetable</ButtonLink>}
                      <ButtonLink href={`/${item.instituteSlug}/learn/my/${item.ownedEnrolmentId}`} variant={item.ownedHere ? "secondary" : "primary"}>
                        Open the course
                      </ButtonLink>
                    </div>
                  </div>
                ) : full ? (
                  <div className="space-y-2">
                    <p className="text-[15px] font-medium">Batch full</p>
                    <p className="text-[14px] leading-relaxed text-muted">
                      Every seat is taken or being paid for. A seat comes back if a payment isn&apos;t finished, so look again in a little while, or see what else {item.institute} has open.
                    </p>
                    <Link href={`${institutePage}?tab=live`} className="inline-block pt-1 text-[14px] font-medium text-brand hover:underline">
                      Their other live batches
                    </Link>
                  </div>
                ) : canShop ? (
                  <ActionForm action={buyAction} resetOnSuccess={false} className="space-y-3">
                    <input type="hidden" name="listingId" value={item.id} />
                    <BuyNow label="Buy a seat" />
                    <AddToCart listingId={item.id} inCart={carted} />
                    <CodeField />
                    <p className="text-[13px] leading-relaxed text-muted">Your seat is held for 10 minutes while you pay.</p>
                  </ActionForm>
                ) : signedIn ? (
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
            </aside>
          </div>
        </div>
      </section>

      <div className={cx(shell, "grid gap-12 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_390px] lg:gap-14")}>
        <div className="space-y-12">
          <section aria-labelledby="when">
            <h2 id="when" className="text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">
              When it meets
            </h2>
            <dl className="mt-4 grid border-t border-line sm:grid-cols-2 sm:gap-x-10 [&>div]:border-b [&>div]:border-line">
              <Fact icon="dates" label="Starts">
                {formatDate(live.startDate, { weekday: true })} {live.startDate.slice(0, 4)}
                {live.phase === "running" && <span className="block text-[13.5px] font-normal text-muted">Classes have begun. You can still join.</span>}
              </Fact>
              <Fact icon="dates" label="Ends">
                {formatDate(live.endDate, { weekday: true })} {live.endDate.slice(0, 4)}
              </Fact>
              <Fact icon="time" label="Days and times">
                {live.timings}
                <span className="block text-[13.5px] font-normal text-muted">
                  {zone} ({live.timezone.replace(/_/g, " ")})
                </span>
              </Fact>
              <Fact icon="classes" label="Classes">
                {classesLine(live.classes)}
                {live.phase === "running" && live.classesLeft < live.classes && <span className="block text-[13.5px] font-normal text-muted">{live.classesLeft} still to come</span>}
              </Fact>
              <Fact icon="faculty" label="Faculty">
                {live.faculty.length > 0 ? live.faculty.join(", ") : "To be announced"}
              </Fact>
              <Fact icon="seats" label="Seats">
                {full ? "Batch full" : `${seatsLine(live.seatsLeft)} of ${live.seatLimit}`}
              </Fact>
            </dl>
            {live.nextClass && (
              <p className="mt-4 text-[14px] text-muted">
                {live.phase === "upcoming" ? "First class" : "Next class"}: {formatDate(live.nextClass.date, { weekday: true })}, {formatTime(live.nextClass.startTime)} to{" "}
                {formatTime(live.nextClass.endTime)}.
              </p>
            )}
          </section>

          <section aria-labelledby="covers">
            <h2 id="covers" className="text-[clamp(1.7rem,3.2vw,2.3rem)] leading-tight font-semibold">
              What it covers
            </h2>
            <p className="mt-1 text-[14px] text-muted">{item.course.title}</p>
            {covers ? (
              <p className="mt-4 max-w-2xl text-[16px] leading-relaxed whitespace-pre-line text-ink/85">{covers}</p>
            ) : (
              !item.description && <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">{item.institute} hasn&apos;t written up this course yet. The batch&apos;s dates and class times are above.</p>
            )}
            {parts.length > 0 && (
              <ol className="mt-6 divide-y divide-line border-y border-line">
                {parts.map((s, i) => (
                  <li key={`${s.title}-${i}`} className="flex items-baseline justify-between gap-4 py-3 text-[15px]">
                    <span className="min-w-0 font-medium">{s.title}</span>
                    <span className="tabular shrink-0 text-[13.5px] text-muted">
                      {s.lessons.length} {s.lessons.length === 1 ? "lesson" : "lessons"}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <ul className="mt-6 space-y-1.5 text-[14.5px] text-ink/85">
              <li>Taught live by the institute&apos;s faculty, in class with its own students.</li>
              <li>Your timetable and the link to join each class are in the institute&apos;s learner app after you buy.</li>
            </ul>
          </section>
        </div>

        <aside aria-labelledby="from" className="self-start">
          <h2 id="from" className="mb-4 text-[clamp(1.4rem,2.4vw,1.7rem)] leading-tight font-semibold">
            Taught by
          </h2>
          <InstituteCard face={face} />
          {hasSite && (
            <a href={`/site/${item.instituteSlug}`} className="mt-3 inline-block text-[14px] font-medium text-brand hover:underline">
              Visit their website
            </a>
          )}
        </aside>
      </div>

      {moreLive.length > 0 && (
        <section aria-labelledby="more-live" className={cx(shell, "pt-16")}>
          <SectionHead id="more-live" title={`More live batches from ${item.institute}`} href={`${institutePage}?tab=live`} more="All their live batches" />
          <LiveGrid items={moreLive} showInstitute={false} />
        </section>
      )}
      {moreRecorded.length > 0 && (
        <section aria-labelledby="more-recorded" className={cx(shell, "pt-16")}>
          <SectionHead id="more-recorded" title={`Recorded by ${item.institute}`} href={`${institutePage}?tab=recorded`} more="All their recordings" />
          <BookGrid items={moreRecorded} showInstitute={false} />
        </section>
      )}
    </>
  );
}
