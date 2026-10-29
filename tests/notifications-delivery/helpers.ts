/** Shared setup for notifications-delivery tests. */
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { notifications, universities, users } from "@/db/schema";
import { notifDeliveries, notifUniversitySettings } from "@/modules/notifications-delivery/schema";
import type { OutboundEmail, OutboundText, Providers } from "@/modules/notifications-delivery/providers";
import { ProviderError } from "@/modules/notifications-delivery/providers";
import { notify, withTenant } from "@/server/core";
import { systemActorFor } from "@/server/actor";
import { makeDepartment, makeUniversity, person } from "../fixtures";

export type Sent = { channel: "email" | "sms" | "whatsapp"; to: string; email?: OutboundEmail; text?: OutboundText };

/** Providers that record what they send. `fail` decides per message whether to throw. */
export function recordingProviders(opts: { fail?: (s: Sent) => Error | null; delayMs?: number } = {}) {
  const sent: Sent[] = [];
  const attempts: Sent[] = [];
  const make = (channel: Sent["channel"]) => async (m: OutboundEmail | OutboundText) => {
    const s: Sent = channel === "email" ? { channel, to: m.to, email: m as OutboundEmail } : { channel, to: m.to, text: m as OutboundText };
    attempts.push(s);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const err = opts.fail?.(s);
    if (err) throw err;
    sent.push(s);
    return { id: `msg-${sent.length}` };
  };
  const providers: Providers = {
    email: { name: "test-email", send: make("email") },
    sms: { name: "test-sms", send: make("sms") },
    whatsapp: { name: "test-whatsapp", send: make("whatsapp") },
  };
  return { providers, sent, attempts };
}

export const retryable = (msg = "Provider is down (HTTP 503)") => new ProviderError(msg, true, 503);
export const permanent = (msg = "Invalid recipient (HTTP 422)") => new ProviderError(msg, false, 422);

/** A time zone whose local hour at `at` is `hour` (Etc/GMT zones cover every offset). */
export function zoneWithLocalHour(hour: number, at = new Date()): string {
  let offset = (hour - at.getUTCHours() + 24) % 24; // 0..23 hours ahead of UTC
  if (offset > 14) offset -= 24; // Etc/GMT-14 … Etc/GMT+12
  if (offset === 0) return "Etc/UTC";
  return offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

/**
 * A university with an admin, a HOD and two learners (with phone numbers), ready for delivery:
 * its delivery window starts an hour ago, so tests can run the job with a `now` in the future.
 */
export async function setupUni(opts: { name?: string; timezone?: string; branding?: { primaryColor?: string; logoUrl?: string } } = {}) {
  const uni = await makeUniversity(opts.name ?? "Delivery University");
  await systemDb()
    .update(universities)
    .set({ timezone: opts.timezone ?? "Asia/Kolkata", branding: opts.branding ?? {} })
    .where(eq(universities.id, uni.id));
  const dept = await makeDepartment(uni.id, "CS", "Computer Science");
  const admin = await (await person("Admin Asha", "institute_admin", { universityId: uni.id })).actor();
  const hod = await (await person("Hod Hema", "hod", { universityId: uni.id, departmentId: dept.id })).actor();
  const riyaP = await person("Riya Sharma", "student", { universityId: uni.id });
  const kabirP = await person("Kabir Mehta", "student", { universityId: uni.id });
  await systemDb().update(users).set({ phone: "98123 45678" }).where(eq(users.id, riyaP.user.id));
  await systemDb().update(users).set({ phone: "+91 98765 43210" }).where(eq(users.id, kabirP.user.id));
  await systemDb()
    .insert(notifUniversitySettings)
    .values({ universityId: uni.id, deliverFrom: new Date(Date.now() - 3_600_000) });
  const riya = await riyaP.actor();
  const kabir = await kabirP.actor();
  return { uni: { ...uni, timezone: opts.timezone ?? "Asia/Kolkata" }, dept, admin, hod, riya, kabir, system: systemActorFor(uni.id) };
}

/** Core's notify(), as other modules and core services use it. */
export async function notifyUsers(universityId: string, userIds: string[], n: { kind: string; title: string; body?: string; data?: Record<string, unknown> }) {
  await withTenant(systemActorFor(universityId), (tx) => notify(tx, universityId, userIds, n));
}

export async function deliveriesOf(universityId: string) {
  return systemDb().select().from(notifDeliveries).where(eq(notifDeliveries.universityId, universityId));
}

export async function notificationsOf(universityId: string) {
  return systemDb().select().from(notifications).where(eq(notifications.universityId, universityId));
}

export const minutes = (n: number) => n * 60_000;
export const later = (base: Date, ms: number) => new Date(base.getTime() + ms);

/** Silences console.log/error while `fn` runs (console providers and expected failures). */
export async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  const err = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
    console.error = err;
  }
}
