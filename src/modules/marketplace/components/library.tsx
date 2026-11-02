import Link from "next/link";
import { Badge, ButtonLink, Card, CardTitle, cx } from "@/components/ui";
import type { HomeCardProps } from "@/contracts/module";
import { marketplaceAccess, myLibrary, type LibraryItem } from "../service";

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

/** One purchase, with the way back into it. */
export function LibraryCard({ item }: { item: LibraryItem }) {
  return (
    <article className="flex flex-col rounded-[22px] border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] text-muted">{item.institute}</span>
        {item.completed ? <Badge tone="brand">Completed</Badge> : <Badge>{{ course: "Course", lecture: "Lecture", combo: "Combo" }[item.kind]}</Badge>}
      </div>
      <h2 className="mt-3 text-[21px] leading-snug font-medium">
        <Link href={courseHref(item)} className="hover:text-brand">
          {item.title}
        </Link>
      </h2>
      <div className="mt-auto pt-5">
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
  return (
    <Card>
      <CardTitle hint={items.length > 0 ? `${items.length} bought` : undefined}>Marketplace</CardTitle>
      {items.length === 0 ? (
        <p className="text-[14px] text-muted">Recorded courses, lectures and combos from institutes across Zinny. Whatever you buy shows here once your payment is confirmed.</p>
      ) : (
        <ul className="space-y-3.5">
          {items.slice(0, 3).map((item) => (
            <li key={item.orderId}>
              <Link href={courseHref(item)} className={cx("block text-[14px] font-medium hover:text-brand")}>
                {item.title}
              </Link>
              <div className="mb-1.5 text-[13px] text-muted">{item.institute}</div>
              <Progress percent={item.percent} />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {access.canShop && (
          <ButtonLink href="/marketplace" size="sm">
            Browse the marketplace
          </ButtonLink>
        )}
        {items.length > 0 && (
          <ButtonLink href="/marketplace/library" size="sm" variant="secondary">
            What I bought
          </ButtonLink>
        )}
      </div>
    </Card>
  );
}
