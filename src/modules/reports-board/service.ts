/**
 * The Reports page (PRD page 8): one page that runs any registered report. Pick a report
 * and a date range, then view or download.
 *
 * Who gets in: anyone holding finance.view or insights.view somewhere in the university
 * (Institute Admin, Board / Owner, Accounts & Fees, Heads of Department). Faculty and
 * students don't. Which reports they see: those whose own action they hold, checked with
 * reach() so scoped viewers see their scope only. Filter ids that arrive in the URL are
 * checked against that scope here, and each report narrows its rows again itself.
 */
import "server-only";
import { and, asc, eq, inArray, or, type SQL } from "drizzle-orm";
import { batches, courses, departments } from "@/db/schema";
import type { ReportColumn, ReportDefinition, ReportFilter, ReportParams } from "@/contracts/module";
import { audit, reach, todayFor, withTenant, type Action, type Actor } from "@/server/core";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { reports } from "@/server/registry";
import { toCsv } from "./lib/csv";
import { downloadName, reportParams, resolveRange, type ReportQuery, type ResolvedRange } from "./lib/query";
import { toXlsx, XLSX_CONTENT_TYPE } from "./lib/xlsx";
import { batchInReach, checkParams, hasReach, type Reach } from "./scope";

const PAGE_ACTIONS: Action[] = ["finance.view", "insights.view"];

export const NO_REPORTS_ACCESS = "Reports are for Institute Admins, Board / Owner, Accounts & Fees and Heads of Department.";

/** Can this person open the Reports page at all? */
export function canOpenReports(actor: Actor): boolean {
  if (!actor.universityId) return false;
  return PAGE_ACTIONS.some((a) => hasReach(reach(actor, a, actor.universityId!)));
}

export function assertCanOpenReports(actor: Actor): void {
  if (!canOpenReports(actor)) throw new ForbiddenError(NO_REPORTS_ACCESS);
}

/** What the browser needs to know about a report (no `run`). */
export type ReportSummary = { id: string; label: string; description: string; action: Action; filters: ReportFilter[] };

const summary = (r: ReportDefinition): ReportSummary => ({
  id: r.id,
  label: r.label,
  description: r.description,
  action: r.action,
  filters: [...r.filters],
});

function reachFor(actor: Actor, action: Action): Reach {
  return reach(actor, action, actor.universityId!);
}

/** Every registered report this person may run, by label. */
export function runnableReports(actor: Actor): ReportSummary[] {
  assertCanOpenReports(actor);
  return reports()
    .filter((r) => hasReach(reachFor(actor, r.action)))
    .map(summary);
}

/* ───────────────────────────── Filter choices ───────────────────────────── */

export type FilterOptions = {
  departments: { id: string; name: string }[];
  courses: { id: string; title: string; departmentId: string }[];
  batches: { id: string; name: string; courseId: string; departmentId: string; startDate: string }[];
};

/** Departments, courses and batches the person may filter on for a report with this action. */
export async function filterOptions(actor: Actor, action: Action): Promise<FilterOptions> {
  assertCanOpenReports(actor);
  const r = reachFor(actor, action);
  if (!hasReach(r)) return { departments: [], courses: [], batches: [] };
  return withTenant(actor, async (tx) => {
    const batchRows = await tx
      .select({ id: batches.id, name: batches.name, courseId: batches.courseId, departmentId: batches.departmentId, startDate: batches.startDate })
      .from(batches)
      .where(batchInReach(r, batches.id, batches.departmentId))
      .orderBy(asc(batches.startDate), asc(batches.name));
    const courseIds = [...new Set(batchRows.map((b) => b.courseId))];
    const deptIds = [...new Set([...r.departmentIds, ...batchRows.map((b) => b.departmentId)])];

    // Whole departments, plus the courses of batches the person reaches one by one.
    const courseConds: SQL[] = [];
    if (r.departmentIds.size) courseConds.push(inArray(courses.departmentId, [...r.departmentIds]));
    if (courseIds.length) courseConds.push(inArray(courses.id, courseIds));
    const courseRows =
      r.all || courseConds.length
        ? await tx
            .select({ id: courses.id, title: courses.title, departmentId: courses.departmentId })
            .from(courses)
            .where(r.all ? undefined : or(...courseConds))
            .orderBy(asc(courses.title))
        : [];
    const deptRows =
      r.all || deptIds.length
        ? await tx
            .select({ id: departments.id, name: departments.name })
            .from(departments)
            .where(r.all ? undefined : inArray(departments.id, deptIds))
            .orderBy(asc(departments.name))
        : [];
    return { departments: deptRows, courses: courseRows, batches: batchRows };
  });
}

/** A department, course or batch from the URL must sit inside the person's reach for this report. */
async function assertFiltersInReach(actor: Actor, r: Reach, params: ReportParams): Promise<void> {
  if (r.all) return;
  const refuse = () => {
    throw new ForbiddenError("That filter is outside what you can see. Pick one from the list.");
  };
  if (params.departmentId && !r.departmentIds.has(params.departmentId)) {
    // Faculty-style reach (own batches only) may still filter on those batches' department.
    if (r.batchIds.size === 0) refuse();
  }
  if (!params.departmentId && !params.courseId && !params.batchId) return;
  await withTenant(actor, async (tx) => {
    if (params.departmentId && !r.departmentIds.has(params.departmentId)) {
      const own = await tx
        .select({ id: batches.id })
        .from(batches)
        .where(and(eq(batches.departmentId, params.departmentId), inArray(batches.id, [...r.batchIds])))
        .limit(1);
      if (own.length === 0) refuse();
    }
    if (params.courseId) {
      const [c] = await tx.select({ departmentId: courses.departmentId }).from(courses).where(eq(courses.id, params.courseId));
      if (!c) refuse();
      if (!r.departmentIds.has(c.departmentId)) {
        const own = r.batchIds.size
          ? await tx
              .select({ id: batches.id })
              .from(batches)
              .where(and(eq(batches.courseId, params.courseId!), inArray(batches.id, [...r.batchIds])))
              .limit(1)
          : [];
        if (own.length === 0) refuse();
      }
    }
    if (params.batchId) {
      const [b] = await tx.select({ id: batches.id, departmentId: batches.departmentId }).from(batches).where(eq(batches.id, params.batchId));
      if (!b || !(r.departmentIds.has(b.departmentId) || r.batchIds.has(b.id))) refuse();
    }
  });
}

/* ───────────────────────────── Running ───────────────────────────── */

const COLUMN_TYPES = new Set<ReportColumn["type"]>(["text", "number", "money", "date", "percent"]);

/** Another module's report returned something that isn't a report: say so instead of rendering garbage. */
function checkResult(id: string, out: unknown): { columns: ReportColumn[]; rows: Record<string, unknown>[] } {
  const res = out as { columns?: unknown; rows?: unknown } | null;
  const columnsOk =
    Array.isArray(res?.columns) &&
    res.columns.every(
      (c: unknown) =>
        !!c &&
        typeof (c as ReportColumn).key === "string" &&
        typeof (c as ReportColumn).label === "string" &&
        COLUMN_TYPES.has((c as ReportColumn).type),
    );
  const rowsOk = Array.isArray(res?.rows) && res.rows.every((r: unknown) => !!r && typeof r === "object");
  if (!columnsOk || !rowsOk) {
    console.error(`Report ${id} returned an invalid result.`);
    throw new ReportFailed();
  }
  return { columns: res!.columns as ReportColumn[], rows: res!.rows as Record<string, unknown>[] };
}

/** A report's own code failed for a reason the viewer can't fix. */
export class ReportFailed extends Error {
  constructor() {
    super("This report couldn't run. Try again, or pick a shorter date range. If it keeps failing, tell your Zinny contact.");
    this.name = "ReportFailed";
  }
}

/** The message to show for anything runReport throws. */
export function reportErrorMessage(e: unknown): string {
  if (e instanceof AppError || e instanceof ReportFailed) return e.message;
  return new ReportFailed().message;
}

export type ReportRun = {
  report: ReportSummary;
  range: ResolvedRange | null;
  params: ReportParams;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
};

/** Today in the university's time zone (date-range presets are relative to it). */
export async function universityToday(actor: Actor): Promise<string> {
  return withTenant(actor, (tx) => todayFor(tx));
}

/**
 * Runs one registered report for this person with the choice from the URL. Checks the page,
 * the report's own action and the filters' scope, resolves the date range, then calls the
 * report with only the filters it declares.
 */
export async function runReport(actor: Actor, query: ReportQuery, today?: string): Promise<ReportRun> {
  assertCanOpenReports(actor);
  const def = reports().find((r) => r.id === query.reportId);
  if (!def) throw new NotFoundError("Report");
  const r = reachFor(actor, def.action);
  if (!hasReach(r)) throw new ForbiddenError("You don't have access to this report.");

  const usesDates = def.filters.includes("dateRange");
  let range: ResolvedRange | null = null;
  if (usesDates) {
    const resolved = resolveRange(query, today ?? (await universityToday(actor)));
    if ("error" in resolved) throw new ValidationError(resolved.error, "bad_range");
    range = resolved;
  }
  const params = reportParams(def.filters, query, range ?? { from: "", to: "" });
  checkParams(params);
  await assertFiltersInReach(actor, r, params);

  let out: unknown;
  try {
    out = await def.run(actor, params);
  } catch (e) {
    if (e instanceof AppError) throw e;
    console.error(`Report ${def.id} failed`, e);
    throw new ReportFailed();
  }
  const { columns, rows } = checkResult(def.id, out);
  return { report: summary(def), range, params, columns, rows };
}

export type ReportFile = { filename: string; contentType: string; body: string | Uint8Array; rows: number };

/** Runs the report and builds the download. Every export is written to the audit log: reports carry personal data. */
export async function exportReport(actor: Actor, query: ReportQuery, format: "csv" | "xlsx"): Promise<ReportFile> {
  const run = await runReport(actor, query);
  const file: ReportFile =
    format === "csv"
      ? {
          filename: downloadName(run.report.label, run.range, "csv"),
          contentType: "text/csv; charset=utf-8",
          body: toCsv(run.columns, run.rows),
          rows: run.rows.length,
        }
      : {
          filename: downloadName(run.report.label, run.range, "xlsx"),
          contentType: XLSX_CONTENT_TYPE,
          body: toXlsx(run.report.label, run.columns, run.rows),
          rows: run.rows.length,
        };
  await withTenant(actor, (tx) =>
    audit(tx, actor, "report.exported", "report", run.report.id, { format, params: run.params, rows: run.rows.length }),
  );
  return file;
}
