/**
 * Cross-site request forgery: writes from another site are refused before any route handler
 * or server action runs; our own pages, webhooks and non-browser callers still get through.
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { checkWriteOrigin, requestHost } from "@/server/security/origin";

const headers = (h: Record<string, string>) => new Headers({ host: "app.zinny.test", ...h });

describe("checkWriteOrigin", () => {
  it("lets reads through whatever their origin", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) {
      expect(checkWriteOrigin(m, "/demo/learn", headers({ "sec-fetch-site": "cross-site", origin: "https://evil.test" })).ok).toBe(true);
    }
  });

  it("allows a write from our own pages", () => {
    expect(checkWriteOrigin("POST", "/login", headers({ "sec-fetch-site": "same-origin", origin: "https://app.zinny.test" })).ok).toBe(true);
    expect(checkWriteOrigin("POST", "/login", headers({ origin: "https://app.zinny.test" })).ok).toBe(true);
  });

  it("refuses a write from another site, including a sibling subdomain", () => {
    expect(checkWriteOrigin("POST", "/demo/learn/lessons/1/progress", headers({ "sec-fetch-site": "cross-site" }))).toEqual({ ok: false, reason: "cross-site" });
    expect(checkWriteOrigin("POST", "/demo/admin/website/upload", headers({ "sec-fetch-site": "same-site" }))).toEqual({ ok: false, reason: "cross-site" });
    expect(checkWriteOrigin("PUT", "/demo/admin/products/content/uploads/1", headers({ origin: "https://evil.test" }))).toEqual({ ok: false, reason: "origin-mismatch" });
    expect(checkWriteOrigin("DELETE", "/x", headers({ origin: "https://other.zinny.test" }))).toEqual({ ok: false, reason: "origin-mismatch" });
  });

  it("refuses an opaque origin (sandboxed frames, data: pages)", () => {
    expect(checkWriteOrigin("POST", "/login", headers({ origin: "null" }))).toEqual({ ok: false, reason: "opaque-origin" });
    expect(checkWriteOrigin("POST", "/login", headers({ origin: "not a url" }))).toEqual({ ok: false, reason: "opaque-origin" });
  });

  it("compares with the forwarded host behind a proxy (Vercel)", () => {
    const h = new Headers({ host: "internal:3000", "x-forwarded-host": "app.zinny.in", origin: "https://app.zinny.in" });
    expect(requestHost(h)).toBe("app.zinny.in");
    expect(checkWriteOrigin("POST", "/login", h).ok).toBe(true);
  });

  it("lets the Razorpay webhook and one-click unsubscribe through: they carry their own signature", () => {
    const cross = headers({ "sec-fetch-site": "cross-site", origin: "https://api.razorpay.com" });
    expect(checkWriteOrigin("POST", "/api/payments/razorpay", cross).ok).toBe(true);
    expect(checkWriteOrigin("POST", "/demo/learn/settings/notifications/unsubscribe", cross).ok).toBe(true);
    expect(checkWriteOrigin("POST", "/api/payments/razorpay/extra", cross).ok).toBe(false);
  });

  it("lets a caller that isn't a browser through (no Origin, no Sec-Fetch-Site): it can't carry a victim's cookies", () => {
    expect(checkWriteOrigin("POST", "/demo/learn/lessons/1/progress", headers({})).ok).toBe(true);
  });
});

describe("Proxy", () => {
  it("answers a cross-site write with 403 and a plain explanation", async () => {
    const res = proxy(
      new NextRequest("https://app.zinny.test/demo/learn/lessons/1/progress", { method: "POST", headers: { host: "app.zinny.test", "sec-fetch-site": "cross-site" } }),
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/came from another website/);
  });

  it("passes a same-origin server action on to Next.js", () => {
    const res = proxy(
      new NextRequest("https://app.zinny.test/login", { method: "POST", headers: { host: "app.zinny.test", "sec-fetch-site": "same-origin", origin: "https://app.zinny.test", "next-action": "abc" } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
