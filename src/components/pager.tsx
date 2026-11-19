import Link from "next/link";
import { buttonClass, cx } from "./ui";

/** One page of a list already in memory. `page` is 1-based and kept within the pages there are. */
export function pageOf<T>(items: T[], page: number | string | undefined, size: number) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const n = Number(page);
  const current = Number.isInteger(n) && n >= 1 ? Math.min(n, pages) : 1;
  return { rows: items.slice((current - 1) * size, current * size), page: current, pages, from: (current - 1) * size + 1, to: Math.min(current * size, items.length), total: items.length };
}

/** Previous and next page under a long list. Shows nothing when everything fits on one page. */
export function Pager({ page, pages, from, to, total, hrefFor, noun = "people" }: { page: number; pages: number; from: number; to: number; total: number; hrefFor: (page: number) => string; noun?: string }) {
  if (pages <= 1) return null;
  const step = (n: number, label: string, enabled: boolean) =>
    enabled ? (
      <Link href={hrefFor(n)} className={buttonClass("secondary", "sm")}>
        {label}
      </Link>
    ) : (
      <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")} aria-disabled="true">
        {label}
      </span>
    );
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
      <span className="tabular">
        {from} to {to} of {total} {noun}
      </span>
      <span className="flex items-center gap-2">
        {step(page - 1, "Previous page", page > 1)}
        <span className="px-1 tabular">
          Page {page} of {pages}
        </span>
        {step(page + 1, "Next page", page < pages)}
      </span>
    </nav>
  );
}
