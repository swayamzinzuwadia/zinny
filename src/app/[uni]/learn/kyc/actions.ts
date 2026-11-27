"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { saveKyc } from "@/modules/onboarding/services/kyc";
import { clientInfo } from "@/server/auth/session";
import { recordKycConsent } from "@/modules/privacy/services/consents";

/** "Save my KYC". The full Aadhaar number is refused by the service and never stored. */
export async function saveKycAction(uni: string, _: ActionState, data: FormData): Promise<ActionState> {
  const { actor } = await spaceContext(uni);
  const res = await attempt(async () => {
    const masked = await saveKyc(actor, { pan: str(data, "pan"), aadhaarLast4: str(data, "aadhaar"), consent: str(data, "consent") === "yes" });
    // The same consent, on the institute's consent record (privacy module, DPDP).
    await recordKycConsent(actor, { ip: (await clientInfo()).ip });
    return `Saved. Your PAN shows as ${masked} from now on.`;
  });
  if (res?.ok) revalidatePath(`/${uni}/learn/kyc`);
  return res;
}
