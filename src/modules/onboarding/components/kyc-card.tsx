import type { HomeCardProps } from "@/contracts/module";
import { ButtonLink, Card } from "@/components/ui";
import { hasRole } from "@/server/core";
import { kycStatus } from "../services/kyc";

/** Learner home: "Complete your KYC" for a student who hasn't yet. Nothing once it is done. */
export async function KycHomeCard({ uni, actor }: HomeCardProps) {
  if (actor.viewedBy || !hasRole(actor, ["student", "alumni"])) return null;
  const status = await kycStatus(actor).catch(() => null);
  if (!status || status.done) return null;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[16px] font-medium">Complete your KYC</h2>
          <p className="mt-1 text-[13px] text-muted">Your PAN and the last 4 digits of your Aadhaar. It takes a minute and you only do it once.</p>
        </div>
        <ButtonLink href={`/${uni}/learn/kyc`} variant="secondary" size="sm" icon="forward">
          Complete KYC
        </ButtonLink>
      </div>
    </Card>
  );
}
