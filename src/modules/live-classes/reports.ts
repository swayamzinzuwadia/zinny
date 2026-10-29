/**
 * Report `live-classes.attendance` (PRD page 8: "live class attendance"): one row per
 * student per batch over a date range, for every batch the viewer reaches with
 * `attendance.view`. Filters: date range, department, course, batch.
 */
import { peopleLite, scheduledBatches, withTenant, type Actor } from "@/server/core";
import type { ReportDefinition, ReportParams, ReportResult } from "@/contracts/module";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { clockFor, evaluateBatches, tallyStudents, thresholdFor } from "./engine";
import { batchesInReach, reachesAny } from "./scope";
import { addDays, isIsoDate, isUuid, maxDate, minDate } from "./time";

const MAX_DAYS = 400;

export async function attendanceReport(actor: Actor, params: ReportParams, now = new Date()): Promise<ReportResult> {
  // Scoped viewers (HOD, faculty) see their own scope only: checked with reach().
  if (!reachesAny(actor, "attendance.view")) throw new ForbiddenError();
  for (const k of ["departmentId", "courseId", "batchId"] as const) {
    if (params[k] && !isUuid(params[k]!)) throw new ValidationError("That filter doesn't match anything. Pick it again from the list.");
  }
  if ((params.from && !isIsoDate(params.from)) || (params.to && !isIsoDate(params.to))) throw new ValidationError("Dates must look like 2026-11-07.");
  return withTenant(actor, async (tx) => {
    const clock = await clockFor(tx, now);
    const to = params.to ?? clock.today;
    const from = params.from ?? addDays(to, -29);
    if (from > to) throw new ValidationError("The start date must be on or before the end date.");
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) throw new ValidationError("Pick a range of at most 400 days.");
    const threshold = await thresholdFor(tx);
    const list = await batchesInReach(tx, actor, "attendance.view", {
      departmentId: params.departmentId,
      courseId: params.courseId,
      batchId: params.batchId,
      includeArchived: true,
    });
    const scheds = await scheduledBatches(tx, list.map((b) => b.id));
    const rows: Record<string, unknown>[] = [];
    for (const b of list) {
      const sched = scheds.find((s) => s.batchId === b.id);
      if (!sched) continue;
      const f = maxDate(from, sched.startDate);
      const t = minDate(to, sched.endDate);
      if (f > t) continue;
      const { sessions } = await evaluateBatches(tx, [sched], f, t, clock);
      const counted = sessions.filter((s) => s.counts);
      if (counted.length === 0) continue;
      const tallies = [...tallyStudents(counted).values()].filter((x) => x.held > 0);
      const people = new Map((await peopleLite(tx, tallies.map((x) => x.userId))).map((p) => [p.id, p]));
      for (const x of tallies) {
        const p = people.get(x.userId);
        if (!p) continue;
        const dates = counted.filter((s) => s.entries.some((e) => e.userId === x.userId && e.status)).map((s) => s.date);
        rows.push({
          student: p.name,
          email: p.email,
          department: b.departmentName,
          course: b.courseTitle,
          batch: b.name,
          classes: x.held,
          present: x.present,
          late: x.late,
          absent: x.absent,
          attendance: x.percent,
          belowThreshold: x.percent !== null && x.percent < threshold ? "Yes" : "No",
          firstClass: dates[0] ?? null,
          lastClass: dates[dates.length - 1] ?? null,
        });
      }
    }
    rows.sort(
      (a, b) =>
        String(a.course).localeCompare(String(b.course)) ||
        String(a.batch).localeCompare(String(b.batch)) ||
        String(a.student).localeCompare(String(b.student)),
    );
    return {
      columns: [
        { key: "student", label: "Student", type: "text" },
        { key: "email", label: "Email", type: "text" },
        { key: "department", label: "Department", type: "text" },
        { key: "course", label: "Course", type: "text" },
        { key: "batch", label: "Batch", type: "text" },
        { key: "classes", label: "Classes", type: "number" },
        { key: "present", label: "Present", type: "number" },
        { key: "late", label: "Late", type: "number" },
        { key: "absent", label: "Absent", type: "number" },
        { key: "attendance", label: "Attendance", type: "percent" },
        { key: "belowThreshold", label: `Below ${threshold}%`, type: "text" },
        { key: "firstClass", label: "First class", type: "date" },
        { key: "lastClass", label: "Last class", type: "date" },
      ],
      rows,
    };
  });
}

export const reports: ReportDefinition[] = [
  {
    id: "live-classes.attendance",
    label: "Live class attendance",
    description: "Each student's live class attendance by batch over a date range: classes held, present, late, absent and attendance %.",
    action: "attendance.view",
    filters: ["dateRange", "department", "course", "batch"],
    run: (actor, params) => attendanceReport(actor, params),
  },
];
