/**
 * Rate limits and temporary locks, kept in idn_throttles (system connection only).
 *
 * Keys are "<kind>:<sha256 of the email, phone or IP>", so no address is stored in clear.
 * Every update is a single atomic upsert, so concurrent requests can't slip past a limit.
 * Times are passed in from the app (not the database clock) so tests can move time.
 */
import { eq, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { idnThrottles } from "@/modules/identity/schema";
import { MAX_LOCK_DOUBLINGS } from "./config";
import { sha256 } from "./tokens";

export type Rule = {
  /** How many hits are allowed inside the window. */
  limit: number;
  windowMs: number;
  /** For failure counters: how long the lock lasts once `limit` failures happen. */
  lockMs?: number;
};

export const throttleKey = (kind: string, value: string) => `${kind}:${sha256(value.trim().toLowerCase())}`;

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

type Row = { hits: number; window_start: string | Date; locked_until: string | Date | null; lock_count: number };

/** Counts one hit atomically. A lock that ended more than a day ago no longer makes the next one longer. */
async function bump(key: string, rule: Rule, now: Date): Promise<Row> {
  const cutoff = new Date(now.getTime() - rule.windowMs);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const rows = await systemDb().execute<Row>(sql`
    insert into idn_throttles as t (key, hits, window_start, updated_at)
    values (${key}, 1, ${ts(now)}, ${ts(now)})
    on conflict (key) do update set
      hits = case when t.window_start <= ${ts(cutoff)} then 1 else t.hits + 1 end,
      window_start = case when t.window_start <= ${ts(cutoff)} then ${ts(now)} else t.window_start end,
      lock_count = case when t.locked_until is not null and t.locked_until < ${ts(dayAgo)} then 0 else t.lock_count end,
      updated_at = ${ts(now)}
    returning hits, window_start, locked_until, lock_count`);
  return rows[0];
}

const asDate = (v: string | Date | null) => (v === null ? null : v instanceof Date ? v : new Date(v));

/** When the key is locked, until when; otherwise null. */
export async function lockedUntil(key: string, now = new Date()): Promise<Date | null> {
  const [row] = await systemDb().select({ lockedUntil: idnThrottles.lockedUntil }).from(idnThrottles).where(eq(idnThrottles.key, key));
  return row?.lockedUntil && row.lockedUntil > now ? row.lockedUntil : null;
}

/**
 * Counts one failure. When the count reaches `rule.limit` inside the window, the key is
 * locked for `rule.lockMs` and the count starts again. Each further lock within a day
 * lasts twice as long (up to MAX_LOCK_DOUBLINGS times).
 * Returns the lock (if this failure caused one) and how many tries are left before it.
 */
export async function recordFailure(key: string, rule: Rule, now = new Date()): Promise<{ lockedUntil: Date | null; remaining: number }> {
  const row = await bump(key, rule, now);
  if (row.hits < rule.limit) return { lockedUntil: null, remaining: rule.limit - row.hits };
  const factor = 2 ** Math.min(row.lock_count, MAX_LOCK_DOUBLINGS);
  const until = new Date(now.getTime() + (rule.lockMs ?? rule.windowMs) * factor);
  await systemDb()
    .update(idnThrottles)
    .set({ lockedUntil: until, hits: 0, windowStart: now, lockCount: sql`${idnThrottles.lockCount} + 1`, updatedAt: now })
    .where(eq(idnThrottles.key, key));
  return { lockedUntil: until, remaining: 0 };
}

/**
 * Counts one use of something rate-limited (sending a code, asking for a reset link).
 * `ok` is false once the limit is used up; `retryAt` says when the window ends.
 */
export async function consume(key: string, rule: Rule, now = new Date()): Promise<{ ok: boolean; retryAt: Date }> {
  const row = await bump(key, rule, now);
  const start = asDate(row.window_start)!;
  return { ok: row.hits <= rule.limit, retryAt: new Date(start.getTime() + rule.windowMs) };
}

/** Forgets a key: after a successful sign-in, or when a password reset proves who someone is. */
export async function clearThrottle(key: string): Promise<void> {
  await systemDb().delete(idnThrottles).where(eq(idnThrottles.key, key));
}

/** Housekeeping: rows whose window and lock both ended more than a day ago. */
export async function pruneThrottles(now = new Date()): Promise<number> {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const res = await systemDb()
    .delete(idnThrottles)
    .where(sql`${idnThrottles.updatedAt} < ${ts(dayAgo)} and (${idnThrottles.lockedUntil} is null or ${idnThrottles.lockedUntil} < ${ts(dayAgo)})`)
    .returning({ key: idnThrottles.key });
  return res.length;
}
