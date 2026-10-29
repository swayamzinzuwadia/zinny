/**
 * The learner's side (brief: "Must have" 7): my XP, my rank in each of my batches,
 * my badges and my challenges. Every function checks self.view_xp on the viewer's own
 * record, and a learner only ever sees boards of batches and courses they belong to.
 */
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, studentEnrolments, todayFor, withTenant, type Actor, type StudentEnrolment } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import { asPeriod, METRICS, type Period } from "./catalog";
import { challengeGoal, challengeStatus, scopeLabel, standings, type StandingRow } from "./challenges";
import { criterion } from "./badges";
import { rankedBoard, scopeTitle, type BoardRow, type BoardScope } from "./leaderboards";
import { metricValueFor } from "./metrics";
import { directory, uni, type Directory } from "./scope";
import { gamBadgeAwards, gamBadges, gamChallenges, gamXpLedger, type Badge, type NameDisplay } from "./schema";
import { nameDisplayIn } from "./settings";
import { addDays, daysBetween, periodStart } from "./util";

function assertSelf(actor: Actor) {
  assertCan(actor, "self.view_xp", { universityId: uni(actor), ownerUserId: actor.userId });
}

async function myEnrolments(tx: Tx, actor: Actor): Promise<StudentEnrolment[]> {
  return (await studentEnrolments(tx, actor.userId)).filter((e) => e.status === "active" || e.status === "completed");
}

async function totals(tx: Tx, userId: string, today: string) {
  const week = periodStart(today, "week")!;
  const month = periodStart(today, "month")!;
  const [row] = await tx
    .select({
      total: sql<number>`coalesce(sum(${gamXpLedger.points}), 0)::int`,
      week: sql<number>`coalesce(sum(${gamXpLedger.points}) filter (where ${gamXpLedger.awardDate} >= ${week}), 0)::int`,
      month: sql<number>`coalesce(sum(${gamXpLedger.points}) filter (where ${gamXpLedger.awardDate} >= ${month}), 0)::int`,
      todayXp: sql<number>`coalesce(sum(${gamXpLedger.points}) filter (where ${gamXpLedger.awardDate} = ${today}), 0)::int`,
    })
    .from(gamXpLedger)
    .where(eq(gamXpLedger.userId, userId));
  return row;
}

export type MyBadge = Badge & { criterion: string; earnedAt: Date | null; value: number; isNew: boolean };

/** Badges that apply to me (university-wide, or my departments), earned ones first. */
async function myBadges(tx: Tx, userId: string, deptIds: Set<string>, today: string): Promise<MyBadge[]> {
  const [badges, awards] = await Promise.all([
    tx.select().from(gamBadges).orderBy(gamBadges.createdAt),
    tx.select().from(gamBadgeAwards).where(eq(gamBadgeAwards.userId, userId)),
  ]);
  const earned = new Map(awards.map((a) => [a.badgeId, a]));
  const recent = addDays(today, -7);
  const out: MyBadge[] = [];
  for (const b of badges) {
    const a = earned.get(b.id);
    if (!a && !(b.active && (!b.departmentId || deptIds.has(b.departmentId)))) continue;
    const value = a ? a.value : await metricValueFor(tx, b.metric, userId, { departmentId: b.departmentId });
    out.push({ ...b, criterion: criterion(b), earnedAt: a?.awardedAt ?? null, value, isNew: !!a && a.awardedAt.toISOString().slice(0, 10) >= recent });
  }
  return out.sort(
    (x, y) =>
      (x.earnedAt ? 0 : 1) - (y.earnedAt ? 0 : 1) ||
      (x.earnedAt && y.earnedAt ? y.earnedAt.getTime() - x.earnedAt.getTime() : y.value / y.threshold - x.value / x.threshold),
  );
}

export type MyChallenge = {
  id: string;
  title: string;
  description: string;
  goal: string;
  unit: string;
  target: number;
  startDate: string;
  endDate: string;
  status: "upcoming" | "active" | "ended";
  scopeName: string;
  value: number;
  finished: boolean;
  position: number | null;
  finishers: number;
  members: number;
  daysLeft: number | null;
  daysToStart: number | null;
  leaders: StandingRow[];
};

/** Challenges for my batches and courses: running, starting soon, or ended in the last two weeks. */
async function myChallenges(tx: Tx, actor: Actor, enrolments: StudentEnrolment[], dir: Directory, today: string, names: NameDisplay) {
  const batchIds = new Set(enrolments.map((e) => e.batchId));
  const courseIds = new Set(enrolments.map((e) => e.courseId));
  const all = (await tx.select().from(gamChallenges).orderBy(gamChallenges.endDate)).filter(
    (c) => !c.cancelledAt && (c.scope === "batch" ? batchIds.has(c.batchId!) : courseIds.has(c.courseId)) && c.endDate >= addDays(today, -14),
  );
  const out: MyChallenge[] = [];
  for (const c of all) {
    const status = challengeStatus(c, today) as MyChallenge["status"];
    const rows = status === "upcoming" ? [] : await standings(tx, c, dir, names);
    const me = rows.find((r) => r.userId === actor.userId);
    out.push({
      id: c.id,
      title: c.title,
      description: c.description,
      goal: challengeGoal(c),
      unit: METRICS[c.metric].unit(c.target),
      target: c.target,
      startDate: c.startDate,
      endDate: c.endDate,
      status,
      scopeName: scopeLabel(dir, c),
      value: me?.value ?? 0,
      finished: !!me?.reachedAt,
      position: me?.position ?? null,
      finishers: rows.filter((r) => r.reachedAt).length,
      members: rows.length,
      daysLeft: status === "active" ? daysBetween(today, c.endDate) : null,
      daysToStart: status === "upcoming" ? daysBetween(today, c.startDate) : null,
      leaders: rows.filter((r) => r.value > 0).slice(0, 3),
    });
  }
  const order = { active: 0, upcoming: 1, ended: 2 };
  return out.sort((a, b) => order[a.status] - order[b.status]);
}

/** My place on one board. */
function placeOf(rows: BoardRow[], userId: string) {
  const me = rows.find((r) => r.userId === userId);
  return { rank: me?.rank ?? null, of: rows.length, points: me?.points ?? 0 };
}

/* ───────────────────────────── Public ───────────────────────────── */

/** Compact numbers for the home card and the My learning section. */
export async function myXpSummary(actor: Actor) {
  assertSelf(actor);
  return withTenant(actor, async (tx) => {
    const [today, enrolments, dir, names] = await Promise.all([todayFor(tx), myEnrolments(tx, actor), directory(tx), nameDisplayIn(tx)]);
    const deptIds = new Set(enrolments.map((e) => dir.courses.get(e.courseId)?.departmentId).filter((d): d is string => !!d));
    const [sum, badges, challenges] = await Promise.all([
      totals(tx, actor.userId, today),
      myBadges(tx, actor.userId, deptIds, today),
      myChallenges(tx, actor, enrolments, dir, today, names),
    ]);
    const ranks = [];
    for (const e of enrolments.filter((x) => x.status === "active")) {
      const rows = await rankedBoard(tx, { kind: "batch", id: e.batchId }, dir, null, names);
      ranks.push({ enrolmentId: e.enrolmentId, ...scopeTitle(dir, { kind: "batch", id: e.batchId }), ...placeOf(rows, actor.userId) });
    }
    const best = ranks.filter((r) => r.rank !== null && r.points > 0).sort((a, b) => a.rank! - b.rank! || b.points - a.points)[0] ?? null;
    const next = badges.filter((b) => !b.earnedAt).sort((a, b) => b.value / b.threshold - a.value / a.threshold)[0] ?? null;
    return {
      today,
      ...sum,
      badges: { earned: badges.filter((b) => b.earnedAt), total: badges.length, next },
      ranks,
      best,
      challenge: challenges.find((c) => c.status === "active") ?? null,
    };
  });
}

/** Everything on /learn/leaderboard. Ranks use the chosen period. */
export async function myXpPage(actor: Actor, opts: { period?: string | null } = {}) {
  assertSelf(actor);
  const period = asPeriod(opts.period, "all");
  return withTenant(actor, async (tx) => {
    const [today, enrolments, dir, names] = await Promise.all([todayFor(tx), myEnrolments(tx, actor), directory(tx), nameDisplayIn(tx)]);
    const deptIds = new Set(enrolments.map((e) => dir.courses.get(e.courseId)?.departmentId).filter((d): d is string => !!d));
    const from = periodStart(today, period);
    const boards = [];
    for (const e of enrolments) {
      const rows = await rankedBoard(tx, { kind: "batch", id: e.batchId }, dir, from, names);
      boards.push({ enrolmentId: e.enrolmentId, status: e.status, ...scopeTitle(dir, { kind: "batch", id: e.batchId }), ...placeOf(rows, actor.userId) });
    }
    const recent = await tx
      .select({ id: gamXpLedger.id, points: gamXpLedger.points, reason: gamXpLedger.reason, awardDate: gamXpLedger.awardDate, courseId: gamXpLedger.courseId })
      .from(gamXpLedger)
      .where(eq(gamXpLedger.userId, actor.userId))
      .orderBy(desc(gamXpLedger.awardDate), desc(gamXpLedger.occurredAt))
      .limit(12);
    return {
      today,
      period,
      ...(await totals(tx, actor.userId, today)),
      boards,
      badges: await myBadges(tx, actor.userId, deptIds, today),
      challenges: await myChallenges(tx, actor, enrolments, dir, today, names),
      recent: recent.map((r) => ({ ...r, courseTitle: r.courseId ? (dir.courses.get(r.courseId)?.title ?? null) : null })),
    };
  });
}

/**
 * The leaderboard tab of a course hub: my batch's (or whole course's) board, with names as
 * the university chose. Only for a batch I'm in or finished.
 */
export async function learnerBoard(actor: Actor, opts: { batchId: string; board?: string | null; period?: string | null }) {
  assertSelf(actor);
  const period: Period = asPeriod(opts.period, "all");
  return withTenant(actor, async (tx) => {
    const enrolments = await myEnrolments(tx, actor);
    const mine = enrolments.find((e) => e.batchId === opts.batchId);
    if (!mine) throw new ForbiddenError("You can only see leaderboards of batches you're in.");
    const [today, dir, names] = await Promise.all([todayFor(tx), directory(tx), nameDisplayIn(tx)]);
    const scope: BoardScope = opts.board === "course" ? { kind: "course", id: mine.courseId } : { kind: "batch", id: mine.batchId };
    const rows = await rankedBoard(tx, scope, dir, periodStart(today, period), names);
    const challenges = (await myChallenges(tx, actor, [mine], dir, today, names)).filter((c) => c.status !== "ended" || c.finished || c.finishers > 0);
    return {
      period,
      board: scope.kind,
      title: scopeTitle(dir, scope),
      rows,
      me: rows.find((r) => r.userId === actor.userId) ?? null,
      challenges,
      today,
    };
  });
}

/** For tests and the hub: is this learner allowed to see XP at all? */
export function canViewXp(actor: Actor): boolean {
  try {
    assertSelf(actor);
    return true;
  } catch {
    return false;
  }
}
