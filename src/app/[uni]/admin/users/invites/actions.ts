"use server";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { resendInvite, revokeInvite } from "@/modules/identity/invites";
import { setPhoneSignIn } from "@/modules/identity/settings";
import { formatWhen } from "@/modules/identity/emails";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor, university } = await spaceContext(uni);
  return { actor, university, path: `/${uni}/admin/users/invites` };
}

export async function resendInviteAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, university, path } = await ctx(data);
  return attempt(async () => {
    const r = await resendInvite(actor, str(data, "userId"));
    revalidatePath(path);
    return `Invitation sent to ${r.email}. The new link works until ${formatWhen(r.expiresAt, university.timezone)}.`;
  });
}

export async function revokeInviteAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    const r = await revokeInvite(actor, str(data, "inviteId"));
    revalidatePath(path);
    return `Invitation for ${r.name} revoked. The link no longer works.`;
  });
}

export async function phoneSignInAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    const on = str(data, "on") === "1";
    await setPhoneSignIn(actor, on);
    revalidatePath(path);
    return on ? "Phone sign-in is on. People can sign in with a code sent to their mobile." : "Phone sign-in is off.";
  });
}
