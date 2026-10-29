import Link from "next/link";
import { Empty } from "@/components/ui";
import { toSearchParams, DEFAULT_RANGE } from "../lib/query";
import type { ReportSummary } from "../service";

/** Shown before a report is chosen: every report this person may run, one click to run it. */
export function ReportPicker({ reports, basePath }: { reports: ReportSummary[]; basePath: string }) {
  if (reports.length === 0) {
    return (
      <div className="mt-8">
        <Empty title="No reports for you yet">Reports appear here when you have access to the data they cover.</Empty>
      </div>
    );
  }
  return (
    <section aria-labelledby="all-reports" className="mt-8">
      <h2 id="all-reports" className="mb-4 text-[17px] font-medium">
        Your reports
      </h2>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {reports.map((r) => (
          <li key={r.id}>
            <Link
              href={`${basePath}?${toSearchParams({ reportId: r.id, range: r.filters.includes("dateRange") ? DEFAULT_RANGE : undefined }).toString()}`}
              prefetch={false}
              className="group flex h-full flex-col rounded-[22px] border border-line bg-surface p-5 transition-colors hover:border-brand/40"
            >
              <span className="text-[16px] font-medium group-hover:text-brand">{r.label}</span>
              <span className="mt-1.5 flex-1 text-[14px] text-muted">{r.description}</span>
              <span className="mt-4 text-[13px] font-medium text-brand">Run for the last 30 days</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
