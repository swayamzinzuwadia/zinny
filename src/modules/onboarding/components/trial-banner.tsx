import { ButtonLink } from "@/components/ui";
import type { Actor } from "@/server/core";
import { can } from "@/server/core";
import { formatDate } from "@/server/lib/dates";
import { trialInfo } from "../services/trial";

export function trialLine(daysLeft: number, trialEndsAt: string) {
  if (daysLeft <= 0) return "Your free trial ends today.";
  if (daysLeft === 1) return `Your free trial ends tomorrow, ${formatDate(trialEndsAt, { year: false })}.`;
  return `${daysLeft} days left in your free trial. It ends on ${formatDate(trialEndsAt, { year: false })}.`;
}

/**
 * The trial countdown for people who run a self-signed institute in its free trial. Renders
 * nothing for anyone else, after a plan is paid, and for institutes the Zinny team set up.
 * Meant for the top of the admin layout: `<TrialBanner uni={uni} actor={actor} />`.
 */
export async function TrialBanner({ uni, actor }: { uni: string; actor: Actor }) {
  if (!actor.universityId || actor.supportSessionId || !can(actor, "settings.manage", { universityId: actor.universityId })) return null;
  const t = await trialInfo(actor).catch(() => null);
  if (!t?.inTrial || t.daysLeft === null || !t.trialEndsAt) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-gold-soft px-4 py-2 text-[13px] text-gold-strong">
      <span className="flex items-center gap-2">
        <span className="now-dot h-2 w-2 shrink-0 rounded-full bg-gold" aria-hidden />
        {trialLine(t.daysLeft, t.trialEndsAt)}
      </span>
      <ButtonLink href={`/${uni}/admin/choose-plan`} size="sm" icon="forward">
        Choose a plan
      </ButtonLink>
    </div>
  );
}
