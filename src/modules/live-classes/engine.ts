/**
 * The shared engine behind every live-classes screen, job and report. Internal to the
 * module: functions here take an open tenant transaction and never check permissions;
 * the service functions that call them do.
 *
 * Sessions come from the timetable (core `scheduledBatches` + `expandSessions`), so a
 * cancelled class doesn't exist here and a moved class exists on its new date. This
 * module's rows only add to a session; rows for a session that has since left the
 * timetable (cancelled after the fact) are ignored everywhere.
 *
 * Effective status of a student in a session:
 *   - their attendance row's status, when there is one;
 *   - otherwise, once a recorded class has ended and they were in the batch when it
 *     started: absent (the hourly job writes these rows; until then they count anyway);
 *   - otherwise none (the class is still on, or they joined the batch afterwards).
 * A session is "recorded" when its class was started from Zinny, a student joined
 * through Zinny, staff took attendance, or its register was locked. Only recorded classes
 * that have started count towards percentages, so a batch that doesn't use live classes
 * (or a class held elsewhere, with only a recording link added) never shows 0%.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batchSwitchRequests, enrolments } from "@/db/schema";
import { batchLite, expandSessions, scheduledBatches, universityLite, type BatchLite, type ScheduledBatch, type Session } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { liveAttendance, liveSessions, liveSettings } from "./schema";
import {
  DEFAULT_THRESHOLD_PERCENT,
  hhmm,
  isUuid,
  localDate,
  percent,
  pickSession,
  safeMeetingUrl,
  sessionState,
  sessionWindow,
  type AttendanceStatus,
  type SessionState,
  type SessionWindow,
} from "./time";

export type LiveSessionRow = typeof liveSessions.$inferSelect;
export type AttendanceRow = typeof liveAttendance.$inferSelect;

/** A timetable session with times as "HH:MM", its join window and its state now. */
export type ClassSession = Omit<Session, "startTime" | "endTime"> & {
  startTime: string;
  endTime: string;
  window: SessionWindow;
  state: SessionState;
};

export const sessionKey = (batchId: string, date: string, startTime: string) => `${batchId}|${date}|${hhmm(startTime)}`;

export function toClassSession(s: Session, tz: string, now: Date): ClassSession {
  const startTime = hhmm(s.startTime);
  const endTime = hhmm(s.endTime);
  const window = sessionWindow({ date: s.date, startTime, endTime }, tz);
  return { ...s, startTime, endTime, window, state: sessionState(window, now) };
}

export type Clock = { tz: string; now: Date; today: string };

export async function clockFor(tx: Tx, now = new Date()): Promise<Clock> {
  const { timezone } = await universityLite(tx);
  return { tz: timezone, now, today: localDate(now, timezone) };
}

export async function thresholdFor(tx: Tx): Promise<number> {
  const [row] = await tx.select({ t: liveSettings.thresholdPercent }).from(liveSettings);
  return row?.t ?? DEFAULT_THRESHOLD_PERCENT;
}

/* ─────────────── Batches and their timetable ─────────────── */

export type LoadedBatch = { batch: BatchLite; sched: ScheduledBatch & { status: string; departmentId: string; seatLimit: number } };

/** A batch and its timetable. Unknown or other universities' batches are "not found". */
export async function loadBatch(tx: Tx, batchId: string): Promise<LoadedBatch> {
  if (!isUuid(batchId)) throw new NotFoundError("Batch");
  const batch = await batchLite(tx, batchId);
  const [sched] = await scheduledBatches(tx, [batchId]);
  if (!sched) throw new NotFoundError("Batch");
  return { batch, sched };
}

export function sessionsOf(scheds: ScheduledBatch[], from: string, to: string, clock: Clock): ClassSession[] {
  if (from > to) return [];
  return expandSessions(scheds, from, to).map((s) => toClassSession(s, clock.tz, clock.now));
}

export type Resolution =
  | { ok: true; session: ClassSession; sameDay: ClassSession[] }
  | { ok: false; reason: "cancelled"; note: string | null }
  | { ok: false; reason: "moved"; to: { date: string; startTime: string; endTime: string }; note: string | null }
  | { ok: false; reason: "no_class"; sameDay: ClassSession[] };

/**
 * The class a (batch, date, start time) reference points at. Without a start time, the
 * class joinable now, else the next to open, else the day's last. A cancelled or moved
 * class says so, with where it went.
 */
export function resolveSession(sched: ScheduledBatch, date: string, start: string | null | undefined, clock: Clock): Resolution {
  const sameDay = sessionsOf([sched], date, date, clock);
  const picked = pickSession(sameDay, clock.now, clock.tz, start ? hhmm(start) : null);
  if (picked) return { ok: true, session: picked, sameDay };
  if (sameDay.length === 0) {
    const overrides = (sched.overrides ?? []).filter((o) => o.date === date);
    const moved = overrides.find((o) => o.kind === "rescheduled" && o.newDate && o.startTime && o.endTime);
    if (moved) {
      return { ok: false, reason: "moved", to: { date: moved.newDate!, startTime: hhmm(moved.startTime!), endTime: hhmm(moved.endTime!) }, note: moved.note };
    }
    const cancelled = overrides.find((o) => o.kind === "cancelled");
    if (cancelled) return { ok: false, reason: "cancelled", note: cancelled.note };
  }
  return { ok: false, reason: "no_class", sameDay };
}

/** The link students are sent to: this class's own link first, else the batch's. Web links only. */
export function meetingLinkFor(live: LiveSessionRow | undefined, batchMeetingUrl: string | null): string | null {
  return safeMeetingUrl(live?.meetingUrl) ?? safeMeetingUrl(batchMeetingUrl);
}

/* ─────────────── Live rows ─────────────── */

/**
 * The live_sessions row for a session, created if missing, and locked: `share` lets many
 * students join at once while keeping a lock or unlock out; `update` is for lock and unlock.
 */
export async function ensureLiveSession(
  tx: Tx,
  universityId: string,
  s: { batchId: string; date: string; startTime: string },
  lock: "share" | "update",
): Promise<LiveSessionRow> {
  await tx
    .insert(liveSessions)
    .values({ universityId, batchId: s.batchId, date: s.date, startTime: hhmm(s.startTime) })
    .onConflictDoNothing({ target: [liveSessions.batchId, liveSessions.date, liveSessions.startTime] });
  const [row] = await tx
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.batchId, s.batchId), eq(liveSessions.date, s.date), eq(liveSessions.startTime, hhmm(s.startTime))))
    .for(lock);
  return row;
}

export async function liveRowFor(tx: Tx, s: { batchId: string; date: string; startTime: string }): Promise<LiveSessionRow | undefined> {
  const [row] = await tx
    .select()
    .from(liveSessions)
    .where(and(eq(liveSessions.batchId, s.batchId), eq(liveSessions.date, s.date), eq(liveSessions.startTime, hhmm(s.startTime))));
  return row;
}

/** live_sessions and attendance rows of some batches between two dates, keyed by session. */
export async function rowsFor(tx: Tx, batchIds: string[], from: string, to: string) {
  const live = new Map<string, LiveSessionRow>();
  const attendance = new Map<string, Map<string, AttendanceRow>>();
  if (batchIds.length === 0 || from > to) return { live, attendance };
  const [ls, as] = await Promise.all([
    tx
      .select()
      .from(liveSessions)
      .where(and(inArray(liveSessions.batchId, batchIds), gte(liveSessions.date, from), lte(liveSessions.date, to))),
    tx
      .select()
      .from(liveAttendance)
      .where(and(inArray(liveAttendance.batchId, batchIds), gte(liveAttendance.date, from), lte(liveAttendance.date, to))),
  ]);
  for (const r of ls) live.set(sessionKey(r.batchId, r.date, r.startTime), r);
  for (const r of as) {
    const k = sessionKey(r.batchId, r.date, r.startTime);
    let m = attendance.get(k);
    if (!m) attendance.set(k, (m = new Map()));
    m.set(r.userId, r);
  }
  return { live, attendance };
}

/* ─────────────── Rosters ─────────────── */

/** A student active in the batch now, and when they joined it (enrolled, or switched in). */
export type Member = { userId: string; since: Date };

/**
 * Students active in each batch, with the moment they joined that batch: their latest
 * approved switch into it, else when they enrolled. Automatic absences only apply to
 * classes that started after that moment, so nobody is marked absent for a class held
 * before they were in the batch.
 */
export async function rostersOf(tx: Tx, batchIds: string[]): Promise<Map<string, Member[]>> {
  const out = new Map<string, Member[]>(batchIds.map((id) => [id, []]));
  if (batchIds.length === 0) return out;
  const rows = await tx
    .select({ id: enrolments.id, userId: enrolments.userId, batchId: enrolments.batchId, enrolledAt: enrolments.enrolledAt, createdAt: enrolments.createdAt })
    .from(enrolments)
    .where(and(inArray(enrolments.batchId, batchIds), eq(enrolments.status, "active")));
  const switches = rows.length
    ? await tx
        .select({ enrolmentId: batchSwitchRequests.enrolmentId, toBatchId: batchSwitchRequests.toBatchId, decidedAt: batchSwitchRequests.decidedAt })
        .from(batchSwitchRequests)
        .where(and(inArray(batchSwitchRequests.enrolmentId, rows.map((r) => r.id)), eq(batchSwitchRequests.status, "approved")))
    : [];
  for (const r of rows) {
    const switchedIn = switches
      .filter((s) => s.enrolmentId === r.id && s.toBatchId === r.batchId && s.decidedAt)
      .map((s) => s.decidedAt!.getTime());
    const since = switchedIn.length ? new Date(Math.max(...switchedIn)) : (r.enrolledAt ?? r.createdAt);
    out.get(r.batchId)!.push({ userId: r.userId, since });
  }
  return out;
}

/** Was the student in the batch when the class started? */
export const expectedAt = (m: Member, s: ClassSession) => m.since.getTime() <= s.window.startsAt.getTime();

/* ─────────────── Effective statuses and percentages ─────────────── */

export type Entry = {
  userId: string;
  /** Null: not joined yet (class still on), or joined the batch after this class. */
  status: AttendanceStatus | null;
  row: AttendanceRow | null;
  /** In the batch when the class started. */
  expected: boolean;
  /** Still active in the batch. */
  current: boolean;
};

/** Started from Zinny, joined through Zinny, attendance taken, or locked. */
export function isRecorded(live: LiveSessionRow | undefined | null, rows: Map<string, AttendanceRow> | undefined): boolean {
  return !!live && (live.startedAt !== null || live.lockedAt !== null || (rows?.size ?? 0) > 0);
}

export type EvaluatedSession = ClassSession & {
  key: string;
  live: LiveSessionRow | null;
  recorded: boolean;
  /** Recorded and started: counts towards percentages. */
  counts: boolean;
  entries: Entry[];
  present: number;
  late: number;
  absent: number;
  /** Students with no status yet while the class is on. */
  pending: number;
  /** Everyone this class is out of: rows plus expected students. */
  total: number;
  /** Present and late, as a share of those with a status (or of everyone expected while live). */
  percent: number | null;
};

export function evaluateSession(
  s: ClassSession,
  live: LiveSessionRow | undefined,
  rows: Map<string, AttendanceRow> | undefined,
  roster: Member[],
): EvaluatedSession {
  const key = sessionKey(s.batchId, s.date, s.startTime);
  const started = s.state === "live" || s.state === "ended";
  const recorded = isRecorded(live, rows);
  const entries = new Map<string, Entry>();
  for (const [userId, row] of rows ?? []) entries.set(userId, { userId, status: row.status, row, expected: true, current: false });
  for (const m of roster) {
    const expected = expectedAt(m, s);
    const e = entries.get(m.userId);
    if (e) {
      e.current = true;
      continue;
    }
    const status: AttendanceStatus | null = expected && recorded && s.state === "ended" ? "absent" : null;
    entries.set(m.userId, { userId: m.userId, status, row: null, expected, current: true });
  }
  const list = [...entries.values()];
  const count = (st: AttendanceStatus) => list.filter((e) => e.status === st).length;
  const present = count("present");
  const late = count("late");
  const absent = count("absent");
  const pending = list.filter((e) => e.status === null && e.expected).length;
  const total = present + late + absent + pending;
  return {
    ...s,
    key,
    live: live ?? null,
    recorded,
    counts: recorded && started,
    entries: list,
    present,
    late,
    absent,
    pending,
    total,
    percent: recorded && started ? percent(present + late, total) : null,
  };
}

export type StudentTally = { userId: string; held: number; present: number; late: number; absent: number; percent: number | null };

/** Per-student totals over the sessions that count. */
export function tallyStudents(sessions: EvaluatedSession[], userIds?: Iterable<string>): Map<string, StudentTally> {
  const out = new Map<string, StudentTally>();
  const get = (userId: string) => {
    let t = out.get(userId);
    if (!t) out.set(userId, (t = { userId, held: 0, present: 0, late: 0, absent: 0, percent: null }));
    return t;
  };
  for (const id of userIds ?? []) get(id);
  for (const s of sessions) {
    if (!s.counts) continue;
    for (const e of s.entries) {
      if (!e.status) continue;
      const t = get(e.userId);
      t.held++;
      t[e.status]++;
    }
  }
  for (const t of out.values()) t.percent = percent(t.present + t.late, t.held);
  return out;
}

/** Everything about some batches' classes between two dates, evaluated. */
export async function evaluateBatches(tx: Tx, scheds: ScheduledBatch[], from: string, to: string, clock: Clock) {
  const batchIds = scheds.map((s) => s.batchId);
  const sessions = sessionsOf(scheds, from, to, clock);
  const [{ live, attendance }, rosters] = await Promise.all([rowsFor(tx, batchIds, from, to), rostersOf(tx, batchIds)]);
  const evaluated = sessions.map((s) => {
    const k = sessionKey(s.batchId, s.date, s.startTime);
    return evaluateSession(s, live.get(k), attendance.get(k), rosters.get(s.batchId) ?? []);
  });
  return { sessions: evaluated, rosters };
}
