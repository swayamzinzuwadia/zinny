/**
 * Leaderboards by batch or by course, for this week, this month or all time
 * (brief: "Must have" 5). A board counts the XP students earned in that batch or
 * course; everyone currently in it is listed, with 0 XP if they haven't earned any.
 * Ties share a rank. Staff see full names; students see the university's choice.
 */
import { and, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batchStudentIds, can, peopleLite, reach, todayFor, withTenant, type Actor } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import { asPeriod, PERIODS, type Period } from "./catalog";
import { batchTarget, courseTargetFrom, directory, holdsAnywhere, uni, type Directory } from "./scope";
import { gamXpLedger, type NameDisplay } from "./schema";
import { displayName, periodStart, rankRows } from "./util";

export type BoardScope = { kind: "batch" | "course"; id: string };

export function parseScope(v: string | undefined | null): BoardScope | null {
  const m = /^(batch|course):([0-9a-f-]{36})$/i.exec(v ?? "");
  return m ? { kind: m[1] as BoardScope["kind"], id: m[2].toLowerCase() } : null;
}

export const scopeKey = (s: BoardScope) => `${s.kind}:${s.id}`;

export type BoardRow = { userId: string; name: string; points: number; rank: number };

export function periodLabel(p: Period) {
  return PERIODS.find((x) => x.key === p)!.label;
}

export function batchesOf(dir: Directory, scope: BoardScope): string[] {
  return scope.kind === "batch" ? [scope.id] : [...dir.batches.values()].filter((b) => b.courseId === scope.id).map((b) => b.id);
}

/** XP per student on a board since `from` (null = all time), including current students with none. */
export async function boardPoints(tx: Tx, scope: BoardScope, dir: Directory, from: string | null): Promise<Map<string, number>> {
  const members = (await Promise.all(batchesOf(dir, scope).map((id) => batchStudentIds(tx, id)))).flat();
  const rows = await tx
    .select({ userId: gamXpLedger.userId, points: sql<number>`sum(${gamXpLedger.points})::int` })
    .from(gamXpLedger)
    .where(
      and(
        scope.kind === "batch" ? eq(gamXpLedger.batchId, scope.id) : eq(gamXpLedger.courseId, scope.id),
        from ? gte(gamXpLedger.awardDate, from) : undefined,
      ),
    )
    .groupBy(gamXpLedger.userId);
  const out = new Map<string, number>(members.map((m) => [m, 0]));
  for (const r of rows) out.set(r.userId, r.points);
  return out;
}

/** Ranked rows. `names` = "staff" for full names, or the university's display setting. */
export async function rankedBoard(tx: Tx, scope: BoardScope, dir: Directory, from: string | null, names: NameDisplay | "staff"): Promise<BoardRow[]> {
  const points = await boardPoints(tx, scope, dir, from);
  const people = await peopleLite(tx, [...points.keys()]);
  return rankRows(
    people.map((p) => ({ userId: p.id, name: names === "staff" ? p.name : displayName(p.name, names), points: points.get(p.id) ?? 0 })),
  );
}

export function scopeTitle(dir: Directory, scope: BoardScope): { title: string; subtitle: string } {
  if (scope.kind === "course") return { title: dir.courses.get(scope.id)?.title ?? "Course", subtitle: "Whole course" };
  const b = dir.batches.get(scope.id);
  return { title: b ? (dir.courses.get(b.courseId)?.title ?? "Course") : "Batch", subtitle: b?.name ?? "" };
}

/* ───────────────────────────── Staff ───────────────────────────── */

export type BoardOption = { scope: BoardScope; label: string };
export type BoardOptionGroup = { courseId: string; courseTitle: string; options: BoardOption[] };

/** Courses and batches whose leaderboard the viewer may open. */
export function boardOptions(actor: Actor, dir: Directory): BoardOptionGroup[] {
  const u = uni(actor);
  const groups: BoardOptionGroup[] = [];
  const courses = [...dir.courses.values()].filter((c) => c.status !== "draft").sort((a, b) => a.title.localeCompare(b.title));
  for (const c of courses) {
    const options: BoardOption[] = [];
    if (can(actor, "leaderboard.view", courseTargetFrom(u, dir, c.id))) options.push({ scope: { kind: "course", id: c.id }, label: `${c.title}: whole course` });
    const batches = [...dir.batches.values()]
      .filter((b) => b.courseId === c.id && b.status !== "draft" && can(actor, "leaderboard.view", batchTarget(u, b)))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name));
    for (const b of batches) options.push({ scope: { kind: "batch", id: b.id }, label: `${c.title}: ${b.name}` });
    if (options.length) groups.push({ courseId: c.id, courseTitle: c.title, options });
  }
  return groups;
}

export async function staffLeaderboard(actor: Actor, opts: { scope?: string | null; period?: string | null } = {}) {
  if (!holdsAnywhere(actor, "leaderboard.view")) throw new ForbiddenError();
  const period = asPeriod(opts.period, "week");
  return withTenant(actor, async (tx) => {
    const [dir, today] = await Promise.all([directory(tx), todayFor(tx)]);
    const groups = boardOptions(actor, dir);
    const all = groups.flatMap((g) => g.options);
    const wanted = parseScope(opts.scope);
    const picked = (wanted && all.find((o) => scopeKey(o.scope) === scopeKey(wanted))) ?? all[0] ?? null;
    if (!picked) return { period, today, groups, selected: null, rows: [] as BoardRow[], totals: { points: 0, earners: 0 } };
    const rows = await rankedBoard(tx, picked.scope, dir, periodStart(today, period), "staff");
    return {
      period,
      today,
      groups,
      selected: { ...picked, ...scopeTitle(dir, picked.scope) },
      rows,
      totals: { points: rows.reduce((n, r) => n + r.points, 0), earners: rows.filter((r) => r.points > 0).length },
    };
  });
}

/**
 * Top learners across everything the viewer can see (dashboard card): the whole
 * university for an admin, their department for a HOD, their batches for faculty.
 */
export async function topLearners(actor: Actor, opts: { period?: Period; limit?: number } = {}) {
  if (!holdsAnywhere(actor, "leaderboard.view")) throw new ForbiddenError();
  const period = opts.period ?? "week";
  const limit = opts.limit ?? 5;
  const r = reach(actor, "leaderboard.view", uni(actor));
  return withTenant(actor, async (tx) => {
    const today = await todayFor(tx);
    const from = periodStart(today, period);
    const scoped: SQL[] = [];
    if (!r.all) {
      if (r.departmentIds.size) scoped.push(inArray(gamXpLedger.departmentId, [...r.departmentIds]));
      if (r.batchIds.size) scoped.push(inArray(gamXpLedger.batchId, [...r.batchIds]));
    }
    const where = and(from ? gte(gamXpLedger.awardDate, from) : undefined, r.all ? undefined : or(...scoped));
    const sums = await tx
      .select({ userId: gamXpLedger.userId, points: sql<number>`sum(${gamXpLedger.points})::int` })
      .from(gamXpLedger)
      .where(where)
      .groupBy(gamXpLedger.userId)
      .orderBy(desc(sql`sum(${gamXpLedger.points})`))
      .limit(limit * 3);
    const people = await peopleLite(tx, sums.map((s) => s.userId));
    const points = new Map(sums.map((s) => [s.userId, s.points]));
    const ranked = rankRows(people.map((p) => ({ userId: p.id, name: p.name, points: points.get(p.id) ?? 0 })));
    // Keep everyone tied with the last place shown, so a tie never hides someone arbitrarily.
    const cut = ranked[limit - 1]?.points;
    const rows = ranked.filter((x, i) => i < limit || x.points === cut).slice(0, limit * 2);
    const [{ total, earners }] = await tx
      .select({ total: sql<number>`coalesce(sum(${gamXpLedger.points}), 0)::int`, earners: sql<number>`count(distinct ${gamXpLedger.userId})::int` })
      .from(gamXpLedger)
      .where(where);
    return { period, rows, total, earners };
  });
}
