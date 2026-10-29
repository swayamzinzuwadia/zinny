/**
 * The award path. Every source event goes through processEvent(), both when it is
 * delivered live (events.ts) and when an admin applies a rule to past activity
 * (rules.ts, replaying core domain_events). It is idempotent:
 *
 *   1. record the activity once per (event, student) in gam_activity;
 *   2. for each matching active rule, award XP once per (event, rule, student) and once per
 *      (rule, student, thing earned), within the rule's daily cap, then emit `xp.awarded`;
 *   3. award any badge the student now qualifies for, once, with a notification.
 *
 * Runs inside the caller's tenant transaction and checks no permissions: callers do.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import type { DomainEvent } from "@/contracts/events";
import {
  audit,
  batchLite,
  emit,
  getCourseLite,
  notify,
  peopleLite,
  studentEnrolments,
  universityLite,
  type Actor,
  type StudentEnrolment,
} from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { METRICS } from "./catalog";
import { metricValueFor } from "./metrics";
import { gamActivity, gamBadgeAwards, gamBadges, gamXpLedger, gamXpRules, type ActivityKind, type Badge, type XpRule } from "./schema";
import { dateIn, isIsoDate, isUuid } from "./util";

/* ───────────────────────────── Normalising events ───────────────────────────── */

export type Activity = {
  userId: string;
  kind: ActivityKind;
  subjectKey: string;
  courseId: string | null;
  batchId: string | null;
  /** The class date for attendance; otherwise null (the event's own date is used). */
  date: string | null;
  scorePercent: number | null;
  passed: boolean | null;
  status: "present" | "late" | "absent" | null;
  late: boolean | null;
};

const uuidOrNull = (v: unknown) => (isUuid(v) ? v : null);
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const score = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The activity an event describes, or null when it isn't one we count (or is malformed). */
export function normalise(event: DomainEvent): Activity | null {
  const p = event.payload as unknown as Record<string, unknown>;
  if (!isUuid(p.userId)) return null;
  const base = { userId: p.userId, courseId: null, batchId: null, date: null, scorePercent: null, passed: null, status: null, late: null };
  switch (event.type) {
    case "lesson.completed": {
      const lesson = text(p.lessonId);
      return lesson ? { ...base, kind: "lesson", subjectKey: lesson, courseId: uuidOrNull(p.courseId) } : null;
    }
    case "test.submitted": {
      const test = text(p.testId);
      if (!test) return null;
      return {
        ...base,
        kind: "test",
        subjectKey: test,
        courseId: uuidOrNull(p.courseId),
        batchId: uuidOrNull(p.batchId),
        scorePercent: score(p.scorePercent),
        passed: p.passed === true,
      };
    }
    case "attendance.marked": {
      const batch = uuidOrNull(p.batchId);
      const date = text(p.date);
      const start = text(p.startTime);
      const status = p.status === "present" || p.status === "late" || p.status === "absent" ? p.status : null;
      if (!batch || !date || !isIsoDate(date) || !start || !status) return null;
      return { ...base, kind: "class", subjectKey: `${batch}|${date}|${start.slice(0, 5)}`, batchId: batch, date, status };
    }
    case "assignment.submitted": {
      const a = text(p.assignmentId);
      return a ? { ...base, kind: "assignment_submitted", subjectKey: a, batchId: uuidOrNull(p.batchId), late: p.late === true } : null;
    }
    case "assignment.graded": {
      const a = text(p.assignmentId);
      return a ? { ...base, kind: "assignment_graded", subjectKey: a, batchId: uuidOrNull(p.batchId), scorePercent: score(p.scorePercent) } : null;
    }
    case "enrolment.completed": {
      const e = text(p.enrolmentId);
      return e ? { ...base, kind: "course_completed", subjectKey: e, courseId: uuidOrNull(p.courseId), batchId: uuidOrNull(p.batchId) } : null;
    }
    default:
      return null;
  }
}

/** Does the activity meet the rule's condition? An absence never earns XP. */
export function conditionMet(rule: Pick<XpRule, "condition" | "minScore">, a: Activity): boolean {
  switch (rule.condition) {
    case "none":
      return a.kind !== "class" || a.status === "present" || a.status === "late";
    case "passed":
      return a.passed === true;
    case "min_score":
      return a.scorePercent !== null && rule.minScore !== null && a.scorePercent >= rule.minScore;
    case "present":
      return a.status === "present";
    case "present_or_late":
      return a.status === "present" || a.status === "late";
    case "on_time":
      return a.late === false;
  }
}

/* ───────────────────────────── Context ───────────────────────────── */

/**
 * Lookups reused while processing many events (a replay). The live handler uses a
 * fresh one per event, so it never sees stale rules or enrolments.
 */
export type EngineCache = {
  timezone?: string;
  rules: Map<string, XpRule[]>;
  badges?: Badge[];
  batches: Map<string, { courseId: string; departmentId: string } | null>;
  courses: Map<string, { departmentId: string } | null>;
  enrolments: Map<string, StudentEnrolment[]>;
  members: Map<string, boolean>;
};

export function newCache(): EngineCache {
  return { rules: new Map(), batches: new Map(), courses: new Map(), enrolments: new Map(), members: new Map() };
}

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

async function batchInfo(tx: Tx, id: string, cache: EngineCache) {
  if (!cache.batches.has(id)) {
    const b = await orNull(batchLite(tx, id));
    cache.batches.set(id, b ? { courseId: b.courseId, departmentId: b.departmentId } : null);
  }
  return cache.batches.get(id)!;
}

async function courseInfo(tx: Tx, id: string, cache: EngineCache) {
  if (!cache.courses.has(id)) {
    const c = await orNull(getCourseLite(tx, id));
    cache.courses.set(id, c ? { departmentId: c.departmentId } : null);
  }
  return cache.courses.get(id)!;
}

async function enrolmentsOf(tx: Tx, userId: string, cache: EngineCache) {
  if (!cache.enrolments.has(userId)) cache.enrolments.set(userId, await studentEnrolments(tx, userId));
  return cache.enrolments.get(userId)!;
}

async function isMember(tx: Tx, userId: string, cache: EngineCache) {
  if (!cache.members.has(userId)) cache.members.set(userId, (await peopleLite(tx, [userId])).length === 1);
  return cache.members.get(userId)!;
}

export type ActivityContext = { courseId: string | null; batchId: string | null; departmentId: string | null };

/**
 * Where the activity happened: its course, department, and the student's current batch
 * in that course (so XP follows a batch switch). Unknown ids resolve to null.
 */
export async function resolveContext(tx: Tx, a: Activity, cache: EngineCache): Promise<ActivityContext> {
  let courseId = a.courseId;
  let batchId = a.batchId;
  let departmentId: string | null = null;
  if (batchId) {
    const b = await batchInfo(tx, batchId, cache);
    if (b && (!courseId || courseId === b.courseId)) {
      courseId = b.courseId;
      departmentId = b.departmentId;
    } else {
      batchId = null;
    }
  }
  if (courseId && !departmentId) {
    const c = await courseInfo(tx, courseId, cache);
    if (c) departmentId = c.departmentId;
    else courseId = null;
  }
  if (courseId) {
    const mine = (await enrolmentsOf(tx, a.userId, cache)).filter((e) => e.courseId === courseId);
    const current = mine.find((e) => e.status === "active") ?? mine.find((e) => e.status === "completed");
    if (current) batchId = current.batchId;
  }
  return { courseId, batchId, departmentId };
}

async function rulesFor(tx: Tx, eventType: string, cache: EngineCache): Promise<XpRule[]> {
  if (!cache.rules.has(eventType)) {
    cache.rules.set(
      eventType,
      await tx
        .select()
        .from(gamXpRules)
        .where(and(sql`${gamXpRules.eventType}::text = ${eventType}`, eq(gamXpRules.active, true))),
    );
  }
  return cache.rules.get(eventType)!;
}

/* ───────────────────────────── Processing ───────────────────────────── */

export type ProcessResult = {
  recorded: boolean;
  awards: { ruleId: string; userId: string; points: number }[];
  badges: { badgeId: string; userId: string }[];
};

const EMPTY: ProcessResult = { recorded: false, awards: [], badges: [] };

export type ProcessOptions = {
  /** Only these rules (a replay of one rule). Activity is still recorded. */
  ruleIds?: readonly string[];
  cache?: EngineCache;
};

export async function processEvent(tx: Tx, actor: Actor, event: DomainEvent, opts: ProcessOptions = {}): Promise<ProcessResult> {
  if (!event.universityId) return EMPTY; // Zinny team events have no students
  const a = normalise(event);
  if (!a) return EMPTY;
  const cache = opts.cache ?? newCache();
  if (!(await isMember(tx, a.userId, cache))) return EMPTY;

  const ctx = await resolveContext(tx, a, cache);
  cache.timezone ??= (await universityLite(tx)).timezone;
  const day = a.date ?? dateIn(cache.timezone, event.occurredAt);

  const recorded = await tx
    .insert(gamActivity)
    .values({
      universityId: event.universityId,
      userId: a.userId,
      sourceEventId: event.id,
      kind: a.kind,
      subjectKey: a.subjectKey,
      departmentId: ctx.departmentId,
      courseId: ctx.courseId,
      batchId: ctx.batchId,
      activityDate: day,
      occurredAt: event.occurredAt,
      scorePercent: a.scorePercent,
      passed: a.passed,
      status: a.status,
      late: a.late,
    })
    .onConflictDoNothing()
    .returning({ id: gamActivity.id });

  const awards: ProcessResult["awards"] = [];
  for (const rule of await rulesFor(tx, event.type, cache)) {
    if (opts.ruleIds && !opts.ruleIds.includes(rule.id)) continue;
    if (rule.departmentId && rule.departmentId !== ctx.departmentId) continue;
    if (!conditionMet(rule, a)) continue;
    if (await awardRule(tx, actor, event, rule, a, ctx, day)) awards.push({ ruleId: rule.id, userId: a.userId, points: rule.points });
  }

  const badges =
    recorded.length > 0 || awards.length > 0 ? (await evaluateBadges(tx, a.userId, ctx.departmentId, cache)).map((b) => ({ badgeId: b.id, userId: a.userId })) : [];

  if (awards.length || badges.length) {
    await audit(tx, actor, "gamification.award", "user", a.userId, {
      eventId: event.id,
      eventType: event.type,
      points: awards.reduce((n, x) => n + x.points, 0),
      rules: awards.map((x) => x.ruleId),
      badges: badges.map((b) => b.badgeId),
    });
  }
  return { recorded: recorded.length > 0, awards, badges };
}

/** One rule, one student, one event. Returns true when XP was written. */
async function awardRule(tx: Tx, actor: Actor, event: DomainEvent, rule: XpRule, a: Activity, ctx: ActivityContext, day: string) {
  // Serialise awards of this rule to this student on this day, so the cap holds even
  // when two deliveries run at the same time. Released when the transaction ends.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`gam:${rule.id}:${a.userId}:${day}`}, 0))`);
  if (rule.dailyCap !== null) {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(gamXpLedger)
      .where(and(eq(gamXpLedger.ruleId, rule.id), eq(gamXpLedger.userId, a.userId), eq(gamXpLedger.awardDate, day)));
    if (n >= rule.dailyCap) return false;
  }
  const written = await tx
    .insert(gamXpLedger)
    .values({
      universityId: rule.universityId,
      userId: a.userId,
      ruleId: rule.id,
      sourceEventId: event.id,
      eventType: event.type,
      dedupeKey: `${a.kind}:${a.subjectKey}`,
      points: rule.points,
      reason: rule.name,
      departmentId: ctx.departmentId,
      courseId: ctx.courseId,
      batchId: ctx.batchId,
      awardDate: day,
      occurredAt: event.occurredAt,
    })
    .onConflictDoNothing()
    .returning({ id: gamXpLedger.id });
  if (written.length === 0) return false;
  await emit(tx, actor, "xp.awarded", { userId: a.userId, points: rule.points, reason: rule.name, sourceEventId: event.id });
  return true;
}

/* ───────────────────────────── Badges ───────────────────────────── */

/** Gives the badge once and tells the student. Returns false if they already had it. */
export async function grantBadge(tx: Tx, badge: Badge, userId: string, value: number): Promise<boolean> {
  const rows = await tx
    .insert(gamBadgeAwards)
    .values({ universityId: badge.universityId, badgeId: badge.id, userId, value })
    .onConflictDoNothing()
    .returning({ id: gamBadgeAwards.id });
  if (rows.length === 0) return false;
  await notify(tx, badge.universityId, [userId], {
    kind: "gamification.badge",
    title: `You earned the ${badge.name} badge`,
    body: badge.description || METRICS[badge.metric].badge(badge.threshold),
    data: { badgeId: badge.id },
  });
  return true;
}

/** Awards every active badge the student now qualifies for and doesn't have yet. */
async function evaluateBadges(tx: Tx, userId: string, departmentId: string | null, cache: EngineCache): Promise<Badge[]> {
  cache.badges ??= await tx.select().from(gamBadges).where(eq(gamBadges.active, true));
  const candidates = cache.badges.filter((b) => !b.departmentId || b.departmentId === departmentId);
  if (candidates.length === 0) return [];
  const have = new Set(
    (
      await tx
        .select({ id: gamBadgeAwards.badgeId })
        .from(gamBadgeAwards)
        .where(and(eq(gamBadgeAwards.userId, userId), inArray(gamBadgeAwards.badgeId, candidates.map((b) => b.id))))
    ).map((r) => r.id),
  );
  const earned: Badge[] = [];
  for (const b of candidates) {
    if (have.has(b.id)) continue;
    const value = await metricValueFor(tx, b.metric, userId, { departmentId: b.departmentId });
    if (value >= b.threshold && (await grantBadge(tx, b, userId, value))) earned.push(b);
  }
  return earned;
}

/* ───────────────────────────── Batch switches ───────────────────────────── */

/** XP and activity in a course follow the student to their new batch. Safe to repeat. */
export async function followSwitch(tx: Tx, actor: Actor, event: DomainEvent<"enrolment.switched">) {
  const { userId, courseId, fromBatchId, toBatchId } = event.payload;
  if (![userId, courseId, fromBatchId, toBatchId].every(isUuid)) return;
  const moved = await tx
    .update(gamXpLedger)
    .set({ batchId: toBatchId })
    .where(and(eq(gamXpLedger.userId, userId), eq(gamXpLedger.courseId, courseId), eq(gamXpLedger.batchId, fromBatchId)))
    .returning({ id: gamXpLedger.id });
  await tx
    .update(gamActivity)
    .set({ batchId: toBatchId })
    .where(and(eq(gamActivity.userId, userId), eq(gamActivity.courseId, courseId), eq(gamActivity.batchId, fromBatchId)));
  if (moved.length) await audit(tx, actor, "gamification.follow_switch", "user", userId, { eventId: event.id, fromBatchId, toBatchId, awards: moved.length });
  return moved.length;
}
