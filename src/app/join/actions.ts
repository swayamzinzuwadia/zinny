"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { currentUserId } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { cancelJoinRequest, joinWithCode } from "@/modules/identity/joining";

const str = (d: FormData, k: string) => String(d.get(k) ?? "").trim();

/** Join (or ask to join) the institute behind a joining code. */
export async function joinAction(_: ActionState, data: FormData): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/join");
  let dest: string;
  try {
    const r = await joinWithCode(userId, { code: str(data, "code"), departmentId: str(data, "departmentId") || null, message: str(data, "message") || null });
    dest = r.status === "joined" ? r.landing : "/join?sent=1";
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  redirect(dest);
}

/** Withdraw a pending request. */
export async function cancelJoinAction(_: ActionState, data: FormData): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/join");
  try {
    await cancelJoinRequest(userId, str(data, "requestId"));
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    throw e;
  }
  revalidatePath("/join");
  return { ok: "Request withdrawn." };
}
