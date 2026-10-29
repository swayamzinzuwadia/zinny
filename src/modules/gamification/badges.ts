/**
 * Badges: milestones on counts or XP (brief: "Must have" 3). Earned once, with an
 * in-app notification. Creating a badge, turning it back on or lowering its target
 * awards it straight away to students who already qualify; a badge is never taken back.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { audit, can, peopleLite, withTenant, type Actor } from "@/server/core";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { isBadgeIcon, isMetric, METRICS } from "./catalog";
import { grantBadge } from "./engine";
import { metricValues } from "./metrics";
import { canSeeScoped, directory, holdsAnywhere, manageableScopes, scopeTarget, uni, visibleDepartments } from "./scope";
import { gamBadgeAwards, gamBadges, type Badge } from "./schema";

export type BadgeInput = {
  name: string;
  description?: string;
  icon: string;
  metric: string;
  threshold: number;
  departmentId?: string | null;
};

function checkText(input: { name: string; description?: string; icon: string }) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) throw new ValidationError("Give the badge a name between 2 and 60 characters, like Bookworm.");
  const description = (input.description ?? "").trim();
  if (description.length > 200) throw new ValidationError("Keep the description under 200 characters.");
  if (!isBadgeIcon(input.icon)) throw new ValidationError("Pick one of the icons.");
  return { name, description, icon: input.icon };
}

function checkThreshold(n: number, metric: string) {
  const max = metric === "xp" ? 1_000_000 : 10_000;
  if (!Number.isInteger(n) || n < 1 || n > max) throw new ValidationError(`The target must be a whole number from 1 to ${max.toLocaleString("en-IN")}.`);
  return n;
}

function assertManage(actor: Actor, departmentId: string | null) {
  if (departmentId === null && !can(actor, "leaderboard.manage", { universityId: uni(actor) })) {
    throw new ForbiddenError("Only an institute admin can change badges for the whole university. Choose your department instead.");
  }
  if (!can(actor, "leaderboard.manage", scopeTarget(uni(actor), departmentId))) throw new ForbiddenError();
}

/** Awards the badge to every student who already qualifies. Returns how many got it now. */
async function awardExisting(tx: Tx, badge: Badge): Promise<number> {
  if (!badge.active) return 0;
  const values = await metricValues(tx, badge.metric, { departmentId: badge.departmentId });
  let n = 0;
  for (const [userId, value] of values) {
    if (value >= badge.threshold && (await grantBadge(tx, badge, userId, value))) n++;
  }
  return n;
}

async function loadBadge(actor: Actor, badgeId: string): Promise<Badge> {
  const [b] = await withTenant(actor, (tx) => tx.select().from(gamBadges).where(eq(gamBadges.id, badgeId)));
  if (!b) throw new NotFoundError("Badge");
  return b;
}

export function criterion(b: Pick<Badge, "metric" | "threshold">): string {
  return METRICS[b.metric].badge(b.threshold);
}

/* ───────────────────────────── Reading ───────────────────────────── */

export async function listBadges(actor: Actor) {
  if (!holdsAnywhere(actor, "leaderboard.view")) throw new ForbiddenError();
  return withTenant(actor, async (tx) => {
    const [vis, dir] = await Promise.all([visibleDepartments(tx, actor), directory(tx)]);
    const badges = (await tx.select().from(gamBadges).orderBy(gamBadges.createdAt)).filter((b) => canSeeScoped(vis, b.departmentId));
    const ids = badges.map((b) => b.id);
    const counts = ids.length
      ? await tx
          .select({ badgeId: gamBadgeAwards.badgeId, n: sql<number>`count(*)::int` })
          .from(gamBadgeAwards)
          .where(inArray(gamBadgeAwards.badgeId, ids))
          .groupBy(gamBadgeAwards.badgeId)
      : [];
    const recent = ids.length
      ? await tx
          .select({ badgeId: gamBadgeAwards.badgeId, userId: gamBadgeAwards.userId, awardedAt: gamBadgeAwards.awardedAt })
          .from(gamBadgeAwards)
          .where(inArray(gamBadgeAwards.badgeId, ids))
          .orderBy(desc(gamBadgeAwards.awardedAt))
          .limit(12)
      : [];
    const names = new Map((await peopleLite(tx, recent.map((r) => r.userId))).map((p) => [p.id, p.name]));
    const byId = new Map(badges.map((b) => [b.id, b]));
    const countOf = new Map(counts.map((c) => [c.badgeId, c.n]));
    return {
      badges: badges.map((b) => ({
        ...b,
        criterion: criterion(b),
        scopeName: b.departmentId ? (dir.departments.get(b.departmentId)?.name ?? "Department") : "Whole university",
        earnedBy: countOf.get(b.id) ?? 0,
        canManage: can(actor, "leaderboard.manage", scopeTarget(uni(actor), b.departmentId)),
      })),
      recent: recent.map((r) => ({ ...r, name: names.get(r.userId) ?? "Former student", badge: byId.get(r.badgeId)! })),
      scopes: manageableScopes(actor, dir),
    };
  });
}

/* ───────────────────────────── Writing ───────────────────────────── */

export async function createBadge(actor: Actor, input: BadgeInput): Promise<{ badge: Badge; awarded: number }> {
  const departmentId = input.departmentId || null;
  assertManage(actor, departmentId);
  const text = checkText(input);
  if (!isMetric(input.metric)) throw new ValidationError("Choose what the badge counts.");
  const metric = input.metric;
  const threshold = checkThreshold(input.threshold, metric);
  return withTenant(actor, async (tx) => {
    if (departmentId && !(await directory(tx)).departments.has(departmentId)) throw new NotFoundError("Department");
    const [badge] = await tx
      .insert(gamBadges)
      .values({ universityId: uni(actor), departmentId, ...text, metric, threshold, createdBy: actor.userId || null })
      .returning();
    const awarded = await awardExisting(tx, badge);
    await audit(tx, actor, "gamification.badge_create", "gam_badge", badge.id, { ...text, metric, threshold, departmentId, awarded });
    return { badge, awarded };
  });
}

export async function updateBadge(
  actor: Actor,
  badgeId: string,
  input: { name: string; description?: string; icon: string; threshold: number },
): Promise<{ badge: Badge; awarded: number }> {
  const before = await loadBadge(actor, badgeId);
  assertManage(actor, before.departmentId);
  const text = checkText(input);
  const threshold = checkThreshold(input.threshold, before.metric);
  return withTenant(actor, async (tx) => {
    const [badge] = await tx
      .update(gamBadges)
      .set({ ...text, threshold, updatedAt: new Date() })
      .where(eq(gamBadges.id, badgeId))
      .returning();
    const awarded = threshold < before.threshold ? await awardExisting(tx, badge) : 0;
    await audit(tx, actor, "gamification.badge_update", "gam_badge", badgeId, {
      before: { name: before.name, description: before.description, icon: before.icon, threshold: before.threshold },
      after: { ...text, threshold },
      awarded,
    });
    return { badge, awarded };
  });
}

export async function setBadgeActive(actor: Actor, badgeId: string, active: boolean): Promise<{ badge: Badge; awarded: number }> {
  const before = await loadBadge(actor, badgeId);
  assertManage(actor, before.departmentId);
  return withTenant(actor, async (tx) => {
    const [badge] = await tx.update(gamBadges).set({ active, updatedAt: new Date() }).where(and(eq(gamBadges.id, badgeId))).returning();
    const awarded = active && !before.active ? await awardExisting(tx, badge) : 0;
    await audit(tx, actor, active ? "gamification.badge_on" : "gamification.badge_off", "gam_badge", badgeId, { awarded });
    return { badge, awarded };
  });
}
