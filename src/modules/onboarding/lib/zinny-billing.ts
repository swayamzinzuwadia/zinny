/**
 * The way onboarding reaches Zinny's plans, licences and invoices: only through the Zinny
 * team panel's exported services (it owns those tables).
 *
 * Those services check a platform permission. A self-serve plan purchase and the trial job
 * have no Zinny team member behind them, so they act as "Zinny checkout": a system actor
 * holding only the Finance Admin role (platform.licences and platform.finance), the same way
 * jobs act as a university's system actor. Its log entries have no person attached. Only
 * onboarding's services use it, after their own permission checks.
 */
import { addDays } from "@/server/lib/dates";
import type { Actor } from "@/server/core";
import { licenceFor } from "@/modules/zinny-team-panel/services/licences";
import { allPlans, type Plan } from "@/modules/zinny-team-panel/services/plans";

export function zinnyCheckoutActor(): Actor {
  return {
    userId: "",
    name: "Zinny checkout",
    email: "system@zinny",
    universityId: null,
    supportSessionId: null,
    assignments: [
      { role: "finance_admin", scopeType: "platform", universityId: null, departmentId: null, batchId: null, startsAt: new Date(0), endsAt: null },
    ],
  };
}

export type ActiveLicence = { id: string; plan: string; startDate: string; endDate: string };

/** The university's licence when its term covers `today`, else null. */
export async function activeLicence(universityId: string, today: string): Promise<ActiveLicence | null> {
  const { licence } = await licenceFor(zinnyCheckoutActor(), universityId, today);
  if (!licence || licence.startDate > today || licence.endDate < today) return null;
  return { id: licence.id, plan: licence.plan, startDate: licence.startDate, endDate: licence.endDate };
}

/** The plans an institute can buy: every plan that isn't archived, in list order. */
export async function buyablePlans(): Promise<Plan[]> {
  return (await allPlans()).filter((p) => !p.archivedAt && p.pricePaise > 0);
}

/** The last day of a term of `months` months starting on `start` ("2026-11-19", 12 → "2027-11-18"). */
export function termEndFor(start: string, months: number) {
  const d = new Date(`${start}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return addDays(d.toISOString().slice(0, 10), -1);
}
