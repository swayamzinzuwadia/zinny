/**
 * A sliding-window rate limiter kept in memory, for the public verify page.
 *
 * It limits per server instance. On a platform that runs many instances (Vercel), the
 * real limit is this times the number of warm instances; codes carry 60 random bits, so
 * guessing stays hopeless either way. A shared store is listed in the handoff.
 */
export type RateLimiter = {
  /** Records a hit for `key` if there is room. */
  take(key: string, now?: number): { ok: boolean; retryAfterSeconds: number };
  /** Whether `key` is at its limit, without recording anything. */
  blocked(key: string, now?: number): { blocked: boolean; retryAfterSeconds: number };
  reset(): void;
};

export function createRateLimiter(o: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  const maxKeys = o.maxKeys ?? 20_000;
  const live = (key: string, now: number) => (hits.get(key) ?? []).filter((t) => t > now - o.windowMs);
  const retry = (list: number[], now: number) => Math.max(1, Math.ceil((list[0] + o.windowMs - now) / 1000));
  return {
    take(key, now = Date.now()) {
      const list = live(key, now);
      if (list.length >= o.limit) {
        hits.set(key, list);
        return { ok: false, retryAfterSeconds: retry(list, now) };
      }
      list.push(now);
      hits.delete(key); // re-insert so the map stays in least-recently-used order
      hits.set(key, list);
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return { ok: true, retryAfterSeconds: 0 };
    },
    blocked(key, now = Date.now()) {
      const list = live(key, now);
      return list.length >= o.limit ? { blocked: true, retryAfterSeconds: retry(list, now) } : { blocked: false, retryAfterSeconds: 0 };
    },
    reset() {
      hits.clear();
    },
  };
}

const g = globalThis as unknown as { __zinnyCertLimits?: { lookups: RateLimiter; misses: RateLimiter } };

/** 30 look-ups per 10 minutes per visitor, and at most 10 codes that don't exist. */
export const verifyLimits = (g.__zinnyCertLimits ??= {
  lookups: createRateLimiter({ limit: 30, windowMs: 10 * 60_000 }),
  misses: createRateLimiter({ limit: 10, windowMs: 10 * 60_000 }),
});

/**
 * Who is asking: the first address in X-Forwarded-For (set by the hosting proxy), then
 * X-Real-IP. Behind no proxy at all every visitor shares one bucket, which errs on the
 * side of limiting.
 */
export function clientKey(h: { get(name: string): string | null }): string {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || h.get("x-real-ip")?.trim() || "unknown";
  return ip.slice(0, 64);
}
