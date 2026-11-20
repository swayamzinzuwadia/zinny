"use server";
/** The institute's privacy desk: answering requests, retention and its grievance contact. Only calls privacy services. */
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, num, str } from "@/server/action";
import { revokeAllSessions } from "@/server/auth/session";
import { spaceContext } from "@/server/context";
import { decideRequest, type Decision } from "@/modules/privacy/services/requests";
import { resolveRetentionFlag, saveRetentionSettings } from "@/modules/privacy/services/retention";

const path = (uni: string) => `/${uni}/admin/settings/privacy`;

export async function decideRequestAction(uni: string, _: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    const { request, erased } = await decideRequest(actor, { requestId: str(data, "requestId"), status: str(data, "status") as Decision["status"], response: str(data, "response") });
    // An erased account is signed out everywhere: its password is gone, and so are its sessions.
    if (erased?.anonymised) await revokeAllSessions(request.userId);
    revalidatePath(path(uni));
    return erased ? "Erased. The person has been told what was removed and what the law makes us keep." : request.status === "in_progress" ? "Marked as in progress." : "Answer sent.";
  });
}

export async function saveRetentionAction(uni: string, _: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    await saveRetentionSettings(actor, {
      inactiveDays: Math.round(num(data, "inactiveMonths") * 30.4375),
      retentionAction: str(data, "retentionAction"),
      grievanceName: str(data, "grievanceName"),
      grievanceEmail: str(data, "grievanceEmail"),
    });
    revalidatePath(path(uni));
    return "Saved.";
  });
}

export async function resolveFlagAction(uni: string, _: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { actor } = await spaceContext(uni);
    const outcome = str(data, "outcome") === "anonymised" ? "anonymised" : "kept";
    await resolveRetentionFlag(actor, str(data, "flagId"), outcome);
    revalidatePath(path(uni));
    return outcome === "kept" ? "Kept. The account stays open." : "Anonymised.";
  });
}
