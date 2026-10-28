/**
 * Everything the dashboard shows, limited to what this person can see:
 * today's classes, what needs their attention, how full each batch is, and money (if allowed).
 */
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { batches, enrolments, notifications, orders, roleAssignments, universities } from "@/db/schema";
import { can, reach, type Actor } from "../authz/engine";
import { addDays, formatDate, minutesNowIn, todayIn, toMinutes } from "../lib/dates";
import { withTenant } from "../tenant";
import { scheduledBatches } from "./batches";
import { listCourses } from "./courses";
import { expandSessions, type Session } from "./schedule";

export type BoardSession = Session & { lane: number; students: number; state: "past" | "live" | "next" | "later" };

export function greetingFor(minutes: number) {
  if (minutes < 4 * 60) return "Hello";
  if (minutes < 12 * 60) return "Good morning";
  if (minutes < 17 * 60) return "Good afternoon";
  return "Good evening";
}

/** Stack overlapping classes into lanes so blocks never sit on top of each other. */
function assignLanes(sessions: Session[]) {
  const laneEnds: number[] = [];
  return sessions.map((s) => {
    const start = toMinutes(s.startTime);
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = toMinutes(s.endTime);
    return { session: s, lane };
  });
}

export async function dashboard(actor: Actor) {
  const uni = actor.universityId!;
  const courses = await listCourses(actor);
  const batchReach = reach(actor, "batch.view", uni);
  const canSeeBatches = batchReach.all || batchReach.departmentIds.size > 0 || batchReach.batchIds.size > 0;
  const switchReach = reach(actor, "batch.switch.decide", uni);
  const canDecideSwitches = switchReach.all || switchReach.departmentIds.size > 0;
  const canSeeFinance = can(actor, "finance.view", { universityId: uni });

  return withTenant(actor, async (tx) => {
    const [u] = await tx.select({ tz: universities.timezone, name: universities.name }).from(universities).where(eq(universities.id, uni));
    const tz = u?.tz ?? "Asia/Kolkata";
    const today = todayIn(tz);
    const nowMin = minutesNowIn(tz);

    // Batches in scope
    const courseIds = courses.map((c) => c.id);
    const rows = courseIds.length
      ? await tx
          .select({ id: batches.id, departmentId: batches.departmentId, status: batches.status, endDate: batches.endDate })
          .from(batches)
          .where(inArray(batches.courseId, courseIds))
      : [];
    const scoped = rows.filter((b) => batchReach.all || batchReach.departmentIds.has(b.departmentId) || batchReach.batchIds.has(b.id));
    const live = scoped.filter((b) => b.status !== "archived" && b.endDate >= today);
    const sched = await scheduledBatches(tx, live.map((b) => b.id));

    // Seat counts per batch
    const counts = live.length
      ? await tx
          .select({
            batchId: enrolments.batchId,
            active: sql<number>`count(*) filter (where ${enrolments.status} = 'active')::int`,
            held: sql<number>`count(*) filter (where ${enrolments.status} = 'held' and ${enrolments.holdExpiresAt} > now())::int`,
          })
          .from(enrolments)
          .where(inArray(enrolments.batchId, live.map((b) => b.id)))
          .groupBy(enrolments.batchId)
      : [];
    const countOf = (id: string) => counts.find((c) => c.batchId === id) ?? { active: 0, held: 0 };

    // Today's classes, positioned for the board
    const todaySessions = expandSessions(sched, today, today);
    let nextMarked = false;
    const board: BoardSession[] = assignLanes(todaySessions).map(({ session, lane }) => {
      const start = toMinutes(session.startTime);
      const end = toMinutes(session.endTime);
      let state: BoardSession["state"] = end <= nowMin ? "past" : start <= nowMin ? "live" : "later";
      if (state === "later" && !nextMarked) {
        state = "next";
        nextMarked = true;
      }
      return { ...session, lane, students: countOf(session.batchId).active, state };
    });

    // Next class day if today is empty
    let nextDay: { date: string; label: string; count: number } | null = null;
    if (board.length === 0 && sched.length) {
      const upcoming = expandSessions(sched, addDays(today, 1), addDays(today, 14));
      if (upcoming.length) {
        const d = upcoming[0].date;
        nextDay = { date: d, label: formatDate(d, { weekday: true }), count: upcoming.filter((s) => s.date === d).length };
      }
    }

    // Seats
    const seats = sched
      .map((b) => {
        const c = countOf(b.batchId);
        return {
          batchId: b.batchId,
          batchName: b.batchName,
          courseTitle: b.courseTitle,
          limit: b.seatLimit,
          taken: c.active,
          held: c.held,
          startsOn: b.startDate > today ? b.startDate : null,
          fill: (c.active + c.held) / b.seatLimit,
        };
      })
      .sort((a, b) => b.fill - a.fill || a.courseTitle.localeCompare(b.courseTitle));

    // Visiting faculty whose access ends before their batch does (next 14 days)
    const now = new Date();
    const horizon = new Date(now.getTime() + 14 * 86_400_000);
    const expiring: { batchId: string; batchName: string; courseTitle: string; endsOn: string }[] = [];
    if (canDecideSwitches && sched.length) {
      const fac = await tx
        .select({ batchId: roleAssignments.batchId, endsAt: roleAssignments.endsAt })
        .from(roleAssignments)
        .where(and(inArray(roleAssignments.batchId, sched.map((b) => b.batchId)), isNull(roleAssignments.revokedAt)));
      for (const b of sched) {
        const mine = fac.filter((f) => f.batchId === b.batchId && (!f.endsAt || f.endsAt > now));
        if (mine.length === 0 || mine.some((f) => !f.endsAt || f.endsAt > horizon)) continue;
        const last = new Date(Math.max(...mine.map((f) => f.endsAt!.getTime())));
        const endsOn = todayIn(tz, last);
        if (endsOn < b.endDate) expiring.push({ batchId: b.batchId, batchName: b.batchName, courseTitle: b.courseTitle, endsOn });
      }
    }

    // People and money
    const scopedIds = scoped.map((b) => b.id);
    const [{ students, thisWeek }] = scopedIds.length
      ? await tx
          .select({
            students: sql<number>`count(distinct ${enrolments.userId}) filter (where ${enrolments.status} = 'active')::int`,
            thisWeek: sql<number>`count(*) filter (where ${enrolments.status} = 'active' and ${enrolments.enrolledAt} > now() - interval '7 days')::int`,
          })
          .from(enrolments)
          .where(inArray(enrolments.batchId, scopedIds))
      : [{ students: 0, thisWeek: 0 }];

    let money: { monthPaise: number; monthOrders: number; refundsDue: number; pending: number; days: { date: string; paise: number }[] } | null = null;
    if (canSeeFinance) {
      const [m] = await tx
        .select({
          pending: sql<number>`count(*) filter (where ${orders.status} = 'pending')::int`,
          monthPaise: sql<number>`coalesce(sum(${orders.totalPaise}) filter (where ${orders.status} = 'paid' and ${orders.paidAt} >= date_trunc('month', now() at time zone ${tz}) at time zone ${tz}), 0)::int`,
          monthOrders: sql<number>`count(*) filter (where ${orders.status} = 'paid' and ${orders.paidAt} >= date_trunc('month', now() at time zone ${tz}) at time zone ${tz})::int`,
          refundsDue: sql<number>`count(*) filter (where ${orders.status} = 'refund_due')::int`,
        })
        .from(orders);
      const daily = await tx
        .select({
          date: sql<string>`to_char(${orders.paidAt} at time zone ${tz}, 'YYYY-MM-DD')`,
          paise: sql<number>`sum(${orders.totalPaise})::int`,
        })
        .from(orders)
        .where(and(eq(orders.status, "paid"), gt(orders.paidAt, sql`now() - interval '14 days'`)))
        .groupBy(sql`1`);
      const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map((d) => ({
        date: d,
        paise: daily.find((x) => x.date === d)?.paise ?? 0,
      }));
      money = { ...m, days };
    }

    const updates = await tx
      .select()
      .from(notifications)
      .where(eq(notifications.userId, actor.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(6);

    return {
      universityName: u?.name ?? "",
      today,
      todayLabel: new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${today}T00:00:00Z`)),
      nowMin,
      greeting: greetingFor(nowMin),
      canSeeBatches,
      canDecideSwitches,
      canSeeFinance,
      board,
      nextDay,
      seats,
      expiring,
      courses: courses.length,
      openBatches: live.filter((b) => b.status === "open").length,
      students,
      thisWeek,
      money,
      updates,
    };
  });
}

export type DashboardData = Awaited<ReturnType<typeof dashboard>>;
