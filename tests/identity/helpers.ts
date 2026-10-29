/**
 * Test helpers for identity: capture emails and texts (through a test-only module that
 * registers mail and SMS transports), a cookie jar, and a `defer` that runs tasks now.
 */
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import type { MailMessage } from "@/contracts/mail";
import type { SmsMessage } from "@/contracts/sms";
import type { ZinnyModule } from "@/contracts/module";
import { setTestModules } from "@/server/registry";
import type { CookieJar, CookieOptions } from "@/server/auth/session";
import { hashPassword } from "@/server/auth/passwords";
import identity from "@/modules/identity";

export const mail: MailMessage[] = [];
export const sms: SmsMessage[] = [];

const capture: ZinnyModule = {
  // Any id works for a test-only module; it only carries the transports.
  id: "notifications-delivery",
  mailTransport: { name: "test-mail", send: async (m) => (mail.push(m), {}) },
  smsTransport: { name: "test-sms", send: async (m) => (sms.push(m), {}) },
};

/** Identity's real handlers plus capturing transports, and nothing from other modules. */
export function useIdentityOnly() {
  setTestModules([identity, capture], { only: true });
}

export function resetOutbox() {
  mail.length = 0;
  sms.length = 0;
}

export const mailTo = (email: string) => mail.filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(email));
export const smsTo = (phone: string) => sms.filter((m) => m.to === phone);

/** The first /invite/… or /reset/… link in the newest email to `email`. */
export function linkIn(email: string, kind: "invite" | "reset"): string {
  const m = mailTo(email).at(-1);
  if (!m) throw new Error(`No email to ${email}`);
  const match = new RegExp(`/${kind}/([A-Za-z0-9_.-]+)`).exec(m.text);
  if (!match) throw new Error(`No ${kind} link in: ${m.text}`);
  return match[1];
}

/** The 6-digit code in the newest SMS to `phone`. */
export function codeIn(phone: string): string {
  const m = smsTo(phone).at(-1);
  if (!m) throw new Error(`No SMS to ${phone}`);
  return /\b(\d{6})\b/.exec(m.text)![1];
}

/** Runs deferred work at once, collecting the promises so a test can await them. */
export function inlineDefer() {
  const pending: Promise<void>[] = [];
  const defer = (task: () => Promise<void>) => void pending.push(task());
  return { defer, flush: () => Promise.all(pending) };
}

export function cookieJar(initial: Record<string, string> = {}): CookieJar & { values: Map<string, string>; options: Map<string, CookieOptions> } {
  const values = new Map(Object.entries(initial));
  const options = new Map<string, CookieOptions>();
  return {
    values,
    options,
    get: (name) => (values.has(name) ? { value: values.get(name)! } : undefined),
    set: (name, value, opts) => {
      values.set(name, value);
      options.set(name, opts);
    },
    delete: (name) => {
      values.delete(name);
    },
  };
}

export async function setPassword(userId: string, password: string) {
  await systemDb().update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, userId));
}

export async function setPhone(userId: string, phone: string | null) {
  await systemDb().update(users).set({ phone }).where(eq(users.id, userId));
}

export const minutes = (n: number) => n * 60_000;
export const later = (from: Date, ms: number) => new Date(from.getTime() + ms);
