/**
 * Faculty, HODs and admins (PRD page 7: "faculty take attendance"): starting a class, the
 * attendance register of one class, per-class links, and the university's threshold.
 *
 * Permissions (contracts.md section 9): `attendance.view` to read, `attendance.mark` to
 * set statuses and lock, `live.manage` to start a class and edit its links. Faculty hold
 * them only on their own batches, and only while their access lasts. Unlocking needs
 * `attendance.mark` from a department or university role: HODs and admins.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, audit, can, emit, peopleLite, reach, withTenant, type Actor, type BatchLite, type PersonLite } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  clockFor,
  ensureLiveSession,
  evaluateSession,
  liveRowFor,
  loadBatch,
  meetingLinkFor,
  resolveSession,
  rostersOf,
  thresholdFor,
  type ClassSession,
  type EvaluatedSession,
  type LiveSessionRow,
  type Resolution,
} from "./engine";
import { liveAttendance, liveSessions, liveSettings } from "./schema";
import { reachesAboveBatch, uniOf } from "./scope";
import { ATTENDANCE_STATUSES, formatDay, formatTime, isIsoDate, safeMeetingUrl, type AttendanceStatus } from "./time";

/** Faculty may open a class this long before it starts (students: 15 minutes). */
export const START_OPENS_MINUTES = 60;
const NOTE_MAX = 300;

export type SessionRef = { batchId: string; date: string; startTime?: string | null };

/** Cancelled and moved classes have no register; a moved one says where it went. */
function refuse(r: Exclude<Resolution, { ok: true }>): never {
  if (r.reason === "cancelled") throw new ConflictError("This class was cancelled, so it has no register.", "cancelled");
  if (r.reason === "moved")
    throw new ConflictError(
      `This class moved to ${formatDay(r.to.date)} at ${formatTime(r.to.startTime)}. Open the register for that day.`,
      "moved",
      { to: r.to },
    );
  throw new NotFoundError("Class");
}

/** Loads the batch, checks the action on it, then resolves the class (so outsiders get "forbidden", not details). */
async function authorisedSession(tx: Tx, actor: Actor, action: "attendance.view" | "attendance.mark" | "live.manage", ref: SessionRef, now: Date) {
  if (!isIsoDate(ref.date)) throw new NotFoundError("Class");
  const { batch, sched } = await loadBatch(tx, ref.batchId);
  assertCan(actor, action, batch.target);
  const clock = await clockFor(tx, now);
  const r = resolveSession(sched, ref.date, ref.startTime, clock);
  if (!r.ok) refuse(r);
  return { batch, courseTitle: sched.courseTitle, session: r.session, sameDay: r.sameDay, clock };
}

/* ─────────────── The register ─────────────── */

export type RegisterEntry = {
  person: PersonLite;
  status: AttendanceStatus | null;
  /** How the status was set: the student joining, staff, or automatically. */
  source: "join" | "staff" | "system" | "auto" | null;
  joinedAt: Date | null;
  joins: number;
  note: string | null;
  markedAt: Date | null;
  markedBy: string | null;
  /** Still active in the batch (false for someone who switched out after this class). */
  current: boolean;
  /** Joined the batch after this class started. */
  lateEnrolment: boolean;
};

export type Register = {
  batch: BatchLite;
  courseTitle: string;
  session: EvaluatedSession;
  sameDay: ClassSession[];
  tz: string;
  today: string;
  meetingUrl: string | null;
  usesBatchLink: boolean;
  recordingUrl: string | null;
  startedAt: Date | null;
  startedBy: string | null;
  lockedAt: Date | null;
  lockedBy: string | null;
  entries: RegisterEntry[];
  canMark: boolean;
  canUnlock: boolean;
  canManage: boolean;
  /** Marking opens when students can join (15 minutes before the start). */
  markable: boolean;
};

/** The attendance register of one class: the roster with automatic statuses. */
export async function register(actor: Actor, ref: SessionRef, now = new Date()): Promise<Register> {
  return withTenant(actor, async (tx) => {
    const { batch, courseTitle, session, sameDay, clock } = await authorisedSession(tx, actor, "attendance.view", ref, now);
    const live = await liveRowFor(tx, session);
    const rows = await tx
      .select()
      .from(liveAttendance)
      .where(and(eq(liveAttendance.batchId, batch.id), eq(liveAttendance.date, session.date), eq(liveAttendance.startTime, session.startTime)));
    const rowMap = new Map(rows.map((r) => [r.userId, r]));
    const roster = (await rostersOf(tx, [batch.id])).get(batch.id) ?? [];
    const ev = evaluateSession(session, live, rowMap, roster);
    const visible = ev.entries.filter((e) => e.row || e.current);
    const names = new Map((await peopleLite(tx, [...visible.map((e) => e.userId), ...rows.flatMap((r) => (r.markedBy ? [r.markedBy] : [])), ...[live?.startedBy, live?.lockedBy].filter((x): x is string => !!x)])).map((p) => [p.id, p]));
    const entries: RegisterEntry[] = visible
      .flatMap((e) => {
        const person = names.get(e.userId);
        if (!person) return [];
        return [
          {
            person,
            status: e.status,
            source: e.row ? e.row.source : e.status ? ("auto" as const) : null,
            joinedAt: e.row?.firstJoinedAt ?? null,
            joins: e.row?.joinCount ?? 0,
            note: e.row?.note ?? null,
            markedAt: e.row && e.row.source !== "join" ? e.row.markedAt : null,
            markedBy: e.row?.markedBy && e.row.source === "staff" ? (names.get(e.row.markedBy)?.name ?? null) : null,
            current: e.current,
            lateEnrolment: !e.expected,
          },
        ];
      })
      .sort((a, b) => a.person.name.localeCompare(b.person.name));
    const own = safeMeetingUrl(live?.meetingUrl);
    return {
      batch,
      courseTitle,
      session: ev,
      sameDay,
      tz: clock.tz,
      today: clock.today,
      meetingUrl: meetingLinkFor(live, batch.meetingUrl),
      usesBatchLink: !own,
      recordingUrl: safeMeetingUrl(live?.recordingUrl),
      startedAt: live?.startedAt ?? null,
      startedBy: live?.startedBy ? (names.get(live.startedBy)?.name ?? null) : null,
      lockedAt: live?.lockedAt ?? null,
      lockedBy: live?.lockedBy ? (names.get(live.lockedBy)?.name ?? null) : null,
      entries,
      canMark: can(actor, "attendance.mark", batch.target),
      canUnlock: reachesAboveBatch(actor, "attendance.mark", batch.departmentId),
      canManage: can(actor, "live.manage", batch.target),
      markable: session.state !== "upcoming",
    };
  });
}

export type Mark = { userId: string; status: AttendanceStatus; note?: string | null };

/**
 * Sets or changes students' statuses in one class, with an optional note. Only students
 * of the batch can be marked: active in it now, or already on this class's register.
 * Refused for a locked register, a cancelled class, and a class that hasn't opened yet.
 * Emits `attendance.marked` for every status that is set or changed.
 */
export async function markAttendance(actor: Actor, ref: SessionRef, marks: Mark[], now = new Date()) {
  if (marks.length === 0) return { changed: 0 };
  for (const m of marks) {
    if (!ATTENDANCE_STATUSES.includes(m.status)) throw new ValidationError("Pick present, late or absent.");
    if ((m.note ?? "").length > NOTE_MAX) throw new ValidationError(`Keep notes under ${NOTE_MAX} characters.`);
  }
  if (new Set(marks.map((m) => m.userId)).size !== marks.length) throw new ValidationError("Each student can be marked once per save.");
  return withTenant(actor, async (tx) => {
    const { batch, session } = await authorisedSession(tx, actor, "attendance.mark", ref, now);
    if (session.state === "upcoming") throw new ConflictError("This class hasn't started yet. Take attendance once it opens, 15 minutes before the start.", "not_started");
    const live = await ensureLiveSession(tx, uniOf(actor), session, "share");
    if (live.lockedAt) throw new ConflictError("This register is locked. Ask a HOD or admin to unlock it first.", "locked");

    const existing = await tx
      .select()
      .from(liveAttendance)
      .where(
        and(
          eq(liveAttendance.batchId, batch.id),
          eq(liveAttendance.date, session.date),
          eq(liveAttendance.startTime, session.startTime),
          inArray(liveAttendance.userId, marks.map((m) => m.userId)),
        ),
      );
    const roster = new Set(((await rostersOf(tx, [batch.id])).get(batch.id) ?? []).map((m) => m.userId));
    const byUser = new Map(existing.map((r) => [r.userId, r]));
    const outsiders = marks.filter((m) => !roster.has(m.userId) && !byUser.has(m.userId));
    if (outsiders.length) throw new ValidationError("Only students of this batch can be marked in its register.", "not_in_batch");

    let changed = 0;
    for (const m of marks) {
      const note = m.note?.trim() || null;
      const before = byUser.get(m.userId);
      if (before && before.status === m.status && (before.note ?? null) === note) continue;
      const [row] = await tx
        .insert(liveAttendance)
        .values({
          universityId: uniOf(actor),
          batchId: batch.id,
          date: session.date,
          startTime: session.startTime,
          userId: m.userId,
          status: m.status,
          source: "staff",
          note,
          markedBy: actor.userId || null,
          markedAt: now,
        })
        .onConflictDoUpdate({
          target: [liveAttendance.batchId, liveAttendance.date, liveAttendance.startTime, liveAttendance.userId],
          set: { status: m.status, source: "staff", note, markedBy: actor.userId || null, markedAt: now },
        })
        .returning({ id: liveAttendance.id });
      await audit(tx, actor, "attendance.mark", "live_attendance", row.id, {
        batchId: batch.id,
        date: session.date,
        startTime: session.startTime,
        userId: m.userId,
        from: before?.status ?? null,
        to: m.status,
        note,
      });
      if (!before || before.status !== m.status) {
        await emit(tx, actor, "attendance.marked", { batchId: batch.id, date: session.date, startTime: session.startTime, userId: m.userId, status: m.status });
      }
      changed++;
    }
    await tx.update(liveSessions).set({ updatedAt: now }).where(eq(liveSessions.id, live.id));
    return { changed };
  });
}

/**
 * Writes "absent" for every student who was in the batch when the class started and has
 * no status, emitting `attendance.marked` for each. Used at lock and by the hourly job.
 */
export async function closeSession(tx: Tx, actor: Actor, batchId: string, session: ClassSession, live: LiveSessionRow, now: Date) {
  const roster = (await rostersOf(tx, [batchId])).get(batchId) ?? [];
  const rows = await tx
    .select({ userId: liveAttendance.userId })
    .from(liveAttendance)
    .where(and(eq(liveAttendance.batchId, batchId), eq(liveAttendance.date, session.date), eq(liveAttendance.startTime, session.startTime)));
  const marked = new Set(rows.map((r) => r.userId));
  const missing = roster.filter((m) => !marked.has(m.userId) && m.since.getTime() <= session.window.startsAt.getTime());
  for (const m of missing) {
    const [row] = await tx
      .insert(liveAttendance)
      .values({
        universityId: live.universityId,
        batchId,
        date: session.date,
        startTime: session.startTime,
        userId: m.userId,
        status: "absent",
        source: "system",
        markedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: liveAttendance.id });
    if (!row) continue;
    await emit(tx, actor, "attendance.marked", { batchId, date: session.date, startTime: session.startTime, userId: m.userId, status: "absent" });
  }
  await tx.update(liveSessions).set({ closedAt: now, updatedAt: now }).where(eq(liveSessions.id, live.id));
  return missing.length;
}

/** Locks the register once the class has started: students without a status become absent. */
export async function lockRegister(actor: Actor, ref: SessionRef, now = new Date()) {
  return withTenant(actor, async (tx) => {
    const { batch, session } = await authorisedSession(tx, actor, "attendance.mark", ref, now);
    if (session.state === "upcoming" || session.state === "open") throw new ConflictError("You can lock the register once the class has started.", "not_started");
    const live = await ensureLiveSession(tx, uniOf(actor), session, "update");
    if (live.lockedAt) return { status: "already_locked" as const, absent: 0 };
    const absent = await closeSession(tx, actor, batch.id, session, live, now);
    await tx.update(liveSessions).set({ lockedAt: now, lockedBy: actor.userId || null, updatedAt: now }).where(eq(liveSessions.id, live.id));
    await audit(tx, actor, "attendance.lock", "live_session", live.id, { batchId: batch.id, date: session.date, startTime: session.startTime, markedAbsent: absent });
    return { status: "locked" as const, absent };
  });
}

/** HOD and admin only: reopens a locked register so it can be corrected. */
export async function unlockRegister(actor: Actor, ref: SessionRef, now = new Date()) {
  return withTenant(actor, async (tx) => {
    const { batch, session } = await authorisedSession(tx, actor, "attendance.view", ref, now);
    if (!reachesAboveBatch(actor, "attendance.mark", batch.departmentId)) throw new ForbiddenError("Only a HOD or admin can unlock a register.");
    const live = await ensureLiveSession(tx, uniOf(actor), session, "update");
    if (!live.lockedAt) return { status: "already_unlocked" as const };
    await tx.update(liveSessions).set({ lockedAt: null, lockedBy: null, updatedAt: now }).where(eq(liveSessions.id, live.id));
    await audit(tx, actor, "attendance.unlock", "live_session", live.id, { batchId: batch.id, date: session.date, startTime: session.startTime, lockedAt: live.lockedAt });
    return { status: "unlocked" as const };
  });
}

/* ─────────────── Starting a class ─────────────── */

export type StartResult = { url: string; firstStart: boolean; session: ClassSession };

/**
 * "Start class": records when the class started (the first start counts) and returns the
 * link to open. From an hour before the start until the end; needs a link.
 */
export async function startClass(actor: Actor, ref: SessionRef, now = new Date()): Promise<StartResult> {
  return withTenant(actor, async (tx) => {
    const { batch, session } = await authorisedSession(tx, actor, "live.manage", ref, now);
    if (session.state === "ended") throw new ConflictError("This class has already ended.", "ended");
    if (session.window.startsAt.getTime() - now.getTime() > START_OPENS_MINUTES * 60_000) {
      throw new ConflictError(`You can start this class from an hour before it begins, at ${formatTime(session.startTime)}.`, "too_early");
    }
    const live = await ensureLiveSession(tx, uniOf(actor), session, "share");
    const url = meetingLinkFor(live, batch.meetingUrl);
    if (!url) throw new ConflictError("This class has no meeting link. Add one for this class, or for the batch on its page.", "no_link");
    const firstStart = !live.startedAt;
    if (firstStart) {
      await tx.update(liveSessions).set({ startedAt: now, startedBy: actor.userId || null, updatedAt: now }).where(eq(liveSessions.id, live.id));
    }
    await audit(tx, actor, "live.start", "live_session", live.id, { batchId: batch.id, date: session.date, startTime: session.startTime, firstStart });
    return { url, firstStart, session };
  });
}

/* ─────────────── Links for one class ─────────────── */

function cleanUrl(raw: string | null | undefined, what: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const safe = safeMeetingUrl(v);
  if (!safe || v.length > 2000) throw new ValidationError(`The ${what} must be a web address starting with https://.`);
  return safe;
}

/** Sets this class's own meeting link (empty = use the batch's) and its recording link. */
export async function updateSessionLinks(actor: Actor, ref: SessionRef, input: { meetingUrl?: string | null; recordingUrl?: string | null }, now = new Date()) {
  const meetingUrl = input.meetingUrl === undefined ? undefined : cleanUrl(input.meetingUrl, "class link");
  const recordingUrl = input.recordingUrl === undefined ? undefined : cleanUrl(input.recordingUrl, "recording link");
  return withTenant(actor, async (tx) => {
    const { batch, session } = await authorisedSession(tx, actor, "live.manage", ref, now);
    if (recordingUrl && session.state === "upcoming") throw new ConflictError("Add the recording after the class has started.", "not_started");
    const live = await ensureLiveSession(tx, uniOf(actor), session, "share");
    const set: Partial<typeof liveSessions.$inferInsert> = { updatedAt: now };
    if (meetingUrl !== undefined) set.meetingUrl = meetingUrl;
    if (recordingUrl !== undefined) set.recordingUrl = recordingUrl;
    await tx.update(liveSessions).set(set).where(eq(liveSessions.id, live.id));
    await audit(tx, actor, "live.update_links", "live_session", live.id, { batchId: batch.id, date: session.date, startTime: session.startTime, meetingUrl, recordingUrl });
  });
}

/* ─────────────── University setting ─────────────── */

export async function attendanceThreshold(actor: Actor): Promise<number> {
  return withTenant(actor, (tx) => thresholdFor(tx));
}

export function canSetThreshold(actor: Actor): boolean {
  return actor.universityId ? reach(actor, "live.manage", actor.universityId).all : false;
}

/** The attendance % below which students are highlighted and alerted. Admins only (whole university). */
export async function setAttendanceThreshold(actor: Actor, value: number) {
  if (!canSetThreshold(actor)) throw new ForbiddenError("Only an Institute Admin can change the attendance threshold.");
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new ValidationError("Enter a whole percentage from 1 to 100, like 75.");
  return withTenant(actor, async (tx) => {
    const before = await thresholdFor(tx);
    await tx
      .insert(liveSettings)
      .values({ universityId: uniOf(actor), thresholdPercent: value, updatedBy: actor.userId || null })
      .onConflictDoUpdate({ target: liveSettings.universityId, set: { thresholdPercent: value, updatedBy: actor.userId || null, updatedAt: new Date() } });
    await audit(tx, actor, "attendance.set_threshold", "live_settings", uniOf(actor), { from: before, to: value });
    return value;
  });
}
