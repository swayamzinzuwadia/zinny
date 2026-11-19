"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, num, str } from "@/server/action";
import { platformContext } from "@/server/context";
import { formatDate } from "@/server/lib/dates";
import { extendTrial, reviewDocument } from "@/modules/onboarding/services/review";

/** Approve or reject one document ("decision" is approved or rejected). */
export async function reviewDocumentAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const decision = str(data, "decision") === "approved" ? "approved" : "rejected";
  const res = await attempt(() => reviewDocument(actor, str(data, "universityId"), str(data, "documentId"), decision, str(data, "note")));
  if (res?.ok) revalidatePath("/platform/signups");
  return res;
}

/** "Extend trial" by a number of days. */
export async function extendTrialAction(_: ActionState, data: FormData): Promise<ActionState> {
  const actor = await platformContext();
  const res = await attempt(async () => {
    const until = await extendTrial(actor, str(data, "universityId"), num(data, "days"));
    return `The trial now ends on ${formatDate(until)}.`;
  });
  if (res?.ok) revalidatePath("/platform/signups");
  return res;
}
