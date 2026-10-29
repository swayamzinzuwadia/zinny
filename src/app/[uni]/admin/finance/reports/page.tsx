import { Empty, Notice, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { ReportFilters } from "@/modules/reports-board/components/report-filters";
import { ReportPicker } from "@/modules/reports-board/components/report-picker";
import { ReportResults } from "@/modules/reports-board/components/report-results";
import { parseQuery, presetRange } from "@/modules/reports-board/lib/query";
import {
  canOpenReports,
  filterOptions,
  NO_REPORTS_ACCESS,
  reportErrorMessage,
  runnableReports,
  runReport,
  universityToday,
  type FilterOptions,
  type ReportRun,
} from "@/modules/reports-board/service";

export const metadata = { title: "Reports" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ReportsPage({ params, searchParams }: { params: Promise<{ uni: string }>; searchParams: SearchParams }) {
  const { uni } = await params;
  const sp = await searchParams;
  const { actor, university } = await spaceContext(uni);
  const basePath = `/${uni}/admin/finance/reports`;

  if (!canOpenReports(actor)) {
    return (
      <>
        <PageHeader title="Reports" />
        <Empty title="You don't have access to Reports">{NO_REPORTS_ACCESS} Ask your Institute Admin if you need it.</Empty>
      </>
    );
  }

  const reports = runnableReports(actor);
  const query = parseQuery(sp);
  const today = await universityToday(actor);

  const actions = [...new Set(reports.map((r) => r.action))];
  const options: Record<string, FilterOptions> = {};
  for (const a of actions) options[a] = await filterOptions(actor, a);

  let run: ReportRun | null = null;
  let error: string | null = null;
  if (query.reportId) {
    try {
      run = await runReport(actor, query, today);
    } catch (e) {
      error = reportErrorMessage(e);
    }
  }

  const known = !!query.reportId && reports.some((r) => r.id === query.reportId);
  const rangeDates = run?.range ?? (query.range !== "custom" ? presetRange(query.range, today) : null);

  return (
    <>
      <PageHeader title="Reports" subtitle="Choose a report and a date range, then view it here or download it." />

      {sp.failed && (
        <div className="mb-5">
          <Notice tone="danger">The download didn&apos;t work. Try again, or pick a shorter date range.</Notice>
        </div>
      )}

      <ReportFilters
        storageKey={`zinny.reports.${university.id}.${actor.userId}`}
        reports={reports}
        options={options}
        current={{
          reportId: known ? query.reportId : null,
          range: query.range,
          from: query.from,
          to: query.to,
          departmentId: query.departmentId,
          courseId: query.courseId,
          batchId: query.batchId,
        }}
        rangeDates={rangeDates}
      />

      {error && (
        <div className="mt-6">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      {run && <ReportResults run={run} query={query} basePath={basePath} />}

      {!query.reportId && <ReportPicker reports={reports} basePath={basePath} />}
    </>
  );
}
