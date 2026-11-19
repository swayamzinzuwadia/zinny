import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { can } from "@/server/core";
import { spaceContext } from "@/server/context";
import { formatDate, todayIn } from "@/server/lib/dates";
import { KycForm } from "@/modules/onboarding/components/kyc-form";
import { kycStatus } from "@/modules/onboarding/services/kyc";
import { sendParentsHome } from "../view";
import { saveKycAction } from "./actions";

export const metadata = { title: "Your KYC" };

/** A student's own KYC: PAN (kept encrypted, shown masked), last 4 Aadhaar digits, consent. */
export default async function KycPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  sendParentsHome(actor, uni);
  if (actor.viewedBy || !can(actor, "self.profile", { universityId: university.id, ownerUserId: actor.userId })) notFound();
  const status = await kycStatus(actor);
  const notice = `I agree that ${university.name} may keep my PAN and the last 4 digits of my Aadhaar to verify who I am and to issue invoices and certificates in my name. My PAN is stored encrypted and shown only masked.`;

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-[26px] font-semibold tracking-tight">Your KYC</h1>
      <p className="mt-1 mb-5 text-[14px] text-muted">{university.name} asks for this once. It takes a minute.</p>
      {status.done && (
        <Card className="onb-pop mb-5 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] text-muted">PAN on file</div>
              <div className="tabular text-[18px] font-medium tracking-wider">{status.panMasked}</div>
            </div>
            <Badge tone="brand">Done</Badge>
          </div>
          <p className="mt-2 text-[13px] text-muted">
            {status.aadhaarLast4 ? `Aadhaar ending ${status.aadhaarLast4}. ` : ""}Agreed on {formatDate(todayIn(university.timezone, status.consentAt))}. To change it, fill in the form again.
          </p>
        </Card>
      )}
      <KycForm action={saveKycAction.bind(null, uni)} again={status.done} notice={notice} />
    </div>
  );
}
