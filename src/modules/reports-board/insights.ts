/**
 * Insights (PRD page 3): a read-only view of enrolment, completion, revenue and faculty
 * load for Board / Owner and admins (whole university) and Heads of Department (their own
 * department). Revenue needs finance.view as well, so a HOD never sees it.
 *
 * Everything is computed from core tables with `select` and from the core calendar
 * (scheduledBatches + expandSessions). Weeks start on Monday and months on the 1st, in the
 * university's time zone.
 */
import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses, departments, enrolments, invoices, orders, roleAssignments } from "@/db/schema";
import { expandSessions, peopleLite, reach, scheduledBatches, universityLite, withTenant, type Actor } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import { addDays, addMonths, formatDayShort, formatMonth, monthStart, todayIn, toMinutes, weekStart, zonedInstant } from "./lib/dates";
import type { BatchFill, CourseCompletion, CourseRevenue, FacultyLoad, MonthPoint, WeekPoint } from "./lib/takeaways";
import { batchInReach, dayStart, hasReach } from "./scope";

export const NO_INSIGHTS_ACCESS = "Insights are for Institute Admins, Board / Owner and Heads of Department.";

export const WEEKS = 12;
export const MONTHS = 12;

export function canOpenInsights(actor: Actor): boolean {
  return !!actor.universityId && hasReach(reach(actor, "insights.view", actor.universityId));
}

export type Insights = {
  universityName: string;
  /** "the whole university", or the HOD's department names. */
  scopeLabel: string;
  wholeUniversity: boolean;
  today: string;
  stats: {
    activeLearners: number;
    enrolmentsThisWeek: number;
    completionRate: number | null;
    openBatches: number;
    revenueThisMonthPaise: number | null;
  };
  enrolmentsByWeek: WeekPoint[];
  completion: CourseCompletion[];
  /** Null when the viewer may not see money. */
  revenue: { byMonth: MonthPoint[]; byCourse: CourseRevenue[] } | null;
  facultyLoad: FacultyLoad[];
  /** Monday of this week, for labels. */
  weekOf: string;
  batchFill: BatchFill[];
};

const TEACHING_ROLES = ["permanent_faculty", "visiting_faculty"] as const;

/**
 * Everything the Insights page shows, limited to the viewer's scope. `asOf` sets which day
 * counts as today for the calendar (tests pin it); permissions are always checked now.
 */
export async function loadInsights(actor: Actor, asOf = new Date()): Promise<Insights> {
  if (!canOpenInsights(actor)) throw new ForbiddenError(NO_INSIGHTS_ACCESS);
  const uni = actor.universityId!;
  const scope = reach(actor, "insights.view", uni);
  const money = reach(actor, "finance.view", uni);
  const showMoney = hasReach(money);

  return withTenant(actor, async (tx) => {
    const university = await universityLite(tx);
    const tz = university.timezone;
    const today = todayIn(tz, asOf);
    const thisWeek = weekStart(today);
    const inScope = batchInReach(scope, batches.id, batches.departmentId);

    // ── Scope label
    let scopeLabel = "the whole university";
    if (!scope.all) {
      const names = await tx
        .select({ name: departments.name })
        .from(departments)
        .where(inArray(departments.id, scope.departmentIds.size ? [...scope.departmentIds] : ["00000000-0000-0000-0000-000000000000"]))
        .orderBy(asc(departments.name));
      scopeLabel = names.length ? names.map((d) => d.name).join(", ") : "your batches";
    }

    // ── Enrolments per week, last 12 weeks including this one
    const firstWeek = addDays(thisWeek, -7 * (WEEKS - 1));
    const weekly = await tx
      .select({
        week: sql<string>`to_char(date_trunc('week', ${enrolments.enrolledAt} at time zone ${tz}), 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(enrolments)
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .where(and(isNotNull(enrolments.enrolledAt), gte(enrolments.enrolledAt, dayStart(firstWeek, tz)), inScope))
      .groupBy(sql`1`);
    const enrolmentsByWeek: WeekPoint[] = Array.from({ length: WEEKS }, (_, i) => {
      const start = addDays(firstWeek, 7 * i);
      return { start, label: formatDayShort(start), count: weekly.find((w) => w.week === start)?.n ?? 0, current: start === thisWeek };
    });

    // ── Completion rate per course (core enrolment status)
    const perCourse = await tx
      .select({
        courseId: courses.id,
        title: courses.title,
        department: departments.name,
        enrolled: sql<number>`count(*) filter (where ${enrolments.status} in ('active', 'completed', 'ended'))::int`,
        completed: sql<number>`count(*) filter (where ${enrolments.status} = 'completed')::int`,
        learning: sql<number>`count(*) filter (where ${enrolments.status} = 'active')::int`,
      })
      .from(enrolments)
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .innerJoin(departments, eq(departments.id, courses.departmentId))
      .where(and(isNotNull(enrolments.enrolledAt), inScope))
      .groupBy(courses.id, courses.title, departments.name);
    const completion: CourseCompletion[] = perCourse
      .filter((c) => c.enrolled > 0)
      .map((c) => ({ ...c, rate: (c.completed / c.enrolled) * 100 }))
      .sort((a, b) => b.rate - a.rate || b.enrolled - a.enrolled || a.title.localeCompare(b.title));
    const enrolledAll = completion.reduce((n, c) => n + c.enrolled, 0);
    const completedAll = completion.reduce((n, c) => n + c.completed, 0);

    const [{ learners }] = await tx
      .select({ learners: sql<number>`count(distinct ${enrolments.userId})::int` })
      .from(enrolments)
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .where(and(eq(enrolments.status, "active"), inScope));

    // ── Revenue per month and per course: invoiced value before GST, refunded orders left out
    let revenue: Insights["revenue"] = null;
    if (showMoney) {
      const firstMonth = addMonths(today, -(MONTHS - 1));
      const where = and(
        ne(orders.status, "refunded"),
        gte(invoices.issuedAt, dayStart(firstMonth, tz)),
        inScope,
        batchInReach(money, batches.id, batches.departmentId),
      );
      const monthly = await tx
        .select({
          month: sql<string>`to_char(date_trunc('month', ${invoices.issuedAt} at time zone ${tz}), 'YYYY-MM-DD')`,
          paise: sql<number>`coalesce(sum(${invoices.basePaise}), 0)::bigint`,
        })
        .from(invoices)
        .innerJoin(orders, eq(orders.id, invoices.orderId))
        .innerJoin(batches, eq(batches.id, orders.batchId))
        .where(where)
        .groupBy(sql`1`);
      const byCourse = await tx
        .select({ courseId: courses.id, title: courses.title, paise: sql<number>`coalesce(sum(${invoices.basePaise}), 0)::bigint` })
        .from(invoices)
        .innerJoin(orders, eq(orders.id, invoices.orderId))
        .innerJoin(batches, eq(batches.id, orders.batchId))
        .innerJoin(courses, eq(courses.id, batches.courseId))
        .where(where)
        .groupBy(courses.id, courses.title);
      const thisMonth = monthStart(today);
      revenue = {
        byMonth: Array.from({ length: MONTHS }, (_, i) => {
          const start = addMonths(firstMonth, i);
          return { start, label: formatMonth(start), paise: Number(monthly.find((m) => m.month === start)?.paise ?? 0), current: start === thisMonth };
        }),
        byCourse: byCourse
          .map((c) => ({ ...c, paise: Number(c.paise) }))
          .filter((c) => c.paise !== 0)
          .sort((a, b) => b.paise - a.paise || a.title.localeCompare(b.title)),
      };
    }

    // ── Batches running now or starting later
    const live = await tx
      .select({
        id: batches.id,
        name: batches.name,
        courseTitle: courses.title,
        seatLimit: batches.seatLimit,
        startDate: batches.startDate,
        status: batches.status,
      })
      .from(batches)
      .innerJoin(courses, eq(courses.id, batches.courseId))
      .where(and(inArray(batches.status, ["open", "closed"]), gte(batches.endDate, today), inScope))
      .orderBy(asc(courses.title), asc(batches.startDate), asc(batches.name));
    const liveIds = live.map((b) => b.id);

    // ── Batch fill: seats taken (paid) and being paid for right now, against the limit
    const seats = liveIds.length
      ? await tx
          .select({
            batchId: enrolments.batchId,
            taken: sql<number>`count(*) filter (where ${enrolments.status} = 'active')::int`,
            held: sql<number>`count(*) filter (where ${enrolments.status} = 'held' and ${enrolments.holdExpiresAt} > now())::int`,
          })
          .from(enrolments)
          .where(inArray(enrolments.batchId, liveIds))
          .groupBy(enrolments.batchId)
      : [];
    const batchFill: BatchFill[] = live
      .map((b) => {
        const s = seats.find((x) => x.batchId === b.id) ?? { taken: 0, held: 0 };
        return {
          batchId: b.id,
          course: b.courseTitle,
          batch: b.name,
          taken: s.taken,
          held: s.held,
          limit: b.seatLimit,
          fill: (s.taken / b.seatLimit) * 100,
          startsOn: b.startDate > today ? b.startDate : null,
        };
      })
      .sort((a, b) => b.fill - a.fill || a.course.localeCompare(b.course) || a.batch.localeCompare(b.batch));

    // ── Faculty load: scheduled teaching hours per faculty member, last, this and next week
    const facultyLoad = await facultyHours(tx, liveIds, tz, thisWeek);

    return {
      universityName: university.name,
      scopeLabel,
      wholeUniversity: scope.all,
      today,
      weekOf: thisWeek,
      stats: {
        activeLearners: learners,
        enrolmentsThisWeek: enrolmentsByWeek[enrolmentsByWeek.length - 1].count,
        completionRate: enrolledAll ? (completedAll / enrolledAll) * 100 : null,
        openBatches: live.filter((b) => b.status === "open").length,
        revenueThisMonthPaise: revenue ? (revenue.byMonth.find((m) => m.current)?.paise ?? 0) : null,
      },
      enrolmentsByWeek,
      completion,
      revenue,
      facultyLoad,
      batchFill,
    };
  });
}

/** When an assignment stops counting: its end date or its revocation, whichever comes first. */
function assignmentEnd(a: { endsAt: Date | null; revokedAt: Date | null }): Date | null {
  if (a.endsAt && a.revokedAt) return a.endsAt < a.revokedAt ? a.endsAt : a.revokedAt;
  return a.endsAt ?? a.revokedAt;
}

type Assigned = { userId: string; batchId: string | null; startsAt: Date; endsAt: Date | null; revokedAt: Date | null };

/**
 * Who teaches a session: whoever was assigned to the batch when it starts. A batch set up
 * after it began has nobody on record for its early classes; those go to the first people
 * assigned afterwards (who haven't already left).
 */
export function teachersAt(forBatch: Assigned[], at: Date): Assigned[] {
  const ended = (a: Assigned, t: Date) => {
    const end = assignmentEnd(a);
    return !!end && end <= t;
  };
  const then = forBatch.filter((a) => a.startsAt <= at && !ended(a, at));
  if (then.length) return then;
  const later = forBatch.filter((a) => a.startsAt > at && !ended(a, a.startsAt));
  if (later.length === 0) return [];
  const first = Math.min(...later.map((a) => a.startsAt.getTime()));
  return later.filter((a) => a.startsAt.getTime() === first);
}

/**
 * Hours each faculty member is scheduled to teach in the week before, this week and the
 * week after. Sessions come from the core calendar (timings, holidays, moved and extra
 * classes) and count for whoever teaches them (teachersAt), so a visiting faculty
 * member's hours stop when their access ends.
 */
async function facultyHours(tx: Tx, batchIds: string[], tz: string, thisWeek: string): Promise<FacultyLoad[]> {
  if (batchIds.length === 0) return [];
  const from = addDays(thisWeek, -7);
  const to = addDays(thisWeek, 13);
  const sessions = expandSessions(await scheduledBatches(tx, batchIds), from, to);
  const assigned = await tx
    .select({
      userId: roleAssignments.userId,
      batchId: roleAssignments.batchId,
      startsAt: roleAssignments.startsAt,
      endsAt: roleAssignments.endsAt,
      revokedAt: roleAssignments.revokedAt,
    })
    .from(roleAssignments)
    .where(and(inArray(roleAssignments.batchId, batchIds), inArray(roleAssignments.role, [...TEACHING_ROLES])));
  if (assigned.length === 0) return [];

  const load = new Map<string, { lastWeek: number; thisWeek: number; nextWeek: number; batches: Set<string> }>();
  const entry = (userId: string) => {
    let e = load.get(userId);
    if (!e) load.set(userId, (e = { lastWeek: 0, thisWeek: 0, nextWeek: 0, batches: new Set() }));
    return e;
  };
  // Everyone currently assigned shows up, even with no classes in these three weeks.
  const now = new Date();
  for (const a of assigned) {
    const end = assignmentEnd(a);
    if (a.startsAt <= now && (!end || end > now)) entry(a.userId);
  }
  const byBatch = new Map<string, Assigned[]>();
  for (const a of assigned) byBatch.set(a.batchId!, [...(byBatch.get(a.batchId!) ?? []), a]);
  for (const s of sessions) {
    const at = zonedInstant(s.date, s.startTime, tz);
    const hours = (toMinutes(s.endTime) - toMinutes(s.startTime)) / 60;
    const bucket = s.date < thisWeek ? "lastWeek" : s.date < addDays(thisWeek, 7) ? "thisWeek" : "nextWeek";
    for (const a of teachersAt(byBatch.get(s.batchId) ?? [], at)) {
      const e = entry(a.userId);
      e[bucket] += hours;
      if (bucket === "thisWeek") e.batches.add(s.batchId);
    }
  }
  const people = new Map((await peopleLite(tx, [...load.keys()])).map((p) => [p.id, p.name]));
  return [...load.entries()]
    .map(([userId, e]) => ({
      userId,
      name: people.get(userId) ?? "Former faculty member",
      batches: e.batches.size,
      lastWeek: e.lastWeek,
      thisWeek: e.thisWeek,
      nextWeek: e.nextWeek,
    }))
    .sort((a, b) => b.thisWeek - a.thisWeek || b.nextWeek - a.nextWeek || a.name.localeCompare(b.name));
}
