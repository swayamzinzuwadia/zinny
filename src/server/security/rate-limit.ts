/**
 * Rate limits for abuse-prone forms.
 *
 * Two kinds, for two jobs:
 *  - `slidingWindow()`: in memory, per server instance. Free and instant, so it suits a
 *    first line of defence on hot paths. On Vercel each warm instance keeps its own count,
 *    so the real ceiling is the limit times the number of instances.
 *  - `guardFailures()` (./limits.ts): kept in Postgres (idn_throttles through the core
 *    throttle), so it holds across instances and restarts. Use it for anything guessable:
 *    codes, passwords, tokens.
 *
 * Plain module: no Node or Next imports.
 */

export type SlidingWindow = {
  /** Records a hit for `key` when there's room. */
  take(key: string, now?: number): { ok: boolean; retryAfterSeconds: number };
  /** Whether `key` is at its limit, without recording anything. */
  peek(key: string, now?: number): { ok: boolean; retryAfterSeconds: number };
  reset(): void;
};

export function slidingWindow(o: { limit: number; windowMs: number; maxKeys?: number }): SlidingWindow {
  if (!(o.limit > 0) || !(o.windowMs > 0)) throw new Error("A sliding window needs a positive limit and window.");
  const hits = new Map<string, number[]>();
  const maxKeys = o.maxKeys ?? 10_000;
  const live = (key: string, now: number) => (hits.get(key) ?? []).filter((t) => t > now - o.windowMs);
  const retry = (list: number[], now: number) => Math.max(1, Math.ceil((list[0] + o.windowMs - now) / 1000));
  return {
    take(key, now = Date.now()) {
      const list = live(key, now);
      const ok = list.length < o.limit;
      if (ok) list.push(now);
      // Re-insert so the map stays in least-recently-used order (a key that keeps hitting its
      // limit stays too), then drop the least recently used keys.
      hits.delete(key);
      hits.set(key, list);
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return ok ? { ok: true, retryAfterSeconds: 0 } : { ok: false, retryAfterSeconds: retry(list, now) };
    },
    peek(key, now = Date.now()) {
      const list = live(key, now);
      return list.length >= o.limit ? { ok: false, retryAfterSeconds: retry(list, now) } : { ok: true, retryAfterSeconds: 0 };
    },
    reset() {
      hits.clear();
    },
  };
}
