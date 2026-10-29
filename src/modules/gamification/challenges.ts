/**
 * Challenges: a time-bound goal (start, end, metric, target) for one batch or one
 * course (brief: "Must have" 4). Progress is live for every student. When a challenge
 * ends, the hourly job freezes its winners (everyone who reached the target, in the
 * order they got there) and tells them.
 */
import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, audit, batchStudentIds, can, notify, peopleLite, todayFor, withTenant, type Actor, type Target } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { CHALLENGE_METRICS, isMetric, METRICS } from "./catalog";
import { batchesOf, parseScope, type BoardScope } from "./leaderboards";
import { metricProgress } from "./metrics";
import { batchTarget, courseTargetFrom, directory, holdsAnywhere, uni, type Directory } from "./scope";
import { gamChallenges, gamChallengeWinners, type Challenge, type NameDisplay } from "./schema";
import { daysBetween, displayName, isIsoDate } from "./util";

export type ChallengeInput = {
  title: string;
  description?: string;
  /** "batch:<id>" or "course:<id>". */
  scope: string;
  metric: string;
  target: number;
  startDate: string;
  endDate: string;
};

export type ChallengeStatus = "upcoming" | "active" | "ended" | "cancelled";

export function challengeStatus(c: Pick<Challenge, "startDate" | "endDate" | "cancelledAt">, today: string): ChallengeStatus {
  if (c.cancelledAt) return "cancelled";
  if (today < c.startDate) return "upcoming";
  if (today > c.endDate) return "ended";
  return "active";
}

export function challengeGoal(c: Pick<Challenge, "metric" | "target">): string {
  return METRICS[c.metric].goal(c.target);
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

const scopeOf = (c: Pick<Challenge, "scope" | "batchId" | "courseId">): BoardScope =>
  c.scope === "batch" ? { kind: "batch", id: c.batchId! } : { kind: "course", id: c.courseId };

export function challengeTarget(universityId: string, dir: Directory, c: Pick<Challenge, "scope" | "batchId" | "courseId" | "departmentId">): Target {
  if (c.scope === "batch") {
    const b = dir.batches.get(c.batchId!);
    return b ? batchTarget(universityId, b) : { universityId, departmentIds: [c.departmentId], batchIds: [c.batchId!] };
  }
  return courseTargetFrom(universityId, dir, c.courseId);
}

export function scopeLabel(dir: Directory, c: Pick<Challenge, "scope" | "batchId" | "courseId">): string {
  const course = dir.courses.get(c.courseId)?.title ?? "Course";
  return c.scope === "batch" ? `${course}, ${dir.batches.get(c.batchId!)?.name ?? "batch"}` : `${course}, whole course`;
}

/* ───────────────────────────── Standings ───────────────────────────── */

export type StandingRow = { userId: string; name: string; value: number; reachedAt: Date | null; position: number | null };

/**
 * Every student in the batch or course (plus anyone with progress there), finishers
 * first in the order they finished. Once a challenge is closed, its frozen winners are
 * the finishers; progress that arrived later doesn't change them.
 */
export async function standings(tx: Tx, c: Challenge, dir: Directory, names: NameDisplay | "staff"): Promise<StandingRow[]> {
  const scope = scopeOf(c);
  const members = (await Promise.all(batchesOf(dir, scope).map((id) => batchStudentIds(tx, id)))).flat();
  // createChallenge only allows CHALLENGE_METRICS; streaks have no running total.
  if (c.metric === "attendance_streak_weeks") throw new ValidationError("This challenge counts something challenges can't track.");
  const progress = await metricProgress(
    tx,
    c.metric,
    { ...(scope.kind === "batch" ? { batchId: scope.id } : { courseId: scope.id }), from: c.startDate, to: c.endDate },
    c.target,
  );
  const winners = c.closedAt
    ? new Map(
        (await tx.select().from(gamChallengeWinners).where(eq(gamChallengeWinners.challengeId, c.id))).map((w) => [w.userId, w]),
      )
    : null;
  const ids = [...new Set([...members, ...progress.keys(), ...(winners?.keys() ?? [])])];
  const people = await peopleLite(tx, ids);
  const rows = people.map((p) => {
    const pr = progress.get(p.id);
    const w = winners?.get(p.id);
    return {
      userId: p.id,
      name: names === "staff" ? p.name : displayName(p.name, names),
      value: w ? Math.max(w.value, pr?.value ?? 0) : (pr?.value ?? 0),
      reachedAt: winners ? (w?.reachedAt ?? null) : (pr?.reachedAt ?? null),
      position: null as number | null,
    };
  });
  rows.sort(
    (a, b) =>
      (a.reachedAt ? 0 : 1) - (b.reachedAt ? 0 : 1) ||
      (a.reachedAt && b.reachedAt ? a.reachedAt.getTime() - b.reachedAt.getTime() : 0) ||
      b.value - a.value ||
      a.name.localeCompare(b.name),
  );
  let pos = 0;
  for (const r of rows) if (r.reachedAt) r.position = ++pos;
  return rows;
}

/* ───────────────────────────── Reading ───────────────────────────── */

async function load(tx: Tx, id: string): Promise<Challenge> {
  const [c] = await tx.select().from(gamChallenges).where(eq(gamChallenges.id, id));
  if (!c) throw new NotFoundError("Challenge");
  return c;
}

/** Challenges the viewer can see, newest first within each group. */
export async function listChallenges(actor: Actor) {
  if (!holdsAnywhere(actor, "leaderboard.view")) throw new ForbiddenError();
  const u = uni(actor);
  return withTenant(actor, async (tx) => {
    const [dir, today] = await Promise.all([directory(tx), todayFor(tx)]);
    const all = (await tx.select().from(gamChallenges).orderBy(desc(gamChallenges.startDate), desc(gamChallenges.createdAt))).filter((c) =>
      can(actor, "leaderboard.view", challengeTarget(u, dir, c)),
    );
    const items = await Promise.all(
      all.map(async (c) => {
        const status = challengeStatus(c, today);
        const rows = status === "active" || status === "ended" ? await standings(tx, c, dir, "staff") : [];
        const members = status === "upcoming" ? (await Promise.all(batchesOf(dir, scopeOf(c)).map((id) => batchStudentIds(tx, id)))).flat().length : rows.length;
        return {
          ...c,
          status,
          goal: challengeGoal(c),
          scopeName: scopeLabel(dir, c),
          members,
          finished: rows.filter((r) => r.reachedAt).length,
          leader: rows[0] && rows[0].value > 0 ? rows[0] : null,
          daysLeft: status === "active" ? daysBetween(today, c.endDate) : null,
          canManage: can(actor, "leaderboard.manage", challengeTarget(u, dir, c)),
        };
      }),
    );
    return {
      today,
      active: items.filter((i) => i.status === "active"),
      upcoming: items.filter((i) => i.status === "upcoming").reverse(),
      ended: items.filter((i) => i.status === "ended" || i.status === "cancelled"),
      scopes: challengeScopes(actor, dir),
    };
  });
}

export async function getChallenge(actor: Actor, id: string) {
  const u = uni(actor);
  return withTenant(actor, async (tx) => {
    const [dir, c, today] = await Promise.all([directory(tx), load(tx, id), todayFor(tx)]);
    const target = challengeTarget(u, dir, c);
    assertCan(actor, "leaderboard.view", target);
    const status = challengeStatus(c, today);
    const rows = status === "upcoming" || status === "cancelled" ? [] : await standings(tx, c, dir, "staff");
    return {
      challenge: c,
      status,
      today,
      goal: challengeGoal(c),
      scopeName: scopeLabel(dir, c),
      unit: METRICS[c.metric].unit(c.target),
      rows,
      winners: status === "ended" ? rows.filter((r) => r.reachedAt) : [],
      daysLeft: status === "active" ? daysBetween(today, c.endDate) : null,
      canManage: can(actor, "leaderboard.manage", target),
    };
  });
}

/** Batches and courses the actor can set a challenge for. */
export function challengeScopes(actor: Actor, dir: Directory) {
  const u = uni(actor);
  const out: { courseTitle: string; options: { value: string; label: string }[] }[] = [];
  for (const c of [...dir.courses.values()].filter((x) => x.status !== "archived").sort((a, b) => a.title.localeCompare(b.title))) {
    const options: { value: string; label: string }[] = [];
    if (can(actor, "leaderboard.manage", courseTargetFrom(u, dir, c.id))) options.push({ value: `course:${c.id}`, label: `${c.title}: whole course` });
    for (const b of [...dir.batches.values()].filter((x) => x.courseId === c.id && x.status !== "archived").sort((a, b) => a.startDate.localeCompare(b.startDate))) {
      if (can(actor, "leaderboard.manage", batchTarget(u, b))) options.push({ value: `batch:${b.id}`, label: `${c.title}: ${b.name}` });
    }
    if (options.length) out.push({ courseTitle: c.title, options });
  }
  return out;
}

/* ───────────────────────────── Writing ───────────────────────────── */

export async function createChallenge(actor: Actor, input: ChallengeInput): Promise<Challenge> {
  const u = uni(actor);
  const scope = parseScope(input.scope);
  if (!scope) throw new ValidationError("Choose the batch or course the challenge is for.");
  return withTenant(actor, async (tx) => {
    const dir = await directory(tx);
    const batch = scope.kind === "batch" ? dir.batches.get(scope.id) : null;
    const course = dir.courses.get(scope.kind === "batch" ? (batch?.courseId ?? "") : scope.id);
    if (!course || (scope.kind === "batch" && !batch)) throw new NotFoundError(scope.kind === "batch" ? "Batch" : "Course");
    const target = batch ? batchTarget(u, batch) : courseTargetFrom(u, dir, course.id);
    assertCan(actor, "leaderboard.manage", target);

    const title = input.title.trim();
    if (title.length < 3 || title.length > 80) throw new ValidationError("Give the challenge a title between 3 and 80 characters.");
    const description = (input.description ?? "").trim();
    if (description.length > 300) throw new ValidationError("Keep the description under 300 characters.");
    if (!isMetric(input.metric) || !CHALLENGE_METRICS.includes(input.metric)) throw new ValidationError("Choose what the challenge counts.");
    const max = input.metric === "xp" ? 1_000_000 : 10_000;
    if (!Number.isInteger(input.target) || input.target < 1 || input.target > max) {
      throw new ValidationError(`The target must be a whole number from 1 to ${max.toLocaleString("en-IN")}.`);
    }
    if (!isIsoDate(input.startDate) || !isIsoDate(input.endDate)) throw new ValidationError("Pick a start date and an end date.");
    if (input.endDate < input.startDate) throw new ValidationError("The end date must be on or after the start date.");
    if (daysBetween(input.startDate, input.endDate) > 365) throw new ValidationError("A challenge can run for a year at most. Pick an earlier end date.");
    const today = await todayFor(tx);
    if (input.endDate < today) throw new ValidationError("The end date has already passed. Pick today or a later date.");

    const [c] = await tx
      .insert(gamChallenges)
      .values({
        universityId: u,
        departmentId: course.departmentId,
        scope: scope.kind,
        courseId: course.id,
        batchId: batch?.id ?? null,
        title,
        description,
        metric: input.metric,
        target: input.target,
        startDate: input.startDate,
        endDate: input.endDate,
        createdBy: actor.userId || null,
      })
      .returning();
    await audit(tx, actor, "gamification.challenge_create", "gam_challenge", c.id, {
      title,
      scope: input.scope,
      metric: input.metric,
      target: input.target,
      startDate: input.startDate,
      endDate: input.endDate,
    });
    return c;
  });
}

export async function cancelChallenge(actor: Actor, id: string): Promise<Challenge> {
  const u = uni(actor);
  return withTenant(actor, async (tx) => {
    const [dir, c, today] = await Promise.all([directory(tx), load(tx, id), todayFor(tx)]);
    assertCan(actor, "leaderboard.manage", challengeTarget(u, dir, c));
    const status = challengeStatus(c, today);
    if (status === "cancelled") return c;
    if (status === "ended") throw new ValidationError("This challenge has already ended, so it can't be cancelled.");
    const [updated] = await tx.update(gamChallenges).set({ cancelledAt: new Date() }).where(eq(gamChallenges.id, id)).returning();
    await audit(tx, actor, "gamification.challenge_cancel", "gam_challenge", id, { title: c.title });
    return updated;
  });
}

/**
 * Job: freezes the winners of every challenge that ended before today and tells them.
 * Runs as the university's system actor. Safe to run again: a closed challenge is skipped.
 */
export async function closeEndedChallenges(actor: Actor): Promise<{ closed: number; winners: number }> {
  const u = uni(actor);
  assertCan(actor, "leaderboard.manage", { universityId: u });
  return withTenant(actor, async (tx) => {
    const [dir, today] = await Promise.all([directory(tx), todayFor(tx)]);
    const due = await tx
      .select()
      .from(gamChallenges)
      .where(and(isNull(gamChallenges.closedAt), isNull(gamChallenges.cancelledAt), lt(gamChallenges.endDate, today)))
      .orderBy(asc(gamChallenges.endDate))
      .for("update", { skipLocked: true });
    let winners = 0;
    for (const c of due) {
      const finished = (await standings(tx, c, dir, "staff")).filter((r) => r.reachedAt);
      if (finished.length) {
        await tx
          .insert(gamChallengeWinners)
          .values(finished.map((r) => ({ universityId: u, challengeId: c.id, userId: r.userId, position: r.position!, value: r.value, reachedAt: r.reachedAt! })))
          .onConflictDoNothing();
      }
      await tx.update(gamChallenges).set({ closedAt: new Date() }).where(eq(gamChallenges.id, c.id));
      for (const r of finished) {
        await notify(tx, u, [r.userId], {
          kind: "gamification.challenge_won",
          title: `You finished the ${c.title} challenge`,
          body: `You were ${ordinal(r.position!)} of ${finished.length} to ${challengeGoal(c).charAt(0).toLowerCase()}${challengeGoal(c).slice(1)}.`,
          data: { challengeId: c.id, position: r.position },
        });
      }
      await audit(tx, actor, "gamification.challenge_close", "gam_challenge", c.id, { winners: finished.length });
      winners += finished.length;
    }
    return { closed: due.length, winners };
  });
}
