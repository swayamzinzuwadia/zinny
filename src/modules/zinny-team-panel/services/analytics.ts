/**
 * Analytics (platform.view_analytics): universities, active students, enrolments per
 * week and money collected by universities per month, overall and per university.
 * Students hold an active student role (the number the licence counts); active students
 * are those of them with an active enrolment.
 * Weeks start on Monday and months follow India time, so every university is counted
 * on the same calendar.
 */
import { and, asc, count, eq, gte, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { enrolments, orders, roleAssignments, universities } from "@/db/schema";
import { bucketLabel, bucketsFor, granularityFor, type DateRange, type Granularity } from "@/components/date-range";
import { platLicences } from "../schema";
import { assertPlatform, type Actor } from "@/server/core";
import { addDays, addMonths, monthOf, todayIST, weekStart, ZINNY_TZ } from "../lib/format";
import { db, emptyUsage, isUuid, usageFor } from "./shared";

/** Orders whose money reached the university (before any refund). */
const COLLECTED = ["paid", "refund_due", "refunded"] as const;

const istStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

export type Analytics = {
  universityId: string | null;
  universities: { total: number; active: number; suspended: number };
  students: number;
  activeStudents: number;
  weeks: { week: string; enrolments: number }[];
  months: { month: string; paise: number; payments: number }[];
  perUniversity: {
    id: string;
    name: string;
    status: string;
    students: number;
    activeStudents: number;
    enrolments12w: number;
    collectedMonth: number;
    collected12m: number;
  }[];
};

/**
 * The numbers for the analytics page. With `universityId`, everything is narrowed to that
 * university; the per-university table always lists every university.
 */
export async function analytics(actor: Actor, opts: { universityId?: string; weeks?: number; months?: number } = {}, today = todayIST()): Promise<Analytics> {
  assertPlatform(actor, "platform.view_analytics");
  const conn = db();
  const uni = opts.universityId && isUuid(opts.universityId) ? opts.universityId : null;
  const nWeeks = Math.min(Math.max(opts.weeks ?? 12, 4), 52);
  const nMonths = Math.min(Math.max(opts.months ?? 12, 3), 24);
  const firstWeek = addDays(weekStart(today), -7 * (nWeeks - 1));
  const firstMonth = `${monthOf(addMonths(`${monthOf(today)}-01`, -(nMonths - 1)))}-01`;
  const thisMonth = `${monthOf(today)}-01`;

  const [unis, usage, active, weekly, monthly] = await Promise.all([
    conn.select({ id: universities.id, name: universities.name, status: universities.status }).from(universities).orderBy(asc(universities.name)),
    usageFor(conn),
    // Active students are students (as counted against the licence) with an active enrolment,
    // so there are never more active students than students.
    conn
      .select({ universityId: enrolments.universityId, n: sql<number>`count(distinct ${enrolments.userId})`.mapWith(Number) })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.status, "active"),
          sql`exists (select 1 from ${roleAssignments} r
            where r.user_id = ${enrolments.userId} and r.university_id = ${enrolments.universityId} and r.role = 'student'
              and r.revoked_at is null and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now()))`,
        ),
      )
      .groupBy(enrolments.universityId),
    conn
      .select({
        universityId: enrolments.universityId,
        week: sql<string>`to_char(date_trunc('week', ${enrolments.enrolledAt} at time zone ${ZINNY_TZ}), 'YYYY-MM-DD')`,
        n: sql<number>`count(*)`.mapWith(Number),
      })
      .from(enrolments)
      .where(and(isNotNull(enrolments.enrolledAt), gte(enrolments.enrolledAt, istStart(firstWeek))))
      .groupBy(enrolments.universityId, sql`2`),
    conn
      .select({
        universityId: orders.universityId,
        month: sql<string>`to_char(date_trunc('month', ${orders.paidAt} at time zone ${ZINNY_TZ}), 'YYYY-MM')`,
        paise: sql<number>`coalesce(sum(${orders.totalPaise}), 0)`.mapWith(Number),
        n: sql<number>`count(*)`.mapWith(Number),
      })
      .from(orders)
      .where(and(isNotNull(orders.paidAt), inArray(orders.status, [...COLLECTED]), gte(orders.paidAt, istStart(firstMonth))))
      .groupBy(orders.universityId, sql`2`),
  ]);

  const activeOf = new Map(active.map((a) => [a.universityId, a.n]));
  const inScope = (id: string) => !uni || id === uni;
  const scoped = unis.filter((u) => inScope(u.id));

  const weeks = Array.from({ length: nWeeks }, (_, i) => addDays(firstWeek, 7 * i)).map((week) => ({
    week,
    enrolments: weekly.filter((w) => w.week === week && inScope(w.universityId)).reduce((s, w) => s + w.n, 0),
  }));
  const months = Array.from({ length: nMonths }, (_, i) => monthOf(addMonths(firstMonth, i))).map((month) => {
    const rows = monthly.filter((m) => m.month === month && inScope(m.universityId));
    return { month, paise: rows.reduce((s, m) => s + m.paise, 0), payments: rows.reduce((s, m) => s + m.n, 0) };
  });

  const perUniversity = unis.map((u) => ({
    id: u.id,
    name: u.name,
    status: u.status,
    students: (usage.get(u.id) ?? emptyUsage()).students,
    activeStudents: activeOf.get(u.id) ?? 0,
    enrolments12w: weekly.filter((w) => w.universityId === u.id).reduce((s, w) => s + w.n, 0),
    collectedMonth: monthly.filter((m) => m.universityId === u.id && m.month === monthOf(thisMonth)).reduce((s, m) => s + m.paise, 0),
    collected12m: monthly.filter((m) => m.universityId === u.id).reduce((s, m) => s + m.paise, 0),
  }));

  return {
    universityId: uni,
    universities: {
      total: scoped.length,
      active: scoped.filter((u) => u.status === "active").length,
      suspended: scoped.filter((u) => u.status === "suspended").length,
    },
    students: scoped.reduce((s, u) => s + (usage.get(u.id) ?? emptyUsage()).students, 0),
    activeStudents: scoped.reduce((s, u) => s + (activeOf.get(u.id) ?? 0), 0),
    weeks,
    months,
    perUniversity,
  };
}

/* ─────────────────────────── Overview for a date range ─────────────────────────── */

export type RangeMetrics = {
  newInstitutes: number;
  newLearners: number;
  enrolments: number;
  /** Money students paid to institutes in the range, in paise. */
  collectedPaise: number;
  sales: number;
};

export type Overview = {
  range: DateRange;
  granularity: Granularity;
  current: RangeMetrics;
  previous: RangeMetrics;
  series: { key: string; label: string; enrolments: number; paise: number }[];
  /** Things that are true today whatever range is picked. */
  now: { institutes: number; activeInstitutes: number; suspended: number; students: number; activeStudents: number; licencesRunning: number };
};

const iso = (date: string) => istStart(date).toISOString();

/** Percent change from `before` to `now`; null when there was nothing before to compare with. */
export function percentChange(now: number, before: number): number | null {
  if (before === 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/**
 * The numbers on the platform overview for a date range, with the same numbers for the
 * period before it. "Now" figures (active institutes, running licences) ignore the range.
 * Days are India days, like the rest of the team panel.
 */
export async function overview(actor: Actor, range: DateRange, today = todayIST()): Promise<Overview> {
  assertPlatform(actor, "platform.view_analytics");
  const conn = db();
  const lo = iso(range.prev.from);
  const mid = iso(range.from);
  const hi = iso(addDays(range.to, 1));
  const g = granularityFor(range.days);
  const unit = sql.raw(`'${g}'`);
  // The day, week or month a moment falls in, in India time, as "YYYY-MM-DD".
  const bucket = (col: SQL) =>
    g === "day"
      ? sql<string>`to_char((${col} at time zone ${ZINNY_TZ})::date, 'YYYY-MM-DD')`
      : sql<string>`to_char(date_trunc(${unit}, ${col} at time zone ${ZINNY_TZ}), 'YYYY-MM-DD')`;

  const inCurrent = (col: SQL) => sql`${col} >= ${mid}::timestamptz and ${col} < ${hi}::timestamptz`;
  const inPrevious = (col: SQL) => sql`${col} >= ${lo}::timestamptz and ${col} < ${mid}::timestamptz`;
  const both = (col: SQL, what: SQL = sql`*`) => ({
    cur: sql<number>`count(${what}) filter (where ${inCurrent(col)})`.mapWith(Number),
    prev: sql<number>`count(${what}) filter (where ${inPrevious(col)})`.mapWith(Number),
  });

  const uniCreated = sql`${universities.createdAt}`;
  const roleCreated = sql`${roleAssignments.createdAt}`;
  const enrolledAt = sql`${enrolments.enrolledAt}`;
  const paidAt = sql`${orders.paidAt}`;

  const [[unis], [learners], [enrol], [sales], series, statusRows, usage, active, [lic]] = await Promise.all([
    conn.select(both(uniCreated)).from(universities),
    // A learner is one person with a student role at one institute.
    conn
      .select(both(roleCreated, sql`distinct (${roleAssignments.userId}, ${roleAssignments.universityId})`))
      .from(roleAssignments)
      .where(eq(roleAssignments.role, "student")),
    conn.select(both(enrolledAt)).from(enrolments).where(isNotNull(enrolments.enrolledAt)),
    conn
      .select({
        ...both(paidAt),
        curPaise: sql<number>`coalesce(sum(${orders.totalPaise}) filter (where ${inCurrent(paidAt)}), 0)`.mapWith(Number),
        prevPaise: sql<number>`coalesce(sum(${orders.totalPaise}) filter (where ${inPrevious(paidAt)}), 0)`.mapWith(Number),
      })
      .from(orders)
      .where(and(isNotNull(orders.paidAt), inArray(orders.status, [...COLLECTED]))),
    // The chart: enrolments and money per day, week or month of the range.
    conn.execute<{ bucket: string; enrolments: number; paise: number }>(sql`
      select bucket, sum(n)::int as enrolments, sum(paise)::bigint as paise from (
        select ${bucket(enrolledAt)} as bucket, count(*) as n, 0 as paise from ${enrolments}
          where ${inCurrent(enrolledAt)} group by 1
        union all
        select ${bucket(paidAt)} as bucket, 0 as n, sum(${orders.totalPaise}) as paise from ${orders}
          where ${inCurrent(paidAt)} and ${orders.status} in ('paid', 'refund_due', 'refunded') group by 1
      ) t group by bucket`),
    conn.select({ status: universities.status, n: count() }).from(universities).groupBy(universities.status),
    usageFor(conn),
    conn
      .select({ n: sql<number>`count(distinct ${enrolments.userId})`.mapWith(Number) })
      .from(enrolments)
      .where(
        and(
          eq(enrolments.status, "active"),
          sql`exists (select 1 from ${roleAssignments} r
            where r.user_id = ${enrolments.userId} and r.university_id = ${enrolments.universityId} and r.role = 'student'
              and r.revoked_at is null and r.starts_at <= now() and (r.ends_at is null or r.ends_at > now()))`,
        ),
      ),
    conn.select({ n: count() }).from(platLicences).where(sql`${platLicences.endDate} >= ${today}`),
  ]);

  const byBucket = new Map((series as unknown as { bucket: string; enrolments: number; paise: number | string }[]).map((r) => [r.bucket, r]));
  const filled = bucketsFor(range.from, range.to, g).map((start) => {
    const r = byBucket.get(start);
    return { key: start, label: bucketLabel(start, g), enrolments: r ? Number(r.enrolments) : 0, paise: r ? Number(r.paise) : 0 };
  });
  return {
    range,
    granularity: g,
    current: { newInstitutes: unis.cur, newLearners: learners.cur, enrolments: enrol.cur, collectedPaise: sales.curPaise, sales: sales.cur },
    previous: { newInstitutes: unis.prev, newLearners: learners.prev, enrolments: enrol.prev, collectedPaise: sales.prevPaise, sales: sales.prev },
    series: filled,
    now: {
      institutes: statusRows.reduce((s, r) => s + r.n, 0),
      activeInstitutes: statusRows.find((r) => r.status === "active")?.n ?? 0,
      suspended: statusRows.find((r) => r.status === "suspended")?.n ?? 0,
      students: [...usage.values()].reduce((s, u) => s + u.students, 0),
      activeStudents: active[0]?.n ?? 0,
      licencesRunning: lic?.n ?? 0,
    },
  };
}
