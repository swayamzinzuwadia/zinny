"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, num, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { createBadge, setBadgeActive, updateBadge } from "./badges";
import { cancelChallenge, createChallenge } from "./challenges";
import { applyRuleToPast, createRule, setRuleActive, updateRule } from "./rules";
import { setNameDisplay } from "./settings";
import { plural } from "./util";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor, base: `/${uni}/admin/leaderboards` };
}

/** Empty = null (no cap); anything else must be a number, which the service validates. */
function optional(data: FormData, key: string): number | null {
  const v = str(data, key);
  return v === "" ? null : Number(v);
}

/* ── XP rules ── */

export async function createRuleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, base } = await ctx(data);
  return attempt(async () => {
    const rule = await createRule(actor, {
      name: str(data, "name"),
      trigger: str(data, "trigger"),
      minScore: optional(data, "minScore"),
      points: num(data, "points"),
      dailyCap: optional(data, "dailyCap"),
      departmentId: str(data, "departmentId") || null,
    });
    revalidatePath(`${base}/xp-rules`);
    return `${rule.name} added. It counts new activity from now on. To include what already happened, use Apply to past activity.`;
  });
}

export async function updateRuleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, base } = await ctx(data);
  return attempt(async () => {
    await updateRule(actor, str(data, "ruleId"), {
      name: str(data, "name"),
      points: num(data, "points"),
      dailyCap: optional(data, "dailyCap"),
      minScore: optional(data, "minScore"),
    });
    revalidatePath(`${base}/xp-rules`);
    return "Rule saved. New points apply to activity from now on.";
  });
}

export async function setRuleActiveAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, base } = await ctx(data);
  const active = str(data, "active") === "true";
  return attempt(async () => {
    await setRuleActive(actor, str(data, "ruleId"), active);
    revalidatePath(`${base}/xp-rules`);
    return active ? "Rule turned on." : "Rule turned off. XP already given stays.";
  });
}

export async function applyRuleAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor, base } = await ctx(data);
  return attempt(async () => {
    const r = await applyRuleToPast(actor, str(data, "ruleId"));
    revalidatePath(`${base}/xp-rules`);
    revalidatePath(base);
    revalidatePath(`/${uni}/learn/leaderboard`);
    if (r.awards === 0) return `Checked ${plural(r.events, "past event", "past events")}. Nothing new to award.`;
    return `Gave ${r.points.toLocaleString("en-IN")} XP to ${plural(r.students, "student", "students")} from ${plural(r.events, "past event", "past events")}.`;
  });
}

/* ── Badges ── */

export async function createBadgeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, base } = await ctx(data);
  return attempt(async () => {
    const { badge, awarded } = await createBadge(actor, {
      name: str(data, "name"),
      description: str(data, "description"),
      icon: str(data, "icon"),
      metric: str(data, "metric"),
      threshold: num(data, "threshold"),
      departmentId: str(data, "departmentId") || null,
    });
    revalidatePath(`${base}/badges`);
    return awarded
      ? `${badge.name} created. ${plural(awarded, "student already qualified and has", "students already qualified and have")} it now.`
      : `${badge.name} created. Students get it as soon as they qualify.`;
  });
}

export async function updateBadgeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, base } = await ctx(data);
  return attempt(async () => {
    const { awarded } = await updateBadge(actor, str(data, "badgeId"), {
      name: str(data, "name"),
      description: str(data, "description"),
      icon: str(data, "icon"),
      threshold: num(data, "threshold"),
    });
    revalidatePath(`${base}/badges`);
    return awarded ? `Badge saved. ${plural(awarded, "more student now has", "more students now have")} it.` : "Badge saved.";
  });
}

export async function setBadgeActiveAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, base } = await ctx(data);
  const active = str(data, "active") === "true";
  return attempt(async () => {
    const { awarded } = await setBadgeActive(actor, str(data, "badgeId"), active);
    revalidatePath(`${base}/badges`);
    if (!active) return "Badge turned off. Students who earned it keep it.";
    return awarded ? `Badge turned on. ${plural(awarded, "student qualified and has", "students qualified and have")} it now.` : "Badge turned on.";
  });
}

/* ── Challenges ── */

export async function createChallengeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, base } = await ctx(data);
  return attempt(async () => {
    const c = await createChallenge(actor, {
      title: str(data, "title"),
      description: str(data, "description"),
      scope: str(data, "scope"),
      metric: str(data, "metric"),
      target: num(data, "target"),
      startDate: str(data, "startDate"),
      endDate: str(data, "endDate"),
    });
    revalidatePath(`${base}/challenges`);
    return `${c.title} is set. Students see it on their leaderboard.`;
  });
}

export async function cancelChallengeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, base } = await ctx(data);
  const id = str(data, "challengeId");
  return attempt(async () => {
    await cancelChallenge(actor, id);
    revalidatePath(`${base}/challenges`);
    revalidatePath(`${base}/challenges/${id}`);
    return "Challenge cancelled. Students no longer see it.";
  });
}

/* ── Settings ── */

export async function setNameDisplayAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor, base } = await ctx(data);
  return attempt(async () => {
    const v = await setNameDisplay(actor, str(data, "nameDisplay"));
    revalidatePath(base);
    revalidatePath(`/${uni}/learn/leaderboard`);
    return v === "full" ? "Students now see each other's full names." : "Students now see first names and initials.";
  });
}
