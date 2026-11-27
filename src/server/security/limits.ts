/**
 * Guards against guessing, kept in Postgres through the core throttle (idn_throttles), so a
 * limit holds across every server instance and restart (right for Vercel). Each guard is a
 * set of counters (per network, per person); a wrong guess counts on all of them, and the
 * first to reach its limit locks the guess out for a while.
 *
 * Joining codes are 6 characters from 32 (about a billion codes), and a matching code shows
 * the institute's name and lets anyone sign up as its student. Unlimited guessing would find
 * institutes in hours, so wrong codes are counted wherever a code is looked up: /signup?code=,
 * /join?code= and the join form.
 */
import "server-only";
import { lockedUntil, recordFailure, throttleKey, type Rule } from "@/server/auth/throttle";

export type Guard = readonly { key: string; rule: Rule }[];

const MIN = 60_000;
const HOUR = 60 * MIN;

export const JOIN_CODE_RULES = {
  /** One network: a school may have a whole class typing the code at once, so this is generous. */
  perNetwork: { limit: 60, windowMs: HOUR, lockMs: 30 * MIN },
  /** One signed-in person. */
  perPerson: { limit: 10, windowMs: HOUR, lockMs: HOUR },
} as const satisfies Record<string, Rule>;

export function joinCodeGuard(who: { ip: string | null; userId?: string | null }): Guard {
  const guard: { key: string; rule: Rule }[] = [{ key: throttleKey("sec-join-ip", who.ip ?? "unknown"), rule: JOIN_CODE_RULES.perNetwork }];
  if (who.userId) guard.push({ key: throttleKey("sec-join-user", who.userId), rule: JOIN_CODE_RULES.perPerson });
  return guard;
}

const latest = (dates: (Date | null)[]) => dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/** When any counter of the guard is locked, until when (the latest); otherwise null. */
export async function guardLockedUntil(guard: Guard, now = new Date()): Promise<Date | null> {
  return latest(await Promise.all(guard.map((g) => lockedUntil(g.key, now))));
}

/** Counts one wrong guess on every counter. Returns the lock it caused, if any. */
export async function guardFailure(guard: Guard, now = new Date()): Promise<Date | null> {
  const results = await Promise.all(guard.map((g) => recordFailure(g.key, g.rule, now)));
  return latest(results.map((r) => r.lockedUntil));
}

/** The message for a locked-out guess, in the screens' voice. */
export function joinCodeLockedMessage(until: Date, now = new Date()): string {
  const mins = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / MIN));
  const wait = mins < 60 ? `${mins} minute${mins === 1 ? "" : "s"}` : `${Math.ceil(mins / 60)} hour${Math.ceil(mins / 60) === 1 ? "" : "s"}`;
  return `Too many joining codes didn't match. Wait ${wait}, then try again, or check the code with your institute.`;
}
