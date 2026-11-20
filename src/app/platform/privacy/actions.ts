"use server";
/** The Zinny privacy desk: Zinny's own requests and the breach register. Only calls privacy services. */
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { revokeAllSessions } from "@/server/auth/session";
import { platformContext } from "@/server/context";
import { decidePlatformRequest, type Decision } from "@/modules/privacy/services/requests";
import { logBreach, markBreachStep, type BreachStep } from "@/modules/privacy/services/breaches";

export async function decidePlatformRequestAction(_: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const actor = await platformContext();
    const { request, erased } = await decidePlatformRequest(actor, { requestId: str(data, "requestId"), status: str(data, "status") as Decision["status"], response: str(data, "response") });
    if (erased?.anonymised) await revokeAllSessions(request.userId);
    revalidatePath("/platform/privacy");
    return erased ? "Erased. The person has been told what was removed and what the law makes us keep." : "Answer sent.";
  });
}

export async function logBreachAction(_: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const actor = await platformContext();
    await logBreach(actor, {
      title: str(data, "title"),
      description: str(data, "description"),
      detectedAt: str(data, "detectedAt"),
      occurredAt: str(data, "occurredAt") || undefined,
      dataCategories: str(data, "dataCategories"),
      principalsAffected: str(data, "principalsAffected"),
      instituteIds: data.getAll("instituteIds").map(String),
      measures: str(data, "measures"),
    });
    revalidatePath("/platform/privacy/breaches");
    return "Logged. The 72-hour clocks are running.";
  });
}

export async function breachStepAction(_: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const actor = await platformContext();
    await markBreachStep(actor, str(data, "breachId"), str(data, "step") as BreachStep);
    revalidatePath("/platform/privacy/breaches");
    return "Recorded.";
  });
}
