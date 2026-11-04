"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { decideJoinRequest, regenerateJoinCode, setJoinMode, type JoinMode } from "@/modules/identity/joining";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { actor, uni };
}

/** Accept (into the ticked departments) or decline a join request; the button pressed says which. */
export async function decideJoinAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, uni } = await ctx(data);
  let done = "";
  const res = await attempt(async () => {
    const accept = str(data, "choice") === "accept";
    const departmentIds = data.getAll("departmentId").map(String).filter(Boolean);
    await decideJoinRequest(actor, str(data, "requestId"), { accept, departmentIds, note: str(data, "note") });
    revalidatePath(`/${uni}/admin`, "layout");
    done = accept ? `${str(data, "name")} is now a student.` : `${str(data, "name")}'s request was declined. They've been told by email.`;
  });
  // The request's card disappears once answered, so say what happened at the top of the page.
  if (done) redirect(`/${uni}/admin/users/requests?done=${encodeURIComponent(done)}`);
  return res;
}

export async function joinModeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, uni } = await ctx(data);
  return attempt(async () => {
    const mode = str(data, "mode") as JoinMode;
    await setJoinMode(actor, mode);
    revalidatePath(`/${uni}/admin/users/requests`);
    return mode === "instant" ? "Students with the code now join straight away." : "Every student with the code now needs to be accepted.";
  });
}

export async function newJoinCodeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, uni } = await ctx(data);
  return attempt(async () => {
    const { code } = await regenerateJoinCode(actor);
    revalidatePath(`/${uni}/admin/users/requests`);
    return `New code: ${code}. The old one no longer works.`;
  });
}
