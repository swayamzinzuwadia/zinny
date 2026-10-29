"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/forms";
import { attempt, str } from "@/server/action";
import { spaceContext } from "@/server/context";
import { ValidationError } from "@/server/errors";
import { CHANNEL_LABEL, CHANNELS } from "./kinds";
import type { Channel } from "./schema";
import {
  resetKindSettings,
  retryDelivery,
  saveDeliverySettings,
  saveKindSettings,
  savePreferences,
  sendTestMessage,
  type PreferenceInput,
} from "./service";

async function ctx(data: FormData) {
  const uni = str(data, "uni");
  const { actor } = await spaceContext(uni);
  return { uni, actor };
}

const adminPath = (uni: string) => `/${uni}/admin/settings/notifications`;
const raw = (d: FormData, k: string) => String(d.get(k) ?? "");

export async function saveKindAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const kind = str(data, "kind");
  return attempt(async () => {
    await saveKindSettings(actor, kind, {
      channels: Object.fromEntries(CHANNELS.map((c) => [c, str(data, `channel_${c}`)])),
      emailSubject: raw(data, "emailSubject"),
      emailBody: raw(data, "emailBody"),
      smsText: raw(data, "smsText"),
      smsTemplateId: str(data, "smsTemplateId"),
      whatsappTemplate: str(data, "whatsappTemplate"),
    });
    revalidatePath(adminPath(uni));
    return "Saved. New messages of this kind use these settings.";
  });
}

export async function resetKindAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await resetKindSettings(actor, str(data, "kind"));
    revalidatePath(adminPath(uni));
    return "Defaults restored.";
  });
}

export async function saveDeliverySettingsAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const r = await saveDeliverySettings(actor, { replyTo: str(data, "replyTo") });
    revalidatePath(adminPath(uni));
    return r.replyTo ? `Replies now go to ${r.replyTo}.` : "Emails go out without a reply-to address.";
  });
}

export async function testSendAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  const channel = str(data, "channel") as Channel;
  return attempt(async () => {
    if (!CHANNELS.includes(channel)) throw new ValidationError("Pick email, SMS or WhatsApp.");
    const r = await sendTestMessage(actor, str(data, "kind"), channel);
    revalidatePath(adminPath(uni));
    const what = channel === "email" ? "test email" : `test ${CHANNEL_LABEL[channel]}`;
    if (r.status === "sent") {
      return r.provider === "console" ? `The ${what} for ${r.to} was printed to the server log, because no provider is set up yet.` : `The ${what} went to ${r.to}.`;
    }
    if (r.status === "queued") throw new ValidationError(`The ${what} couldn't be sent yet: ${r.error ?? "the provider didn't answer"}. It will be tried again in a minute.`);
    throw new ValidationError(`The ${what} wasn't sent: ${r.error ?? "unknown error"}`);
  });
}

export async function retryDeliveryAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    await retryDelivery(actor, str(data, "deliveryId"));
    revalidatePath(adminPath(uni));
    return "Queued. It goes out within a minute.";
  });
}

/**
 * Saves the signed-in person's own choices. The person is always the actor: a user id in
 * the form is never read, so nobody can change someone else's settings from here.
 */
export async function savePreferencesAction(_: ActionState, data: FormData): Promise<ActionState> {
  const { uni, actor } = await ctx(data);
  return attempt(async () => {
    const shown = data.getAll("shown").map(String);
    const on = new Set(data.getAll("on").map(String));
    const entries: PreferenceInput[] = [];
    for (const cell of shown.slice(0, 500)) {
      const i = cell.lastIndexOf(":");
      const kind = cell.slice(0, i);
      const channel = cell.slice(i + 1) as Channel;
      if (!CHANNELS.includes(channel)) continue;
      entries.push({ kind, channel, enabled: on.has(cell) });
    }
    const { changed } = await savePreferences(actor, actor.userId, entries);
    revalidatePath(`/${uni}/learn/settings/notifications`);
    revalidatePath(adminPath(uni));
    return changed ? "Your notification settings are saved." : "Nothing changed.";
  });
}
