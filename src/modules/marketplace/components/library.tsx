import Link from "next/link";
import { Badge, ButtonLink, Card, CardTitle, buttonClass } from "@/components/ui";
import type { HomeCardProps } from "@/contracts/module";
import { daysBetween, formatDate, formatTime } from "@/server/lib/dates";
import { joinPath } from "@/server/lib/links";
import { marketplaceAccess, myLibrary, type LibraryItem } from "../service";
import { Jacket } from "./jacket";
import { DateLeaf, FactIcon, datesLine } from "./live";
import { FORMAT_LINE } from "./price";

const bought = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

function courseHref(item: LibraryItem) {
  return `/${item.instituteSlug}/learn/my/${item.enrolmentId}`;
}

function Progress({ percent }: { percent: number }) {
  return (
    <div role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progress" className="h-1.5 overflow-hidden rounded-full bg-line">
      <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** "Today, 6 pm", "Tomorrow, 9 am" or "Mon 13 Jan, 9 am". */
function nextClassLine(live: NonNullable<LibraryItem["live"]>) {
  const next = live.nextClass;
  if (!next) return null;
  const day = next.date === live.today ? "Today" : daysBetween(live.today, next.date) === 1 ? "Tomorrow" : formatDate(next.date, { weekday: true });
  return `${day}, ${formatTime(next.startTime)} to ${formatTime(next.endTime)}`;
}

/**
 * A seat in a live batch, on the learner's shelf: when it meets, the next class and the way
 * into it. Join opens 15 minutes before a class; until then the button leads to the timetable.
 */
export function LiveLibraryCard({ item }: { item: LibraryItem & { live: NonNullable<LibraryItem["live"]> } }) {
  const live = item.live;
  const next = nextClassLine(live);
  const timetable = `/${item.instituteSlug}/learn/timetable`;
  const over = !live.nextClass && live.endDate < live.today;
  return (
    <article className="flex flex-col overflow-hidden rounded-[18px] bg-surface ring-1 ring-line">
      <div className="flex gap-4 p-5 pb-0">
        <DateLeaf live={{ startDate: live.startDate, phase: live.startDate > live.today ? "upcoming" : "running" }} />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-brand">{FORMAT_LINE.live}</div>
          <h3 className="mt-1 line-clamp-2 text-[17px] leading-snug font-medium">
            <Link href={courseHref(item)} className="hover:text-brand">
              {item.title}
            </Link>
          </h3>
          <p className="mt-0.5 truncate text-[13px] text-muted">
            {live.batchName} · {item.institute}
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-1.5 px-5 text-[13.5px] text-ink/85">
        <span className="flex gap-2">
          <FactIcon name="dates" />
          {datesLine(live)}
        </span>
        <span className="flex gap-2">
          <FactIcon name="time" />
          {live.timings}
        </span>
      </div>
      <div className="mx-5 mt-4 rounded-[12px] bg-canvas px-4 py-3">
        <div className="text-[12.5px] text-muted">{item.completed || over ? "This batch has finished" : live.joinOpen ? "Class is on now" : "Next class"}</div>
        <div className="mt-0.5 text-[15px] font-medium">{item.completed || over ? `Ended ${formatDate(live.endDate)}` : (next ?? "No more classes are planned")}</div>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 p-5">
        {live.joinOpen && live.nextClass ? (
          // A plain link, never prefetched: the join route records attendance, then redirects to the meeting.
          <a href={joinPath(item.instituteSlug, live.batchId, live.nextClass.date, live.nextClass.startTime)} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
            Join class
          </a>
        ) : (
          <ButtonLink href={timetable} size="sm">
            Open my timetable
          </ButtonLink>
        )}
        <ButtonLink href={courseHref(item)} size="sm" variant="secondary">
          Open the course
        </ButtonLink>
        {item.invoiceId && (
          <a href={`/${item.instituteSlug}/learn/invoices/${item.invoiceId}`} className="px-2 text-[13px] text-brand hover:underline">
            Download invoice
          </a>
        )}
      </div>
      <p className="border-t border-dashed border-line px-5 py-3 text-[12.5px] text-muted">Bought {bought.format(item.boughtAt)}</p>
    </article>
  );
}

/** One book on the learner's shelf, with how far they've got and the way back into it. */
export function LibraryCard({ item }: { item: LibraryItem }) {
  return (
    <article className="flex flex-col">
      <Link href={courseHref(item)} className="group block rounded-[10px] outline-offset-4">
        <Jacket
          item={{ id: item.listingId, kind: item.kind, title: item.title, institute: item.institute, lessons: item.lessons, percentOff: null }}
          className="transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1.5"
        />
      </Link>
      <div className="mt-4 flex items-start justify-between gap-3">
        <h3 className="line-clamp-2 text-[15px] leading-snug font-medium">
          <Link href={courseHref(item)} className="hover:text-brand">
            {item.title}
          </Link>
        </h3>
        {item.completed && <Badge tone="brand">Completed</Badge>}
      </div>
      <div className="mt-auto pt-3">
        <Progress percent={item.percent} />
        <p className="mt-2 text-[13px] text-muted">
          {item.percent}% watched · Bought {bought.format(item.boughtAt)}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ButtonLink href={courseHref(item)} size="sm">
            {item.percent > 0 ? "Continue" : "Start watching"}
          </ButtonLink>
          {item.invoiceId && (
            <a href={`/${item.instituteSlug}/learn/invoices/${item.invoiceId}`} className="px-2 text-[13px] text-brand hover:underline">
              Download invoice
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

/** Learner home: the way into the marketplace, and what this learner already bought there. */
export async function LibraryHomeCard({ actor }: HomeCardProps) {
  const [items, access] = await Promise.all([myLibrary(actor.userId), marketplaceAccess(actor.userId)]);
  if (items.length === 0 && !access.canShop) return null;
  if (items.length === 0) {
    // Nothing bought yet: one quiet way in, not a card of its own.
    return (
      <Link href="/marketplace" className="group flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4 [transition-property:border-color] duration-150 hover:border-brand/40">
        <span className="min-w-0">
          <span className="block text-[14px] font-medium group-hover:text-brand">Browse the marketplace</span>
          <span className="block text-[13px] text-muted">Courses from other institutes on Zinny</span>
        </span>
        <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </Link>
    );
  }
  return (
    <Card className="p-5">
      <CardTitle
        hint={
          <Link href="/marketplace/library" className="inline-block py-1 font-medium text-brand hover:underline">
            What I bought
          </Link>
        }
      >
        Marketplace
      </CardTitle>
      <ul className="-my-3 divide-y divide-line">
        {items.slice(0, 3).map((item) => (
          <li key={item.orderId}>
            <Link href={courseHref(item)} className="group flex items-baseline justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium group-hover:text-brand">{item.title}</span>
                <span className="block truncate text-[13px] text-muted">
                  {item.live ? (nextClassLine(item.live) ? `Next class: ${nextClassLine(item.live)}` : item.live.timings) : item.institute}
                </span>
              </span>
              {!item.live && <span className="tabular shrink-0 text-[13px] text-muted">{item.percent}%</span>}
            </Link>
          </li>
        ))}
      </ul>
      {access.canShop && (
        <Link href="/marketplace" className="mt-4 inline-block py-1 text-[13px] font-medium text-brand hover:underline">
          Browse the marketplace
        </Link>
      )}
    </Card>
  );
}
