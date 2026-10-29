/**
 * Scheduled work (contracts.md section 5). Each job runs once per university as that
 * university's system actor, under row-level security.
 *
 * - `live-classes.close-sessions` (hourly): for recorded classes that have ended, marks
 *   students who never joined as absent, so every status is a stored row and every change
 *   emits `attendance.marked`.
 * - `live-classes.weekly-alerts` (daily, acts once a week): on Mondays (or the first run
 *   after), tells each student below the threshold in a batch, and sends each HOD one
 *   summary for their department. Each person is alerted once per week.
 */
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { audit, hodsOf, notify, peopleLite, reach, scheduledBatches, withTenant, type Actor } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import type { Job } from "@/contracts/module";
import { clockFor, evaluateBatches, sessionKey, sessionsOf, tallyStudents, thresholdFor } from "./engine";
import { liveAlerts, liveAttendance, liveSessions, liveSettings } from "./schema";
import { batchesInReach, uniOf } from "./scope";
import { closeSession } from "./staff";
import { addDays, formatDay, MIN_CLASSES_FOR_ALERT, weekStart } from "./time";

const LOOKBACK_DAYS = 14;

/** Marks no-shows absent in recorded classes that have ended in the last two weeks. Returns how many. */
export async function closeEndedSessions(actor: Actor, now = new Date()): Promise<number> {
  if (!reach(actor, "attendance.mark", uniOf(actor)).all) throw new ForbiddenError();
  return withTenant(actor, async (tx) => {
    const clock = await clockFor(tx, now);
    const open = await tx
      .select()
      .from(liveSessions)
      .where(and(isNull(liveSessions.closedAt), isNull(liveSessions.lockedAt), gte(liveSessions.date, addDays(clock.today, -LOOKBACK_DAYS)), lte(liveSessions.date, clock.today)));
    if (open.length === 0) return 0;
    const scheds = await scheduledBatches(tx, [...new Set(open.map((r) => r.batchId))]);
    const sessions = new Map(sessionsOf(scheds, addDays(clock.today, -LOOKBACK_DAYS - 1), clock.today, clock).map((s) => [sessionKey(s.batchId, s.date, s.startTime), s]));
    const withRows = new Set(
      (
        await tx
          .selectDistinct({ batchId: liveAttendance.batchId, date: liveAttendance.date, startTime: liveAttendance.startTime })
          .from(liveAttendance)
          .where(and(gte(liveAttendance.date, addDays(clock.today, -LOOKBACK_DAYS)), lte(liveAttendance.date, clock.today)))
      ).map((r) => sessionKey(r.batchId, r.date, r.startTime)),
    );
    let marked = 0;
    for (const row of open) {
      const key = sessionKey(row.batchId, row.date, row.startTime);
      const s = sessions.get(key);
      // Cancelled after the fact: nothing to close. Still on: wait for it to end.
      if (!s || s.state !== "ended") continue;
      // Only classes run through Zinny (started, joined or marked) get automatic absences.
      if (!row.startedAt && !withRows.has(key)) continue;
      const [locked] = await tx.select().from(liveSessions).where(eq(liveSessions.id, row.id)).for("update");
      if (!locked || locked.closedAt || locked.lockedAt) continue;
      const n = await closeSession(tx, actor, row.batchId, s, locked, now);
      marked += n;
      if (n > 0) await audit(tx, actor, "attendance.auto_absent", "live_session", row.id, { batchId: row.batchId, date: row.date, startTime: row.startTime, markedAbsent: n });
    }
    return marked;
  });
}

export type AlertRun = { week: string; students: number; hods: number; skipped?: "not_due" };

/**
 * Weekly low-attendance alerts. Due from Monday of each week; the first run of the week
 * sends them and later runs that week do nothing. `force` sends even if already sent this
 * week (each person still gets at most one alert per batch or department per week).
 */
export async function sendWeeklyAlerts(actor: Actor, opts: { now?: Date; force?: boolean } = {}): Promise<AlertRun> {
  if (!reach(actor, "attendance.view", uniOf(actor)).all) throw new ForbiddenError();
  const now = opts.now ?? new Date();
  return withTenant(actor, async (tx) => {
    const clock = await clockFor(tx, now);
    const week = weekStart(clock.today);
    const [settings] = await tx.select().from(liveSettings).where(eq(liveSettings.universityId, uniOf(actor)));
    if (!opts.force && settings?.alertsWeek === week) return { week, students: 0, hods: 0, skipped: "not_due" };
    const threshold = await thresholdFor(tx);

    const list = (await batchesInReach(tx, actor, "attendance.view")).filter((b) => b.startDate <= clock.today && b.endDate >= addDays(clock.today, -7));
    const scheds = await scheduledBatches(tx, list.map((b) => b.id));
    const already = new Set(
      (await tx.select().from(liveAlerts).where(eq(liveAlerts.week, week))).map((a) => `${a.kind}|${a.userId}|${a.scope}`),
    );

    type Low = { userId: string; batchId: string; courseTitle: string; batchName: string; percent: number; held: number; attended: number };
    const lows: Low[] = [];
    const byDept = new Map<string, { name: string; lows: Low[]; batches: number }>();
    for (const b of list) {
      const sched = scheds.find((s) => s.batchId === b.id);
      if (!sched) continue;
      const { sessions, rosters } = await evaluateBatches(tx, [sched], sched.startDate, clock.today, clock);
      const current = new Set((rosters.get(b.id) ?? []).map((m) => m.userId));
      const d = byDept.get(b.departmentId) ?? { name: b.departmentName, lows: [], batches: 0 };
      d.batches++;
      byDept.set(b.departmentId, d);
      for (const t of tallyStudents(sessions).values()) {
        if (!current.has(t.userId) || t.percent === null || t.held < MIN_CLASSES_FOR_ALERT || t.percent >= threshold) continue;
        const low = { userId: t.userId, batchId: b.id, courseTitle: b.courseTitle, batchName: b.name, percent: t.percent, held: t.held, attended: t.present + t.late };
        lows.push(low);
        d.lows.push(low);
      }
    }

    let students = 0;
    for (const l of lows) {
      if (already.has(`student|${l.userId}|${l.batchId}`)) continue;
      await notify(tx, uniOf(actor), [l.userId], {
        kind: "attendance.low",
        title: `Your attendance in ${l.courseTitle} is ${l.percent}%`,
        body: `You've attended ${l.attended} of ${l.held} live classes in ${l.batchName}. The minimum is ${threshold}%. Join the next classes on time to bring it up, or talk to your faculty if something is stopping you.`,
        data: { batchId: l.batchId, percent: l.percent, threshold },
      });
      await tx.insert(liveAlerts).values({ universityId: uniOf(actor), week, kind: "student", userId: l.userId, scope: l.batchId }).onConflictDoNothing();
      students++;
    }

    let hods = 0;
    for (const [departmentId, d] of byDept) {
      if (d.lows.length === 0) continue;
      const people = new Map((await peopleLite(tx, d.lows.map((l) => l.userId))).map((p) => [p.id, p.name]));
      const lines = [...d.lows]
        .sort((a, b) => a.percent - b.percent)
        .slice(0, 12)
        .map((l) => `${people.get(l.userId) ?? "A student"}: ${l.percent}% in ${l.courseTitle}, ${l.batchName}`);
      const more = d.lows.length > 12 ? ` And ${d.lows.length - 12} more.` : "";
      for (const hod of await hodsOf(tx, departmentId)) {
        if (already.has(`hod|${hod}|${departmentId}`)) continue;
        await notify(tx, uniOf(actor), [hod], {
          kind: "attendance.low_summary",
          title: `${d.lows.length} student${d.lows.length === 1 ? "" : "s"} in ${d.name} below ${threshold}% attendance`,
          body: `Week of ${formatDay(week, { year: true })}. ${lines.join("; ")}.${more}`,
          data: { departmentId, week, count: d.lows.length, threshold, students: d.lows.map((l) => ({ userId: l.userId, batchId: l.batchId, percent: l.percent })) },
        });
        await tx.insert(liveAlerts).values({ universityId: uniOf(actor), week, kind: "hod", userId: hod, scope: departmentId }).onConflictDoNothing();
        hods++;
      }
    }

    await tx
      .insert(liveSettings)
      .values({ universityId: uniOf(actor), alertsWeek: week })
      .onConflictDoUpdate({ target: liveSettings.universityId, set: { alertsWeek: week } });
    await audit(tx, actor, "attendance.weekly_alerts", "live_settings", uniOf(actor), { week, threshold, students, hods });
    return { week, students, hods };
  });
}

export const jobs: Job[] = [
  { id: "live-classes.close-sessions", every: "hour", run: async (actor) => void (await closeEndedSessions(actor)) },
  { id: "live-classes.weekly-alerts", every: "day", run: async (actor) => void (await sendWeeklyAlerts(actor)) },
];
