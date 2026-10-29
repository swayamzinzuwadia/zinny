/**
 * Read-only views for staff: a batch's attendance (every class with % present, each
 * student's %, students below the threshold), the course's Live classes tab, today's
 * classes for faculty, and the dashboard card. Lists are narrowed with `reach`.
 */
import { assertCan, batchLite, can, courseTarget, getCourseLite, peopleLite, scheduledBatches, withTenant, type Actor, type BatchLite, type PersonLite } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { clockFor, evaluateBatches, liveRowFor, meetingLinkFor, sessionKey, tallyStudents, thresholdFor, rowsFor, type EvaluatedSession, type StudentTally } from "./engine";
import { batchesInReach, reachesAboveBatch, uniOf, type ScopedBatch } from "./scope";
import { addDays, isUuid, minDate, startable } from "./time";

/* ─────────────── One batch ─────────────── */

export type StudentRow = StudentTally & { person: PersonLite; below: boolean; current: boolean };

export type BatchAttendance = {
  batch: BatchLite;
  courseTitle: string;
  tz: string;
  today: string;
  threshold: number;
  /** Classes held so far (newest first), and the next few. */
  past: EvaluatedSession[];
  upcoming: EvaluatedSession[];
  students: StudentRow[];
  /** Present and late over everything recorded, across the batch. */
  overall: number | null;
  recordedClasses: number;
  /** Classes that have ended without anyone starting, joining or marking them in Zinny. */
  unrecordedClasses: number;
  canMark: boolean;
  canUnlock: boolean;
  canManage: boolean;
};

/** Everything the batch's attendance page and section show. */
export async function batchAttendance(actor: Actor, batchId: string, now = new Date()): Promise<BatchAttendance> {
  if (!isUuid(batchId)) throw new NotFoundError("Batch");
  return withTenant(actor, async (tx) => {
    const batch = await batchLite(tx, batchId);
    assertCan(actor, "attendance.view", batch.target);
    const [sched] = await scheduledBatches(tx, [batchId]);
    const clock = await clockFor(tx, now);
    const threshold = await thresholdFor(tx);
    const to = minDate(addDays(clock.today, 14), sched.endDate);
    const { sessions, rosters } = await evaluateBatches(tx, [sched], sched.startDate, to, clock);
    const past = sessions.filter((s) => s.state === "ended" || s.state === "live").reverse();
    const upcoming = sessions.filter((s) => s.state === "upcoming" || s.state === "open").slice(0, 5);
    const roster = rosters.get(batchId) ?? [];
    const tallies = tallyStudents(sessions, roster.map((m) => m.userId));
    const people = new Map((await peopleLite(tx, [...tallies.keys()])).map((p) => [p.id, p]));
    const current = new Set(roster.map((m) => m.userId));
    const students = [...tallies.values()]
      .flatMap((t) => {
        const person = people.get(t.userId);
        if (!person) return [];
        // Someone who switched out with no classes here isn't part of this batch's picture.
        if (!current.has(t.userId) && t.held === 0) return [];
        return [{ ...t, person, current: current.has(t.userId), below: t.percent !== null && t.percent < threshold }];
      })
      .sort((a, b) => Number(b.current) - Number(a.current) || (a.percent ?? 101) - (b.percent ?? 101) || a.person.name.localeCompare(b.person.name));
    const counted = sessions.filter((s) => s.counts);
    const attended = counted.reduce((n, s) => n + s.present + s.late, 0);
    const marked = counted.reduce((n, s) => n + s.present + s.late + s.absent, 0);
    return {
      batch,
      courseTitle: sched.courseTitle,
      tz: clock.tz,
      today: clock.today,
      threshold,
      past,
      upcoming,
      students,
      overall: marked ? Math.round((attended / marked) * 100) : null,
      recordedClasses: counted.length,
      unrecordedClasses: past.filter((s) => s.state === "ended" && !s.recorded).length,
      canMark: can(actor, "attendance.mark", batch.target),
      canUnlock: reachesAboveBatch(actor, "attendance.mark", batch.departmentId),
      canManage: can(actor, "live.manage", batch.target),
    };
  });
}

/* ─────────────── Course tab ─────────────── */

export type CourseBatchLive = {
  batch: ScopedBatch;
  meetingUrl: string | null;
  upcoming: (EvaluatedSession & { link: string | null })[];
  overall: number | null;
  recordedClasses: number;
  below: number;
  students: number;
};

/** The course's Live classes tab: every batch in reach with upcoming classes, links and attendance %. */
export async function courseLive(actor: Actor, courseId: string, now = new Date()) {
  if (!isUuid(courseId)) throw new NotFoundError("Course");
  return withTenant(actor, async (tx) => {
    const target = await courseTarget(tx, uniOf(actor), courseId);
    assertCan(actor, "attendance.view", target);
    const course = await getCourseLite(tx, courseId);
    const clock = await clockFor(tx, now);
    const threshold = await thresholdFor(tx);
    const list = await batchesInReach(tx, actor, "attendance.view", { courseId });
    const scheds = await scheduledBatches(tx, list.map((b) => b.id));
    const out: CourseBatchLive[] = [];
    for (const b of list) {
      const sched = scheds.find((s) => s.batchId === b.id)!;
      const { sessions, rosters } = await evaluateBatches(tx, [sched], sched.startDate, minDate(addDays(clock.today, 14), sched.endDate), clock);
      const { live } = await rowsFor(tx, [b.id], clock.today, addDays(clock.today, 14));
      const tallies = tallyStudents(sessions, (rosters.get(b.id) ?? []).map((m) => m.userId));
      const current = new Set((rosters.get(b.id) ?? []).map((m) => m.userId));
      const counted = sessions.filter((s) => s.counts);
      const attended = counted.reduce((n, s) => n + s.present + s.late, 0);
      const marked = counted.reduce((n, s) => n + s.present + s.late + s.absent, 0);
      out.push({
        batch: b,
        meetingUrl: meetingLinkFor(undefined, sched.joinUrl ?? null),
        upcoming: sessions
          .filter((s) => s.state !== "ended")
          .slice(0, 3)
          .map((s) => ({ ...s, link: meetingLinkFor(live.get(sessionKey(s.batchId, s.date, s.startTime)), sched.joinUrl ?? null) })),
        overall: marked ? Math.round((attended / marked) * 100) : null,
        recordedClasses: counted.length,
        below: [...tallies.values()].filter((t) => current.has(t.userId) && t.percent !== null && t.percent < threshold).length,
        students: current.size,
      });
    }
    return { course, tz: clock.tz, today: clock.today, threshold, batches: out };
  });
}

/* ─────────────── Today, for staff ─────────────── */

export type TodayClass = EvaluatedSession & {
  courseTitle: string;
  link: string | null;
  canStart: boolean;
  canMark: boolean;
  departmentId: string;
};

/**
 * Today's classes in the actor's reach for `attendance.view` (faculty: their batches; HOD:
 * their department; admin and Board: everything), with present / total so far.
 */
export async function todaysClasses(actor: Actor, now = new Date()): Promise<{ tz: string; today: string; classes: TodayClass[] }> {
  return withTenant(actor, async (tx) => {
    const clock = await clockFor(tx, now);
    const list = (await batchesInReach(tx, actor, "attendance.view")).filter((b) => b.startDate <= clock.today && b.endDate >= clock.today);
    if (list.length === 0) return { tz: clock.tz, today: clock.today, classes: [] };
    const scheds = await scheduledBatches(tx, list.map((b) => b.id));
    const { sessions } = await evaluateBatches(tx, scheds, clock.today, clock.today, clock);
    const classes: TodayClass[] = [];
    for (const s of sessions) {
      const b = list.find((x) => x.id === s.batchId)!;
      const target = { universityId: uniOf(actor), departmentIds: [b.departmentId], batchIds: [b.id] };
      const live = s.live ?? (await liveRowFor(tx, s));
      classes.push({
        ...s,
        courseTitle: b.courseTitle,
        departmentId: b.departmentId,
        link: meetingLinkFor(live, scheds.find((x) => x.batchId === b.id)?.joinUrl ?? null),
        canStart: can(actor, "live.manage", target) && startable(s, now),
        canMark: can(actor, "attendance.mark", target),
      });
    }
    return { tz: clock.tz, today: clock.today, classes };
  });
}
