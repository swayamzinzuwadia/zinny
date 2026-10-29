"use server";
/** Profile page actions. Each one loads the signed-in actor and calls the identity profile service. */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { clientInfo, currentSession, signOut, startSession } from "@/server/auth/session";
import {
  cancelPhoneChange,
  changePassword,
  removePhone,
  removePhoto,
  resendPhoneChange,
  signOutEverywhere,
  signOutSession,
  startPhoneChange,
  updateName,
  uploadPhoto,
  verifyPhoneChange,
} from "@/modules/identity/profile";
import { formatPhone } from "@/server/auth/phone";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor, path: `/${uni}/profile` };
}

export async function updateNameAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    await updateName(actor, actor.userId, str(data, "name"));
    revalidatePath(path);
    return "Name saved.";
  });
}

export async function startPhoneChangeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    const { ip } = await clientInfo();
    const r = await startPhoneChange(actor, actor.userId, { phone: str(data, "phone"), ip });
    revalidatePath(path);
    return `We sent a code to ${r.masked}.`;
  });
}

export async function verifyPhoneChangeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    const r = await verifyPhoneChange(actor, actor.userId, { code: str(data, "code") });
    revalidatePath(path);
    return `Mobile number saved: ${formatPhone(r.phone)}.`;
  });
}

export async function resendPhoneChangeAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    const { ip } = await clientInfo();
    const r = await resendPhoneChange(actor, actor.userId, { ip });
    revalidatePath(path);
    return `We sent a new code to ${r.masked}. The old code no longer works.`;
  });
}

export async function cancelPhoneChangeAction(data: FormData) {
  const { actor, path } = await ctx(data);
  await cancelPhoneChange(actor, actor.userId);
  revalidatePath(path);
}

export async function removePhoneAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    await removePhone(actor, actor.userId);
    revalidatePath(path);
    return "Mobile number removed.";
  });
}

export async function uploadPhotoAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    const file = data.get("photo");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose a photo to upload.");
    await uploadPhoto(actor, actor.userId, { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, size: file.size });
    revalidatePath(path);
    return "Photo saved.";
  });
}

export async function removePhotoAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    await removePhoto(actor, actor.userId);
    revalidatePath(path);
    return "Photo removed.";
  });
}

export async function changePasswordAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  return attempt(async () => {
    const session = await currentSession();
    const r = await changePassword(actor, actor.userId, {
      current: String(data.get("current") ?? ""),
      next: String(data.get("password") ?? ""),
      confirm: String(data.get("confirm") ?? ""),
      keepSessionId: session?.sessionId ?? null,
    });
    // A new session id for this device too, now that the password changed.
    await startSession(actor.userId, "password");
    revalidatePath(path);
    return r.sessionsEnded > 0
      ? `Password changed. ${r.sessionsEnded} other ${r.sessionsEnded === 1 ? "device was" : "devices were"} signed out.`
      : "Password changed.";
  });
}

export async function signOutSessionAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { actor, path } = await ctx(data);
  const sessionId = str(data, "sessionId");
  const current = await currentSession();
  const res = await attempt(async () => {
    await signOutSession(actor, actor.userId, sessionId);
    revalidatePath(path);
    return "That device is signed out.";
  });
  if (res?.ok && current?.sessionId === sessionId) {
    await signOut();
    redirect("/login");
  }
  return res;
}

export async function signOutEverywhereAction(data: FormData) {
  const { actor } = await ctx(data);
  await signOutEverywhere(actor, actor.userId);
  await signOut();
  redirect("/login");
}
