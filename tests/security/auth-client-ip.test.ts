/**
 * AUTH-03: the address per-network limits count against. It used to be the first entry of
 * X-Forwarded-For, which the caller writes themselves behind a load balancer that appends
 * (AWS). A caller could then dodge the per-network limits on sign-in, sign-up, codes and
 * resets, or lock a school's shared address out by sending its address with wrong passwords.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import { clientIpFrom, trustedProxyHops } from "@/server/auth/session";
import { signInWithPassword } from "@/modules/identity/auth";
import { makeUser } from "../fixtures";
import { setPassword } from "../identity/helpers";

afterEach(() => vi.unstubAllEnvs());
afterAll(closeDb);

const h = (values: Record<string, string>) => new Headers(values);

describe("AUTH-03: the caller's address", () => {
  it("ignores what the caller put in X-Forwarded-For in front of the proxy's entry", () => {
    // An AWS load balancer appends the address it saw; the caller wrote "6.6.6.6".
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), 1)).toBe("203.0.113.9");
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6,7.7.7.7, 203.0.113.9" }), 1)).toBe("203.0.113.9");
    // Vercel replaces the header with the caller's address alone.
    expect(clientIpFrom(h({ "x-forwarded-for": "203.0.113.9" }), 1)).toBe("203.0.113.9");
    // Two proxies (CloudFront, then the load balancer): the second entry from the right.
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 130.176.1.1" }), 2)).toBe("203.0.113.9");
    // More hops than entries: the leftmost there is.
    expect(clientIpFrom(h({ "x-forwarded-for": "203.0.113.9" }), 3)).toBe("203.0.113.9");
    // No X-Forwarded-For: X-Real-IP, else nothing.
    expect(clientIpFrom(h({ "x-real-ip": "198.51.100.4" }), 1)).toBe("198.51.100.4");
    expect(clientIpFrom(h({}), 1)).toBeNull();
  });

  it("reads TRUSTED_PROXY_HOPS, falling back to one hop for anything that isn't a small whole number", () => {
    expect(trustedProxyHops({} as NodeJS.ProcessEnv)).toBe(1);
    expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: "2" } as unknown as NodeJS.ProcessEnv)).toBe(2);
    for (const bad of ["0", "-1", "abc", "1.5", "99"]) expect(trustedProxyHops({ TRUSTED_PROXY_HOPS: bad } as unknown as NodeJS.ProcessEnv)).toBe(1);
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 130.176.1.1" }))).toBe("203.0.113.9");
  });

  it("a caller can't spread wrong passwords over made-up networks: they all count against the real one", async () => {
    const real = `203.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    // 50 wrong passwords (LIMITS.passwordPerIp) across different emails, each with a different forged address.
    let last: Awaited<ReturnType<typeof signInWithPassword>> | null = null;
    for (let i = 0; i < 50; i++) {
      const ip = clientIpFrom(h({ "x-forwarded-for": `10.9.${i}.1, ${real}` }), 1);
      last = await signInWithPassword({ email: `spray.${i}.${real}@nowhere.test`, password: "wrong guess here", ip });
    }
    expect(last).toMatchObject({ ok: false, reason: "network_locked" });
    // The network stays locked whatever the next forged address is, right password or not.
    const u = await makeUser("Spray Target");
    await setPassword(u.id, "correct horse battery");
    const next = clientIpFrom(h({ "x-forwarded-for": `10.200.0.1, ${real}` }), 1);
    expect(await signInWithPassword({ email: u.email, password: "correct horse battery", ip: next })).toMatchObject({ ok: false, reason: "network_locked" });
  });
});
