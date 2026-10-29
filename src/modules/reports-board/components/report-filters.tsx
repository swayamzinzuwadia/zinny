"use client";

/**
 * The Reports page's controls: report type, date range and whichever filters the chosen
 * report declares. Departments narrow the courses, and courses narrow the batches.
 *
 * The viewer's last choice is kept in this browser (per university and person) and
 * restored when they come back to the page without a choice in the URL. Storage can be
 * missing or blocked (private windows, strict settings), so every access is guarded and
 * the page works the same without it.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Field, Input, Select, buttonClass } from "@/components/ui";
import type { FilterOptions, ReportSummary } from "../service";
import { RANGE_PRESETS, isRangePreset, toSearchParams, type RangePreset, type ReportQuery } from "../lib/query";

type Choice = Omit<ReportQuery, "page">;

function readChoice(key: string): Choice | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Choice>;
    if (typeof v?.reportId !== "string" || !isRangePreset(v.range)) return null;
    const str = (x: unknown) => (typeof x === "string" && x ? x : null);
    return {
      reportId: v.reportId,
      range: v.range,
      from: str(v.from),
      to: str(v.to),
      departmentId: str(v.departmentId),
      courseId: str(v.courseId),
      batchId: str(v.batchId),
    };
  } catch {
    return null;
  }
}

function saveChoice(key: string, choice: Choice) {
  try {
    window.localStorage.setItem(key, JSON.stringify(choice));
  } catch {
    // Storage is full or blocked: the page still works, it just won't remember.
  }
}

export function ReportFilters({
  storageKey,
  reports,
  options,
  current,
  rangeDates,
}: {
  /** Per university and person, so two people sharing a computer don't see each other's choice. */
  storageKey: string;
  reports: ReportSummary[];
  /** Filter choices per report action. */
  options: Record<string, FilterOptions>;
  /** What the URL asked for (reportId null when nothing is chosen). */
  current: Choice;
  /** The dates the current range covers, to start custom dates from. */
  rangeDates: { from: string; to: string } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [reportId, setReportId] = useState(current.reportId ?? "");
  const [range, setRange] = useState<RangePreset>(current.range);
  const [from, setFrom] = useState(current.from ?? rangeDates?.from ?? "");
  const [to, setTo] = useState(current.to ?? rangeDates?.to ?? "");
  const [departmentId, setDepartmentId] = useState(current.departmentId ?? "");
  const [courseId, setCourseId] = useState(current.courseId ?? "");
  const [batchId, setBatchId] = useState(current.batchId ?? "");

  // Keep the form in step when the URL changes (back button, restored choice).
  useEffect(() => {
    setReportId(current.reportId ?? "");
    setRange(current.range);
    setFrom(current.from ?? rangeDates?.from ?? "");
    setTo(current.to ?? rangeDates?.to ?? "");
    setDepartmentId(current.departmentId ?? "");
    setCourseId(current.courseId ?? "");
    setBatchId(current.batchId ?? "");
  }, [current.reportId, current.range, current.from, current.to, current.departmentId, current.courseId, current.batchId, rangeDates?.from, rangeDates?.to]);

  // Remember a choice the page actually ran; restore it when the URL has none.
  useEffect(() => {
    if (current.reportId) {
      if (reports.some((r) => r.id === current.reportId)) saveChoice(storageKey, current);
      return;
    }
    const saved = readChoice(storageKey);
    if (saved && reports.some((r) => r.id === saved.reportId)) {
      router.replace(`${pathname}?${toSearchParams(saved).toString()}`);
    }
    // Only when the URL's choice changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.reportId, current.range, current.from, current.to, current.departmentId, current.courseId, current.batchId]);

  const report = reports.find((r) => r.id === reportId);
  const opts = (report && options[report.action]) || { departments: [], courses: [], batches: [] };
  const uses = (f: ReportSummary["filters"][number]) => !!report?.filters.includes(f);

  const courses = useMemo(
    () => opts.courses.filter((c) => !departmentId || !uses("department") || c.departmentId === departmentId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts, departmentId, reportId],
  );
  const batches = useMemo(
    () =>
      opts.batches.filter(
        (b) =>
          (!courseId || !uses("course") || b.courseId === courseId) &&
          (!departmentId || !uses("department") || b.departmentId === departmentId),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts, courseId, departmentId, reportId],
  );
  const courseTitle = new Map(opts.courses.map((c) => [c.id, c.title]));

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!report) return;
    const q = toSearchParams({
      reportId: report.id,
      range: uses("dateRange") ? range : undefined,
      from: range === "custom" ? from : null,
      to: range === "custom" ? to : null,
      departmentId: uses("department") ? departmentId || null : null,
      courseId: uses("course") ? courseId || null : null,
      batchId: uses("batch") ? batchId || null : null,
    });
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <form method="get" onSubmit={submit} className="rounded-[22px] border border-line bg-surface p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Report">
          <Select
            name="report"
            value={reportId}
            required
            onChange={(e) => {
              setReportId(e.target.value);
            }}
          >
            {!reportId && (
              <option value="" disabled>
                Choose a report
              </option>
            )}
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        {(!report || uses("dateRange")) && (
          <Field label="Date range">
            <Select name="range" value={range} onChange={(e) => setRange(e.target.value as RangePreset)}>
              {RANGE_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {(!report || uses("dateRange")) && range === "custom" && (
          <div className="grid grid-cols-2 gap-3 md:col-span-2 xl:col-span-2">
            <Field label="From">
              <Input type="date" name="from" value={from} max={to || undefined} required onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" name="to" value={to} min={from || undefined} required onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
        )}

        {uses("department") && (
          <Field label="Department">
            <Select
              name="dept"
              value={departmentId}
              onChange={(e) => {
                const d = e.target.value;
                setDepartmentId(d);
                if (d && opts.courses.find((c) => c.id === courseId)?.departmentId !== d) setCourseId("");
                if (d && opts.batches.find((b) => b.id === batchId)?.departmentId !== d) setBatchId("");
              }}
            >
              <option value="">{opts.departments.length > 1 ? "All departments" : "All in your scope"}</option>
              {opts.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {uses("course") && (
          <Field label="Course">
            <Select
              name="course"
              value={courseId}
              onChange={(e) => {
                const c = e.target.value;
                setCourseId(c);
                if (c && opts.batches.find((b) => b.id === batchId)?.courseId !== c) setBatchId("");
              }}
            >
              <option value="">All courses</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {uses("batch") && (
          <Field label="Batch">
            <Select name="batch" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">All batches</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {courseId && uses("course") ? b.name : `${courseTitle.get(b.courseId) ?? "Course"} · ${b.name}`}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">{report ? report.description : "Pick a report to see its filters."}</p>
        <button type="submit" className={buttonClass("primary")} disabled={!report}>
          Run report
        </button>
      </div>
    </form>
  );
}
