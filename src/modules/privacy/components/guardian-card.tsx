import { ActionLink, Card } from "@/components/ui";
import type { HomeCardProps } from "@/contracts/module";
import { minorState } from "../services/children";

/** Learner home: shown only to a learner under 18 whose parent or guardian hasn't confirmed yet. */
export async function GuardianHomeCard({ uni, actor }: HomeCardProps) {
  const s = await minorState(actor.userId);
  if (!s.minor || s.verified) return null;
  return (
    <Card className="border-gold/50 p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">Waiting for your parent or guardian</p>
          <p className="mt-1 text-[14px] text-muted">
            We sent {s.guardianName} a link at {s.contact}. Until they confirm, news, analytics and anything that tracks how you learn stay off.
          </p>
          <div className="mt-3">
            <ActionLink href={`/${uni}/profile/privacy#guardian`} icon="forward">
              Open privacy settings
            </ActionLink>
          </div>
        </div>
      </div>
    </Card>
  );
}
