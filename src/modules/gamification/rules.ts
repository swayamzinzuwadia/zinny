/**
 * XP rules: what earns points (brief: "Must have" 1 and 2).
 *
 * A rule is an event, an optional condition, points and an optional daily cap, for the
 * whole university or one department. HODs manage their own department's rules only.
 * Rules are never deleted, only turned off, so the ledger always knows why XP was given.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DomainEvent } from "@/contracts/events";
import { domainEvents } from "@/db/schema";
import { assertCan, audit, can, withTenant, type Actor } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { describeTrigger, SOURCE_EVENTS, triggerByKey, triggerFor } from "./catalog";
import { newCache, processEvent } from "./engine";
import { directory, holdsAnywhere, manageableScopes, scopeTarget, uni, visibleDepartments, canSeeScoped } from "./scope";
import { gamXpLedger, gamXpRules, type TriggerEvent, type XpRule } from "./schema";
import { isUuid } from "./util";

export type RuleInput = {
  name: string;
  /** A key from TRIGGERS, e.g. "test-score". */
  trigger: string;
  minScore?: number | null;
  points: number;
  dailyCap?: number | null;
  /** Null or empty = the whole university. */
  departmentId?: string | null;
};

const whole = (n: unknown) => typeof n === "number" && Number.isInteger(n);

function checkName(name: string) {
  const v = name.trim();
  if (v.length < 2 || v.length > 80) throw new ValidationError("Give the rule a name between 2 and 80 characters, like Lesson finished.");
  return v;
}

function checkPoints(points: number) {
  if (!whole(points) || points < 1 || points > 1000) throw new ValidationError("Points must be a whole number from 1 to 1000.");
  return points;
}

function checkCap(cap: number | null | undefined) {
  if (cap === null || cap === undefined) return null;
  if (!whole(cap) || cap < 1 || cap > 100) throw new ValidationError("The daily cap must be a whole number from 1 to 100. Leave it empty for no cap.");
  return cap;
}

function checkScore(score: number | null | undefined) {
  if (!whole(score) || (score as number) < 1 || (score as number) > 100) throw new ValidationError("Set the minimum score as a whole number from 1 to 100.");
  return score as number;
}

async function loadRule(actor: Actor, ruleId: string): Promise<XpRule> {
  if (!isUuid(ruleId)) throw new NotFoundError("Rule");
  const [rule] = await withTenant(actor, (tx) => tx.select().from(gamXpRules).where(eq(gamXpRules.id, ruleId)));
  if (!rule) throw new NotFoundError("Rule");
  return rule;
}

function assertManage(actor: Actor, departmentId: string | null) {
  const u = uni(actor);
  if (departmentId === null && !can(actor, "leaderboard.manage", { universityId: u })) {
    throw new ForbiddenError("Only an institute admin can change rules for the whole university. Choose your department instead.");
  }
  assertCan(actor, "leaderboard.manage", scopeTarget(u, departmentId));
}

/* ───────────────────────────── Reading ───────────────────────────── */

export async function listRules(actor: Actor) {
  if (!holdsAnywhere(actor, "leaderboard.view")) throw new ForbiddenError();
  return withTenant(actor, async (tx) => {
    const [vis, dir] = await Promise.all([visibleDepartments(tx, actor), directory(tx)]);
    const rules = (await tx.select().from(gamXpRules).orderBy(asc(gamXpRules.createdAt))).filter((r) => canSeeScoped(vis, r.departmentId));
    const stats = rules.length
      ? await tx
          .select({
            ruleId: gamXpLedger.ruleId,
            awards: sql<number>`count(*)::int`,
            points: sql<number>`coalesce(sum(${gamXpLedger.points}), 0)::int`,
            students: sql<number>`count(distinct ${gamXpLedger.userId})::int`,
          })
          .from(gamXpLedger)
          .where(inArray(gamXpLedger.ruleId, rules.map((r) => r.id)))
          .groupBy(gamXpLedger.ruleId)
      : [];
    const byRule = new Map(stats.map((s) => [s.ruleId, s]));
    return {
      rules: rules.map((r) => ({
        ...r,
        trigger: triggerFor(r.eventType, r.condition)?.key ?? "",
        description: describeTrigger(r),
        scopeName: r.departmentId ? (dir.departments.get(r.departmentId)?.name ?? "Department") : "Whole university",
        canManage: can(actor, "leaderboard.manage", scopeTarget(uni(actor), r.departmentId)),
        awards: byRule.get(r.id)?.awards ?? 0,
        pointsAwarded: byRule.get(r.id)?.points ?? 0,
        students: byRule.get(r.id)?.students ?? 0,
      })),
      scopes: manageableScopes(actor, dir),
    };
  });
}

/* ───────────────────────────── Writing ───────────────────────────── */

export async function createRule(actor: Actor, input: RuleInput): Promise<XpRule> {
  const departmentId = input.departmentId || null;
  assertManage(actor, departmentId);
  const trigger = triggerByKey(input.trigger);
  if (!trigger) throw new ValidationError("Choose what earns XP from the list.");
  const values = {
    name: checkName(input.name),
    eventType: trigger.event,
    condition: trigger.condition,
    minScore: trigger.needsScore ? checkScore(input.minScore) : null,
    points: checkPoints(input.points),
    dailyCap: checkCap(input.dailyCap),
  };
  return withTenant(actor, async (tx) => {
    if (departmentId && (!isUuid(departmentId) || !(await directory(tx)).departments.has(departmentId))) throw new NotFoundError("Department");
    const [rule] = await tx
      .insert(gamXpRules)
      .values({ universityId: uni(actor), departmentId, ...values, createdBy: actor.userId || null })
      .returning();
    await audit(tx, actor, "gamification.rule_create", "gam_xp_rule", rule.id, { ...values, departmentId });
    return rule;
  });
}

export async function updateRule(
  actor: Actor,
  ruleId: string,
  input: { name: string; points: number; dailyCap?: number | null; minScore?: number | null },
): Promise<XpRule> {
  const rule = await loadRule(actor, ruleId);
  assertManage(actor, rule.departmentId);
  const values = {
    name: checkName(input.name),
    points: checkPoints(input.points),
    dailyCap: checkCap(input.dailyCap),
    minScore: rule.condition === "min_score" ? checkScore(input.minScore) : null,
  };
  return withTenant(actor, async (tx) => {
    const [updated] = await tx
      .update(gamXpRules)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(gamXpRules.id, ruleId))
      .returning();
    await audit(tx, actor, "gamification.rule_update", "gam_xp_rule", ruleId, { before: { name: rule.name, points: rule.points, dailyCap: rule.dailyCap, minScore: rule.minScore }, after: values });
    return updated;
  });
}

export async function setRuleActive(actor: Actor, ruleId: string, active: boolean): Promise<XpRule> {
  const rule = await loadRule(actor, ruleId);
  assertManage(actor, rule.departmentId);
  return withTenant(actor, async (tx) => {
    const [updated] = await tx.update(gamXpRules).set({ active, updatedAt: new Date() }).where(eq(gamXpRules.id, ruleId)).returning();
    await audit(tx, actor, active ? "gamification.rule_on" : "gamification.rule_off", "gam_xp_rule", ruleId, {});
    return updated;
  });
}

/* ───────────────────────────── Applying to past activity ───────────────────────────── */

export type ReplayResult = { events: number; awards: number; points: number; students: number; badges: number; failed: number };

/**
 * Replays the university's past events of these types from core domain_events (read
 * only) through the same idempotent path as live delivery. Each page runs in its own
 * transaction and each event in a savepoint, so one bad event never undoes the rest.
 */
async function replay(actor: Actor, types: readonly TriggerEvent[], ruleIds?: readonly string[], pageSize = 250): Promise<ReplayResult> {
  const students = new Set<string>();
  const out: ReplayResult = { events: 0, awards: 0, points: 0, students: 0, badges: 0, failed: 0 };
  let cursor: { at: string; id: string } | null = null;
  for (;;) {
    const after: { at: string; id: string } | null = cursor;
    const page: { id: string; cursor: string }[] = await withTenant(actor, async (tx) => {
      const rows = await tx
        .select({
          id: domainEvents.id,
          universityId: domainEvents.universityId,
          type: domainEvents.type,
          payload: domainEvents.payload,
          actorUserId: domainEvents.actorUserId,
          occurredAt: domainEvents.occurredAt,
          // Full microsecond precision for the cursor (a JS Date keeps milliseconds only).
          cursor: sql<string>`${domainEvents.occurredAt}::text`,
        })
        .from(domainEvents)
        .where(
          and(
            inArray(domainEvents.type, [...types]),
            after ? sql`(${domainEvents.occurredAt}, ${domainEvents.id}) > (${after.at}::timestamptz, ${after.id}::uuid)` : undefined,
          ),
        )
        .orderBy(asc(domainEvents.occurredAt), asc(domainEvents.id))
        .limit(pageSize);
      const cache = newCache();
      for (const row of rows) {
        const event = { ...row, cursor: undefined } as unknown as DomainEvent;
        try {
          const r = await tx.transaction((sp) => processEvent(sp, actor, event, { ruleIds, cache }));
          out.awards += r.awards.length;
          out.points += r.awards.reduce((n, a) => n + a.points, 0);
          out.badges += r.badges.length;
          for (const a of r.awards) students.add(a.userId);
        } catch (e) {
          out.failed++;
          console.error(`[gamification] replay of ${row.type} ${row.id} failed:`, e);
        }
      }
      out.events += rows.length;
      return rows.map((r) => ({ id: r.id, cursor: r.cursor }));
    });
    if (page.length < pageSize) break;
    const last = page[page.length - 1];
    cursor = { at: last.cursor, id: last.id };
  }
  out.students = students.size;
  return out;
}

/** "Apply to past activity": awards a rule for everything that already happened. Safe to run again. */
export async function applyRuleToPast(actor: Actor, ruleId: string): Promise<ReplayResult> {
  const rule = await loadRule(actor, ruleId);
  assertManage(actor, rule.departmentId);
  if (!rule.active) throw new ValidationError("Turn the rule on before applying it to past activity.");
  const result = await replay(actor, [rule.eventType], [rule.id]);
  await withTenant(actor, (tx) => audit(tx, actor, "gamification.rule_backfill", "gam_xp_rule", ruleId, result));
  return result;
}

/** Every active rule over every past source event (used by the demo seed). Admin only. */
export async function applyAllRulesToPast(actor: Actor): Promise<ReplayResult> {
  assertCan(actor, "leaderboard.manage", { universityId: uni(actor) });
  const result = await replay(actor, SOURCE_EVENTS);
  await withTenant(actor, (tx) => audit(tx, actor, "gamification.backfill_all", "gam_xp_rule", null, result));
  return result;
}
