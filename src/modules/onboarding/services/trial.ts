/**
 * The free trial of a self-signed institute: how long is left, the job that freezes it
 * when the trial ends without a paid plan, and unfreezing once a plan is paid.
 *
 * Frozen means closed, not removed: students see "temporarily unavailable", admins can
 * only choose a plan and manage their documents (src/server/context.ts). Nothing is deleted.
 */
import { eq } from "drizzle-orm";
import { universities } from "@/db/schema";
import { assertCan, audit, systemActorFor, todayIn, withTenant, type Actor } from "@/server/core";
import { daysBetween } from "@/server/lib/dates";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { setTrialState } from "@/server/services/core-api";
import { activeLicence } from "../lib/zinny-billing";

export type TrialInfo = {
  universityId: string;
  status: string;
  /** Today in the university's time zone. */
  today: string;
  trialEndsAt: string | null;
  /** Whole days until the trial ends; 0 on the day it ends. Null when there is no trial. */
  daysLeft: number | null;
  /** A paid plan (or a licence the Zinny team set up) covers today. */
  hasPlan: boolean;
  /** In a free trial now: a trial date, no plan, not frozen. */
  inTrial: boolean;
};

type UniRow = { id: string; status: string; timezone: string; trialEndsAt: string | null };

async function universityRow(actor: Actor): Promise<UniRow> {
  const universityId = actor.universityId;
  if (!universityId) throw new ForbiddenError("No institute selected.");
  const [u] = await withTenant(actor, (tx) =>
    tx
      .select({ id: universities.id, status: universities.status, timezone: universities.timezone, trialEndsAt: universities.trialEndsAt })
      .from(universities)
      .where(eq(universities.id, universityId)),
  );
  if (!u) throw new NotFoundError("Institute");
  return u;
}

/** Paid through the plan checkout, or given a licence by the Zinny team: either way a licence covers today. */
async function hasPlanFor(u: UniRow, today: string) {
  return !!(await activeLicence(u.id, today));
}

function infoFrom(u: UniRow, today: string, hasPlan: boolean): TrialInfo {
  const daysLeft = u.trialEndsAt ? Math.max(0, daysBetween(today, u.trialEndsAt)) : null;
  return {
    universityId: u.id,
    status: u.status,
    today,
    trialEndsAt: u.trialEndsAt,
    daysLeft,
    hasPlan,
    inTrial: !!u.trialEndsAt && !hasPlan && u.status === "active",
  };
}

/** The trial as the people who run the institute see it (settings.manage). */
export async function trialInfo(actor: Actor, now = new Date()): Promise<TrialInfo> {
  assertCan(actor, "settings.manage", { universityId: actor.universityId ?? "" });
  const u = await universityRow(actor);
  const today = todayIn(u.timezone, now);
  // Institutes the Zinny team set up have no trial: no need to look for a licence.
  const hasPlan = u.trialEndsAt ? await hasPlanFor(u, today) : true;
  return infoFrom(u, today, hasPlan);
}

/**
 * The trial job, once per university as its system actor: a self-signed institute whose
 * trial has ended (today is on or after its end date) with no licence covering today is
 * frozen. Returns what it did. Idempotent.
 */
export async function freezeIfTrialOver(actor: Actor, now = new Date()): Promise<"frozen" | "unchanged"> {
  const u = await universityRow(actor);
  if (u.status !== "active" || !u.trialEndsAt) return "unchanged";
  const today = todayIn(u.timezone, now);
  if (today < u.trialEndsAt) return "unchanged";
  if (await activeLicence(u.id, today)) return "unchanged";
  await setTrialState(actor, u.id, { status: "frozen" });
  return "frozen";
}

/** Unfreezes after a paid plan: the university's system actor, logged in its audit log. */
export async function unfreezeAfterPayment(universityId: string, orderId: string) {
  const system = systemActorFor(universityId);
  const [u] = await withTenant(system, (tx) => tx.select({ status: universities.status }).from(universities).where(eq(universities.id, universityId)));
  if (u?.status === "frozen") {
    await setTrialState(system, universityId, { status: "active" });
    await withTenant(system, (tx) => audit(tx, system, "onboarding.unfreeze", "onb_plan_order", orderId, {}));
  }
}
