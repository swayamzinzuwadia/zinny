import Link from "next/link";
import type { ReportColumn } from "@/contracts/module";
import { buttonClass, cx } from "@/components/ui";
import { formatRange } from "../lib/dates";
import { columnTotal, formatCell, formatMoney, formatNumber, isNumericType } from "../lib/format";
import { toSearchParams, type ReportQuery } from "../lib/query";
import type { ReportRun } from "../service";

export const PAGE_SIZE = 50;

/**
 * A report's result: what ran, downloads, the rows one page at a time, and totals for
 * money columns across every row (not just this page).
 */
export function ReportResults({ run, query, basePath }: { run: ReportRun; query: ReportQuery; basePath: string }) {
  const total = run.rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const start = (page - 1) * PAGE_SIZE;
  const rows = run.rows.slice(start, start + PAGE_SIZE);
  const moneyCols = run.columns.filter((c) => c.type === "money");
  const choice = { ...query, page: 1 };
  const download = (format: "csv" | "xlsx") => {
    const p = toSearchParams(choice);
    p.set("format", format);
    return `${basePath}/download?${p.toString()}`;
  };
  const pageHref = (n: number) => `${basePath}?${toSearchParams({ ...query, page: n }).toString()}`;

  return (
    <section aria-labelledby="report-title" className="mt-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="report-title" className="text-[20px] font-semibold">
            {run.report.label}
          </h2>
          <p className="mt-1 text-[14px] text-muted">
            {run.range ? `${formatRange(run.range.from, run.range.to)} · ` : ""}
            {total === 1 ? "1 row" : `${formatNumber(total)} rows`}
          </p>
        </div>
        {total > 0 && (
          <div className="flex gap-2">
            {/* Plain links, never <Link>: a prefetch would run the export. */}
            <a href={download("csv")} className={buttonClass("secondary", "sm")}>
              Download CSV
            </a>
            <a href={download("xlsx")} className={buttonClass("secondary", "sm")}>
              Download XLSX
            </a>
          </div>
        )}
      </div>

      {total === 0 ? (
        <div className="rounded-[22px] border border-dashed border-line px-6 py-10 text-center">
          <p className="font-medium">Nothing in this range</p>
          <p className="mt-1 text-[14px] text-muted">Try a longer date range or fewer filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-[22px] border border-line bg-surface">
            <table className="w-full min-w-[640px] text-left text-[14px]">
              <caption className="sr-only">
                {run.report.label}, rows {start + 1} to {start + rows.length} of {total}
              </caption>
              <thead className="border-b border-line text-[13px] text-muted">
                <tr>
                  {run.columns.map((c) => (
                    <th key={c.key} scope="col" className={cx("whitespace-nowrap px-4 py-3 font-normal", isNumericType(c.type) && "text-right")}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row, i) => (
                  <tr key={start + i}>
                    {run.columns.map((c) => (
                      <Cell key={c.key} column={c} value={row[c.key]} />
                    ))}
                  </tr>
                ))}
              </tbody>
              {moneyCols.length > 0 && (
                <tfoot className="border-t-2 border-line bg-canvas/60 font-medium">
                  <tr>
                    {run.columns.map((c, i) => {
                      if (c.type === "money") {
                        const sum = columnTotal(run.rows, c.key);
                        return (
                          <td key={c.key} className="tabular whitespace-nowrap px-4 py-3 text-right">
                            {sum === null ? "—" : formatMoney(sum)}
                          </td>
                        );
                      }
                      return (
                        <td key={c.key} className="whitespace-nowrap px-4 py-3">
                          {i === 0 ? `Total, all ${formatNumber(total)} rows` : ""}
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {pages > 1 && (
            <nav aria-label="Report pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[14px]">
              <span className="text-muted">
                Showing {formatNumber(start + 1)} to {formatNumber(start + rows.length)} of {formatNumber(total)}
              </span>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className={buttonClass("secondary", "sm")} scroll={false} prefetch={false}>
                    Previous page
                  </Link>
                ) : (
                  <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")} aria-disabled="true">
                    Previous page
                  </span>
                )}
                <span className="px-2 text-muted">
                  Page {page} of {pages}
                </span>
                {page < pages ? (
                  <Link href={pageHref(page + 1)} className={buttonClass("secondary", "sm")} scroll={false} prefetch={false}>
                    Next page
                  </Link>
                ) : (
                  <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")} aria-disabled="true">
                    Next page
                  </span>
                )}
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  );
}

function Cell({ column, value }: { column: ReportColumn; value: unknown }) {
  const text = formatCell(value, column.type);
  const numeric = isNumericType(column.type);
  const negative = numeric && typeof value === "number" && value < 0;
  return (
    <td
      className={cx(
        "px-4 py-3 align-top",
        numeric && "tabular whitespace-nowrap text-right",
        column.type === "date" && "whitespace-nowrap",
        negative && "text-danger",
        text === "—" && "text-faint",
      )}
    >
      {text}
    </td>
  );
}
