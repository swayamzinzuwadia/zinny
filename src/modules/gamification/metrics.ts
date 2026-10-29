/**
 * What badges and challenges measure, computed from gam_xp_ledger and gam_activity.
 * Runs inside a tenant transaction; callers check permissions.
 *
 * Counting rules (so nothing can be farmed):
 *   - each lesson, test, assignment or course counts once, however many events arrived;
 *   - a test counts as passed from its first passing attempt;
 *   - a class counts by its latest mark (a correction to absent takes it back).
 */
import { and, asc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { gamActivity, gamXpLedger, type ActivityKind, type Metric } from "./schema";
import { longestAttendanceStreak } from "./util";

export type MetricScope = {
  userIds?: readonly string[];
  /** Only activity in this department's courses. */
  departmentId?: string | null;
  courseId?: string | null;
  batchId?: string | null;
  /** Inclusive "YYYY-MM-DD" window on the day the activity counts for. */
  from?: string | null;
  to?: string | null;
};

type Contribution = { userId: string; at: Date; amount: number };

const COUNTED: Partial<Record<Metric, { kind: ActivityKind; extra?: SQL }>> = {
  lessons_completed: { kind: "lesson" },
  tests_passed: { kind: "test", extra: sql`${gamActivity.passed} = true` },
  assignments_on_time: { kind: "assignment_submitted", extra: sql`${gamActivity.late} = false` },
  courses_completed: { kind: "course_completed" },
};

function activityFilters(scope: MetricScope): SQL[] {
  const f: SQL[] = [];
  if (scope.userIds) f.push(inArray(gamActivity.userId, [...scope.userIds]));
  if (scope.departmentId) f.push(eq(gamActivity.departmentId, scope.departmentId));
  if (scope.courseId) f.push(eq(gamActivity.courseId, scope.courseId));
  if (scope.batchId) f.push(eq(gamActivity.batchId, scope.batchId));
  if (scope.from) f.push(gte(gamActivity.activityDate, scope.from));
  if (scope.to) f.push(lte(gamActivity.activityDate, scope.to));
  return f;
}

function ledgerFilters(scope: MetricScope): SQL[] {
  const f: SQL[] = [];
  if (scope.userIds) f.push(inArray(gamXpLedger.userId, [...scope.userIds]));
  if (scope.departmentId) f.push(eq(gamXpLedger.departmentId, scope.departmentId));
  if (scope.courseId) f.push(eq(gamXpLedger.courseId, scope.courseId));
  if (scope.batchId) f.push(eq(gamXpLedger.batchId, scope.batchId));
  if (scope.from) f.push(gte(gamXpLedger.awardDate, scope.from));
  if (scope.to) f.push(lte(gamXpLedger.awardDate, scope.to));
  return f;
}

/** Latest mark of each class session per student, in scope. */
async function latestMarks(tx: Tx, scope: MetricScope) {
  const rows = await tx
    .selectDistinctOn([gamActivity.userId, gamActivity.subjectKey], {
      userId: gamActivity.userId,
      date: gamActivity.activityDate,
      status: gamActivity.status,
      occurredAt: gamActivity.occurredAt,
    })
    .from(gamActivity)
    .where(and(eq(gamActivity.kind, "class"), ...activityFilters(scope)))
    .orderBy(gamActivity.userId, gamActivity.subjectKey, sql`${gamActivity.occurredAt} desc`, sql`${gamActivity.id} desc`);
  return rows.map((r) => ({ ...r, status: r.status ?? "absent" }));
}

/** Every contribution to a metric in scope, oldest first. */
async function contributions(tx: Tx, metric: Exclude<Metric, "attendance_streak_weeks">, scope: MetricScope): Promise<Contribution[]> {
  if (scope.userIds && scope.userIds.length === 0) return [];
  let rows: Contribution[];
  if (metric === "xp") {
    rows = await tx
      .select({ userId: gamXpLedger.userId, at: gamXpLedger.occurredAt, amount: gamXpLedger.points })
      .from(gamXpLedger)
      .where(and(...ledgerFilters(scope)))
      .orderBy(asc(gamXpLedger.occurredAt), asc(gamXpLedger.id));
  } else if (metric === "classes_attended") {
    rows = (await latestMarks(tx, scope))
      .filter((m) => m.status === "present" || m.status === "late")
      .map((m) => ({ userId: m.userId, at: m.occurredAt, amount: 1 }));
  } else {
    const spec = COUNTED[metric]!;
    const first = sql<Date>`min(${gamActivity.occurredAt})`.mapWith(gamActivity.occurredAt);
    rows = (
      await tx
        .select({ userId: gamActivity.userId, subject: gamActivity.subjectKey, at: first })
        .from(gamActivity)
        .where(and(eq(gamActivity.kind, spec.kind), spec.extra, ...activityFilters(scope)))
        .groupBy(gamActivity.userId, gamActivity.subjectKey)
    ).map((r) => ({ userId: r.userId, at: r.at, amount: 1 }));
  }
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The metric's value per student, for everyone with any activity in scope. */
export async function metricValues(tx: Tx, metric: Metric, scope: MetricScope): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (metric === "attendance_streak_weeks") {
    const byUser = new Map<string, { date: string; status: string }[]>();
    for (const m of await latestMarks(tx, scope)) byUser.set(m.userId, [...(byUser.get(m.userId) ?? []), m]);
    for (const [u, marks] of byUser) out.set(u, longestAttendanceStreak(marks));
    return out;
  }
  for (const c of await contributions(tx, metric, scope)) out.set(c.userId, (out.get(c.userId) ?? 0) + c.amount);
  return out;
}

export async function metricValueFor(tx: Tx, metric: Metric, userId: string, scope: Omit<MetricScope, "userIds"> = {}): Promise<number> {
  return (await metricValues(tx, metric, { ...scope, userIds: [userId] })).get(userId) ?? 0;
}

export type Progress = { value: number; reachedAt: Date | null };

/**
 * Value per student plus the moment each one reached `target` (null if not yet),
 * for challenges: winners are listed in the order they got there.
 */
export async function metricProgress(
  tx: Tx,
  metric: Exclude<Metric, "attendance_streak_weeks">,
  scope: MetricScope,
  target: number,
): Promise<Map<string, Progress>> {
  const out = new Map<string, Progress>();
  for (const c of await contributions(tx, metric, scope)) {
    const p = out.get(c.userId) ?? { value: 0, reachedAt: null };
    p.value += c.amount;
    if (p.reachedAt === null && p.value >= target) p.reachedAt = c.at;
    out.set(c.userId, p);
  }
  return out;
}
