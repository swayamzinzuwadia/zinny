"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { payPlanTestMode } from "@/modules/onboarding/services/plans";
import { removeDocument } from "@/modules/onboarding/services/documents";

/** "Pay … and start": pays for the plan (test mode with the mock gateway) and comes back to the page. */
export async function payPlanAction(_: ActionState, data: FormData): Promise<ActionState> {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  const res = await attempt(async () => {
    await payPlanTestMode(actor, str(data, "plan"));
  });
  if (res?.error) return res;
  redirect(`/${uni}/admin/choose-plan?paid=1`);
}

/** "Remove" on a document. */
export async function removeDocumentAction(uni: string, documentId: string): Promise<{ ok?: string; error?: string }> {
  const { actor } = await spaceContext(uni);
  const res = await attempt(() => removeDocument(actor, documentId));
  return { ok: res?.ok, error: res?.error };
}
