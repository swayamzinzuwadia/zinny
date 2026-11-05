"use server";
/** The sign-up step that confirms a new account's mobile number: the profile's phone steps, for someone who may not have joined yet. */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { clientInfo, currentUserId } from "@/server/auth/session";
import { joinPhone } from "@/server/auth/phone";
import { universityBySlug } from "@/server/context";
import { NotFoundError } from "@/server/errors";
import { safeNext } from "@/modules/identity/auth";
import { cancelPhoneChange, resendPhoneChange, signUpPhoneActor, startPhoneChange, verifyPhoneChange } from "@/modules/identity/profile";

const PATH = "/signup/phone";

async function ctx(data: FormData) {
  const userId = await currentUserId();
  if (!userId) redirect("/login");
  const university = await universityBySlug(str(data, "uni"));
  if (!university) throw new NotFoundError("Institute");
  return { userId, actor: await signUpPhoneActor(userId, university.id), next: safeNext(str(data, "next")) ?? "/" };
}

export async function startSignUpPhoneAction(_: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { userId, actor } = await ctx(data);
    const { ip } = await clientInfo();
    const r = await startPhoneChange(actor, userId, { phone: joinPhone(str(data, "countryCode"), str(data, "phone")), ip });
    revalidatePath(PATH);
    return `We sent a code to ${r.masked}.`;
  });
}

export async function verifySignUpPhoneAction(_: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { userId, actor, next } = await ctx(data);
    await verifyPhoneChange(actor, userId, { code: str(data, "code") });
    redirect(next);
  });
}

export async function resendSignUpPhoneAction(_: ActionState, data: FormData): Promise<ActionState> {
  return attempt(async () => {
    const { userId, actor } = await ctx(data);
    const { ip } = await clientInfo();
    const r = await resendPhoneChange(actor, userId, { ip });
    revalidatePath(PATH);
    return `We sent a new code to ${r.masked}. The old code no longer works.`;
  });
}

export async function cancelSignUpPhoneAction(data: FormData) {
  const { userId, actor } = await ctx(data);
  await cancelPhoneChange(actor, userId);
  revalidatePath(PATH);
}

/** A new account has no number to remove; the form needs an action all the same. */
export async function noRemoveAction(): Promise<ActionState> {
  return null;
}
