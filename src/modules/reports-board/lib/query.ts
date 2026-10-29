/**
 * The Reports page's choice, as it travels in the URL (and in the viewer's browser
 * storage): which report, which date range, which filters, which page. Pure.
 *
 *   ?report=reports-board.enrolments&range=30d&dept=…&course=…&batch=…&page=2
 *   ?report=…&range=custom&from=2026-04-01&to=2026-09-30
 */
import type { ReportFilter, ReportParams } from "@/contracts/module";
import { addDays, addMonths, daysBetween, financialYearStart, isDate, monthEnd, monthStart } from "./dates";

export const RANGE_PRESETS = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "fy", label: "This financial year" },
  { key: "last-fy", label: "Last financial year" },
  { key: "custom", label: "Custom dates" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["key"];
export const DEFAULT_RANGE: RangePreset = "30d";

/** Long ranges are allowed, but not unbounded: five years covers any audit or comparison. */
export const MAX_RANGE_DAYS = 5 * 366;

export type ReportQuery = {
  reportId: string | null;
  range: RangePreset;
  from: string | null;
  to: string | null;
  departmentId: string | null;
  courseId: string | null;
  batchId: string | null;
  page: number;
};

type Raw = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;

export function isRangePreset(v: unknown): v is RangePreset {
  return RANGE_PRESETS.some((p) => p.key === v);
}

/** Reads the URL. Unknown values fall back to defaults; ids are validated later, by the service. */
export function parseQuery(sp: Raw): ReportQuery {
  const range = first(sp.range);
  const from = first(sp.from);
  const to = first(sp.to);
  const page = Number(first(sp.page) ?? "1");
  return {
    reportId: first(sp.report),
    // Dates without a preset mean custom dates (a hand-edited or bookmarked link).
    range: isRangePreset(range) ? range : from || to ? "custom" : DEFAULT_RANGE,
    from,
    to,
    departmentId: first(sp.dept),
    courseId: first(sp.course),
    batchId: first(sp.batch),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** Back to URL parameters, leaving out empty values and the default page. */
export function toSearchParams(q: Partial<ReportQuery>): URLSearchParams {
  const p = new URLSearchParams();
  if (q.reportId) p.set("report", q.reportId);
  if (q.range) p.set("range", q.range);
  if (q.range === "custom") {
    if (q.from) p.set("from", q.from);
    if (q.to) p.set("to", q.to);
  }
  if (q.departmentId) p.set("dept", q.departmentId);
  if (q.courseId) p.set("course", q.courseId);
  if (q.batchId) p.set("batch", q.batchId);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  return p;
}

export type ResolvedRange = { from: string; to: string };

/** The dates a preset covers on `today` (in the university's time zone), both inclusive. */
export function presetRange(preset: Exclude<RangePreset, "custom">, today: string): ResolvedRange {
  switch (preset) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "month":
      return { from: monthStart(today), to: today };
    case "last-month": {
      const start = addMonths(today, -1);
      return { from: start, to: monthEnd(start) };
    }
    case "fy":
      return { from: financialYearStart(today), to: today };
    case "last-fy": {
      const start = financialYearStart(addDays(financialYearStart(today), -1));
      return { from: start, to: addDays(financialYearStart(today), -1) };
    }
  }
}

/** The date range a query asks for, or a message saying what to fix. */
export function resolveRange(q: Pick<ReportQuery, "range" | "from" | "to">, today: string): ResolvedRange | { error: string } {
  if (q.range !== "custom") return presetRange(q.range, today);
  if (!q.from || !q.to) return { error: "Pick both a start date and an end date." };
  if (!isDate(q.from) || !isDate(q.to)) return { error: "Dates must be real calendar dates, like 2026-04-01." };
  if (q.from > q.to) return { error: "The start date is after the end date. Swap them and run the report again." };
  if (daysBetween(q.from, q.to) + 1 > MAX_RANGE_DAYS) return { error: "Pick a date range of five years or less." };
  return { from: q.from, to: q.to };
}

/** Only the filters the report declares are passed to it (contracts.md section 4). */
export function reportParams(filters: readonly ReportFilter[], q: ReportQuery, range: ResolvedRange): ReportParams {
  const params: ReportParams = {};
  if (filters.includes("dateRange")) {
    params.from = range.from;
    params.to = range.to;
  }
  if (filters.includes("department") && q.departmentId) params.departmentId = q.departmentId;
  if (filters.includes("course") && q.courseId) params.courseId = q.courseId;
  if (filters.includes("batch") && q.batchId) params.batchId = q.batchId;
  return params;
}

/** "enrolments-2026-09-30-to-2026-10-29.csv" */
export function downloadName(label: string, range: ResolvedRange | null, ext: "csv" | "xlsx"): string {
  const slug =
    label
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "report";
  return `${slug}${range ? `-${range.from}-to-${range.to}` : ""}.${ext}`;
}
