/**
 * Rate limits: the in-memory sliding window (public searches) and the Postgres-backed guard
 * against guessing joining codes (/signup?code=, /join?code= and the join form).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { closeDb } from "@/db/client";
import { clearThrottle } from "@/server/auth/throttle";
import { slidingWindow } from "@/server/security/rate-limit";
import { JOIN_CODE_RULES, guardFailure, guardLockedUntil, joinCodeGuard, joinCodeLockedMessage } from "@/server/security/limits";
import { proxy } from "@/proxy";

afterAll(() => closeDb());

describe("slidingWindow", () => {
  it("allows `limit` hits in the window, then refuses with the seconds to wait", () => {
    const w = slidingWindow({ limit: 3, windowMs: 60_000 });
    const t = 1_000_000;
    expect(w.take("ip", t).ok).toBe(true);
    expect(w.take("ip", t + 1).ok).toBe(true);
    expect(w.take("ip", t + 2).ok).toBe(true);
    const fourth = w.take("ip", t + 10_000);
    expect(fourth).toEqual({ ok: false, retryAfterSeconds: 50 });
    expect(w.peek("ip", t + 10_000).ok).toBe(false);
  });

  it("slides: the oldest hit leaves the window and frees a slot", () => {
    const w = slidingWindow({ limit: 2, windowMs: 1_000 });
    expect(w.take("k", 0).ok).toBe(true);
    expect(w.take("k", 500).ok).toBe(true);
    expect(w.take("k", 900).ok).toBe(false);
    expect(w.take("k", 1_001).ok).toBe(true);
    expect(w.take("k", 1_200).ok).toBe(false);
  });

  it("counts each key separately and forgets the least recently used keys past maxKeys", () => {
    const w = slidingWindow({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    expect(w.take("a", 0).ok).toBe(true);
    expect(w.take("b", 0).ok).toBe(true);
    expect(w.take("a", 1).ok).toBe(false);
    w.take("c", 2); // pushes out "b"
    expect(w.take("b", 3).ok).toBe(true);
  });

  it("rejects a limiter that could never allow anything", () => {
    expect(() => slidingWindow({ limit: 0, windowMs: 1 })).toThrow();
  });
});

describe("Marketplace search limit in the proxy", () => {
  it("answers 429 with Retry-After once a network has searched 60 times in a minute", () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    const search = (q: string) => proxy(new NextRequest(`https://app.zinny.test/marketplace?q=${q}`, { headers: { host: "app.zinny.test", "x-forwarded-for": ip } }));
    for (let i = 0; i < 60; i++) expect(search(`a${i}`).status).toBe(200);
    const res = search("one-more");
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Browsing without a search isn't limited.
    expect(proxy(new NextRequest("https://app.zinny.test/marketplace", { headers: { host: "app.zinny.test", "x-forwarded-for": ip } })).status).toBe(200);
  });
});

describe("Joining-code guard (Postgres)", () => {
  const ip = "203.0.113.77";
  const userId = "00000000-0000-4000-8000-0000000000aa";
  const guard = joinCodeGuard({ ip, userId });
  const anonymous = joinCodeGuard({ ip });
  const t0 = new Date("2026-11-24T10:00:00Z");
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);

  beforeEach(async () => {
    for (const g of guard) await clearThrottle(g.key);
  });

  it("counts per network and, when signed in, per person", () => {
    expect(guard).toHaveLength(2);
    expect(anonymous).toHaveLength(1);
    expect(anonymous[0].key).toBe(guard[0].key);
    // Keys hold a hash, never the address itself.
    expect(guard.map((g) => g.key).join(" ")).not.toContain(ip);
  });

  it("locks a person out after 10 wrong codes in an hour, for an hour", async () => {
    for (let i = 0; i < JOIN_CODE_RULES.perPerson.limit - 1; i++) expect(await guardFailure(guard, at(i))).toBeNull();
    expect(await guardLockedUntil(guard, at(9))).toBeNull();
    const lock = await guardFailure(guard, at(9));
    expect(lock?.toISOString()).toBe(at(9 + 60).toISOString());
    expect((await guardLockedUntil(guard, at(30)))?.toISOString()).toBe(lock!.toISOString());
    expect(await guardLockedUntil(guard, at(70))).toBeNull();
    expect(joinCodeLockedMessage(lock!, at(30))).toBe("Too many joining codes didn't match. Wait 39 minutes, then try again, or check the code with your institute.");
  });

  it("locks a whole network only after 60 wrong codes, so a class typing its code isn't stopped", async () => {
    for (let i = 0; i < JOIN_CODE_RULES.perNetwork.limit - 1; i++) expect(await guardFailure(anonymous, at(0))).toBeNull();
    expect(await guardLockedUntil(anonymous, at(1))).toBeNull();
    expect(await guardFailure(anonymous, at(1))).not.toBeNull();
    expect(await guardLockedUntil(anonymous, at(2))).not.toBeNull();
    // The network lock also stops a signed-in person on that network.
    expect(await guardLockedUntil(guard, at(2))).not.toBeNull();
  });

  it("a wrong-code window starts again after an hour", async () => {
    for (let i = 0; i < 9; i++) await guardFailure(guard, at(0));
    expect(await guardFailure(guard, at(61))).toBeNull();
  });
});
