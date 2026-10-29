/**
 * Students and live classes (PRD pages 5 and 6): joining a class, the learner course tab
 * and the "join next" home card. Every function checks `self.join_class` on the
 * student's own records first, and only ever reads the student's own attendance.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses } from "@/db/schema";
import { assertCan, audit, emit, scheduledBatches, studentEnrolments, withTenant, type Actor } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import {
  clockFor,
  ensureLiveSession,
  evaluateSession,
  liveRowFor,
  loadBatch,
  meetingLinkFor,
  resolveSession,
  rostersOf,
  rowsFor,
  sessionKey,
  sessionsOf,
  thresholdFor,
  type ClassSession,
} from "./engine";
import { liveAttendance } from "./schema";
import { uniOf } from "./scope";
import {
  addDays,
  canJoinAt,
  isIsoDate,
  JOIN_NEXT_WINDOW_MINUTES,
  percent,
  safeMeetingUrl,
  statusForJoin,
  type AttendanceStatus,
} from "./time";

function own(actor: Actor) {
  return { universityId: uniOf(actor), ownerUserId: actor.userId };
}

async function activeBatchIds(tx: Tx, userId: string): Promise<string[]> {
  return (await studentEnrolments(tx, userId)).filter((e) => e.status === "active").map((e) => e.batchId);
}

/* ─────────────── Joining a class ─────────────── */

export type JoinContext = { courseTitle: string; batchName: string; tz: string; today: string };

export type JoinOutcome =
  /** Recorded (or already recorded): send the student to the meeting. */
  | { kind: "go"; url: string; status: AttendanceStatus | null; firstJoin: boolean; session: ClassSession; ctx: JoinContext }
  | { kind: "too_early"; session: ClassSession; ctx: JoinContext }
  | { kind: "ended"; session: ClassSession; recordingUrl: string | null; ctx: JoinContext }
  | { kind: "no_link"; session: ClassSession; ctx: JoinContext }
  | { kind: "cancelled"; date: string; note: string | null; ctx: JoinContext }
  | { kind: "moved"; date: string; to: { date: string; startTime: string; endTime: string }; note: string | null; ctx: JoinContext }
  | { kind: "no_class"; date: string; next: ClassSession | null; ctx: JoinContext }
  | { kind: "not_in_batch" };

/**
 * The join link (`/[uni]/learn/join/[batchId]/[date]`). Only a student active in the batch
 * may use it. Inside the window (15 minutes before the start until the end) it records the
 * join time and marks the student present, or late after 10 minutes, then sends them to the
 * class's own link or the batch's. Joining again keeps the first status and counts the join.
 * Outside the window, with no link, or for a cancelled or moved class, it says what to do.
 */
export async function joinClass(actor: Actor, batchId: string, date: string, start?: string | null, now = new Date()): Promise<JoinOutcome> {
  assertCan(actor, "self.join_class", own(actor));
  if (!isIsoDate(date)) throw new NotFoundError("Class");
  return withTenant(actor, async (tx) => {
    const { batch, sched } = await loadBatch(tx, batchId);
    if (!(await activeBatchIds(tx, actor.userId)).includes(batchId)) return { kind: "not_in_batch" };

    const clock = await clockFor(tx, now);
    const ctx: JoinContext = { courseTitle: sched.courseTitle, batchName: sched.batchName, tz: clock.tz, today: clock.today };
    const r = resolveSession(sched, date, start, clock);
    if (!r.ok) {
      if (r.reason === "cancelled") return { kind: "cancelled", date, note: r.note, ctx };
      if (r.reason === "moved") return { kind: "moved", date, to: r.to, note: r.note, ctx };
      const next = sessionsOf([sched], clock.today, addDays(clock.today, 30), clock).find((s) => s.state !== "ended") ?? null;
      return { kind: "no_class", date, next, ctx };
    }
    const s = r.session;
    const live = await liveRowFor(tx, s);
    if (s.state === "upcoming") return { kind: "too_early", session: s, ctx };
    if (s.state === "ended") return { kind: "ended", session: s, recordingUrl: safeMeetingUrl(live?.recordingUrl), ctx };
    const url = meetingLinkFor(live, batch.meetingUrl);
    if (!url) return { kind: "no_link", session: s, ctx };

    // The shared lock keeps a lock or unlock of the register out while students join.
    const session = await ensureLiveSession(tx, uniOf(actor), s, "share");
    if (session.lockedAt) {
      // A locked register doesn't change; the student still gets to the class.
      await audit(tx, actor, "live.join", "live_session", session.id, { date: s.date, startTime: s.startTime, recorded: false, reason: "locked" });
      return { kind: "go", url, status: null, firstJoin: false, session: s, ctx };
    }

    const status = statusForJoin(s.window, now);
    const key = and(
      eq(liveAttendance.batchId, batchId),
      eq(liveAttendance.date, s.date),
      eq(liveAttendance.startTime, s.startTime),
      eq(liveAttendance.userId, actor.userId),
    );
    const [inserted] = await tx
      .insert(liveAttendance)
      .values({
        universityId: uniOf(actor),
        batchId,
        date: s.date,
        startTime: s.startTime,
        userId: actor.userId,
        status,
        source: "join",
        firstJoinedAt: now,
        lastJoinedAt: now,
        joinCount: 1,
        markedBy: actor.userId,
        markedAt: now,
      })
      .onConflictDoNothing({ target: [liveAttendance.batchId, liveAttendance.date, liveAttendance.startTime, liveAttendance.userId] })
      .returning({ id: liveAttendance.id, status: liveAttendance.status });
    if (inserted) {
      await audit(tx, actor, "live.join", "live_attendance", inserted.id, { batchId, date: s.date, startTime: s.startTime, status, joins: 1 });
      await emit(tx, actor, "attendance.marked", { batchId, date: s.date, startTime: s.startTime, userId: actor.userId, status });
      return { kind: "go", url, status, firstJoin: true, session: s, ctx };
    }

    // Already on the register. A join keeps the status, except an absent set before the
    // student had joined at all (marked absent early, then they turned up): they get the
    // status their join earns. An absent set after they had joined was a decision; it stays.
    const [existing] = await tx.select().from(liveAttendance).where(key).for("update");
    const upgrade = existing.status === "absent" && existing.firstJoinedAt === null;
    const next = upgrade ? status : existing.status;
    await tx
      .update(liveAttendance)
      .set({
        lastJoinedAt: now,
        firstJoinedAt: existing.firstJoinedAt ?? now,
        joinCount: existing.joinCount + 1,
        ...(upgrade && { status, source: "join" as const, markedBy: actor.userId, markedAt: now }),
      })
      .where(eq(liveAttendance.id, existing.id));
    await audit(tx, actor, "live.join", "live_attendance", existing.id, {
      batchId,
      date: s.date,
      startTime: s.startTime,
      status: next,
      joins: existing.joinCount + 1,
      ...(upgrade && { from: "absent" }),
    });
    if (upgrade) await emit(tx, actor, "attendance.marked", { batchId, date: s.date, startTime: s.startTime, userId: actor.userId, status });
    return { kind: "go", url, status: next, firstJoin: existing.firstJoinedAt === null, session: s, ctx };
  });
}

/* ─────────────── Learner course tab ─────────────── */

export type LearnerUpcoming = ClassSession & { joinable: boolean; hasLink: boolean };
export type LearnerPast = {
  batchId: string;
  batchName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: AttendanceStatus | null;
  joinedAt: Date | null;
  note: string | null;
  recordingUrl: string | null;
  kind: ClassSession["kind"];
};

export type LearnerLive = {
  tz: string;
  today: string;
  active: boolean;
  upcoming: LearnerUpcoming[];
  past: LearnerPast[];
  attended: number;
  held: number;
  percent: number | null;
  threshold: number;
};

/**
 * The learner's Live classes tab for one enrolment: upcoming classes of their batch (Join
 * shows inside the window), and past classes with their own status and the recording.
 * Past classes include ones from an earlier batch of the same course, before a switch.
 */
export async function learnerLive(actor: Actor, enrolmentId: string, now = new Date()): Promise<LearnerLive> {
  assertCan(actor, "self.join_class", own(actor));
  return withTenant(actor, async (tx) => {
    const mine = (await studentEnrolments(tx, actor.userId)).find((e) => e.enrolmentId === enrolmentId);
    if (!mine || (mine.status !== "active" && mine.status !== "completed")) throw new NotFoundError("Course");
    const clock = await clockFor(tx, now);
    const threshold = await thresholdFor(tx);
    const [sched] = await scheduledBatches(tx, [mine.batchId]);
    if (!sched) throw new NotFoundError("Batch");
    const active = mine.status === "active";

    // Upcoming: the next two weeks of the current batch.
    const ahead = active ? sessionsOf([sched], clock.today, addDays(clock.today, 14), clock).filter((s) => s.state !== "ended") : [];
    const { live: liveAhead } = await rowsFor(tx, [mine.batchId], clock.today, addDays(clock.today, 14));
    const upcoming = ahead.slice(0, 6).map((s) => {
      const l = liveAhead.get(sessionKey(s.batchId, s.date, s.startTime));
      return { ...s, joinable: canJoinAt(s.window, now), hasLink: !!meetingLinkFor(l, sched.joinUrl ?? null) };
    });

    // Past: every batch of this course the student has attendance in, plus their current batch.
    const courseBatchIds = (await tx.select({ id: batches.id }).from(batches).where(eq(batches.courseId, mine.courseId))).map((b) => b.id);
    const myRows = await tx
      .select()
      .from(liveAttendance)
      .where(and(eq(liveAttendance.userId, actor.userId), inArray(liveAttendance.batchId, courseBatchIds)));
    const batchIds = [...new Set([mine.batchId, ...myRows.map((r) => r.batchId)])];
    const scheds = await scheduledBatches(tx, batchIds);
    const from = scheds.reduce((d, b) => (b.startDate < d ? b.startDate : d), clock.today);
    const sessions = sessionsOf(scheds, from, clock.today, clock).filter((s) => s.state === "ended" || s.state === "live");
    const [{ live, attendance }, rosters] = await Promise.all([rowsFor(tx, batchIds, from, clock.today), rostersOf(tx, [mine.batchId])]);
    const me = (rosters.get(mine.batchId) ?? []).filter((m) => m.userId === actor.userId);

    const past: LearnerPast[] = [];
    let attended = 0;
    let held = 0;
    for (const s of sessions) {
      const k = sessionKey(s.batchId, s.date, s.startTime);
      const ev = evaluateSession(s, live.get(k), attendance.get(k), s.batchId === mine.batchId ? me : []);
      const entry = ev.entries.find((e) => e.userId === actor.userId);
      if (!entry || (!entry.row && !entry.expected)) continue;
      if (s.state === "live" && !entry.row) continue;
      if (ev.counts && entry.status) {
        held++;
        if (entry.status !== "absent") attended++;
      }
      past.push({
        batchId: s.batchId,
        batchName: s.batchName,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        status: entry.status,
        joinedAt: entry.row?.firstJoinedAt ?? null,
        note: entry.row?.note ?? null,
        recordingUrl: safeMeetingUrl(ev.live?.recordingUrl),
        kind: s.kind,
      });
    }
    past.reverse();
    return { tz: clock.tz, today: clock.today, active, upcoming, past: past.slice(0, 40), attended, held, percent: percent(attended, held), threshold };
  });
}

/* ─────────────── Learner home: join next ─────────────── */

export type JoinNext = {
  session: ClassSession;
  courseTitle: string;
  joinable: boolean;
  hasLink: boolean;
  joinedAt: Date | null;
  tz: string;
  today: string;
  enrolmentId: string;
};

/** A class of the student's that is on now or starts within two hours, for the home card. */
export async function joinNext(actor: Actor, now = new Date()): Promise<JoinNext | null> {
  assertCan(actor, "self.join_class", own(actor));
  return withTenant(actor, async (tx) => {
    const enrolments = (await studentEnrolments(tx, actor.userId)).filter((e) => e.status === "active");
    if (enrolments.length === 0) return null;
    const clock = await clockFor(tx, now);
    const scheds = await scheduledBatches(tx, enrolments.map((e) => e.batchId));
    const horizon = now.getTime() + JOIN_NEXT_WINDOW_MINUTES * 60_000;
    const candidates = sessionsOf(scheds, addDays(clock.today, -1), addDays(clock.today, 1), clock).filter(
      (s) => s.state === "open" || s.state === "live" || (s.state === "upcoming" && s.window.startsAt.getTime() <= horizon),
    );
    const s = candidates[0];
    if (!s) return null;
    const [mine] = await tx
      .select({ firstJoinedAt: liveAttendance.firstJoinedAt })
      .from(liveAttendance)
      .where(
        and(
          eq(liveAttendance.batchId, s.batchId),
          eq(liveAttendance.date, s.date),
          eq(liveAttendance.startTime, s.startTime),
          eq(liveAttendance.userId, actor.userId),
        ),
      );
    const l = await liveRowFor(tx, s);
    const [c] = await tx.select({ title: courses.title }).from(courses).where(eq(courses.id, s.courseId));
    return {
      session: s,
      courseTitle: c?.title ?? s.courseTitle,
      joinable: canJoinAt(s.window, now),
      hasLink: !!meetingLinkFor(l, scheds.find((b) => b.batchId === s.batchId)?.joinUrl ?? null),
      joinedAt: mine?.firstJoinedAt ?? null,
      tz: clock.tz,
      today: clock.today,
      enrolmentId: enrolments.find((e) => e.batchId === s.batchId)!.enrolmentId,
    };
  });
}

/** The student's own attendance rows, newest first (for tests and the learner tab). */
export async function myAttendance(actor: Actor, batchId: string) {
  assertCan(actor, "self.join_class", own(actor));
  return withTenant(actor, (tx) =>
    tx
      .select()
      .from(liveAttendance)
      .where(and(eq(liveAttendance.userId, actor.userId), eq(liveAttendance.batchId, batchId)))
      .orderBy(desc(liveAttendance.date), desc(liveAttendance.startTime)),
  );
}
