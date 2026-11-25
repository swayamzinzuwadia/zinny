/**
 * Browser security headers: the Content-Security-Policy the proxy sets on each request, the
 * fixed headers next.config.ts sets on every response, and the build check that keeps
 * prerendered pages on the static policy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import nextConfig from "../../next.config";
import { proxy } from "@/proxy";
import {
  PERMISSIONS_POLICY,
  buildCsp,
  cspModeFor,
  makeNonce,
  staticSecurityHeaders,
  storageOrigins,
} from "@/server/security/csp";
import { misclassifiedRoutes, samplePath, uncoveredStaticRoutes } from "@/server/security/check-static-csp";

const directives = (csp: string) => new Map(csp.split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v] as const));

afterEach(() => vi.unstubAllEnvs());

describe("Content-Security-Policy", () => {
  it("allows scripts only with the request's nonce on pages rendered per request", () => {
    const csp = directives(buildCsp({ mode: "nonce", nonce: "abc123==" }));
    const script = csp.get("script-src")!;
    expect(script).toContain("'nonce-abc123=='");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("refuses plugins, <base> tags, other sites framing us and form posts to other sites", () => {
    const csp = directives(buildCsp({ mode: "nonce", nonce: "n" }));
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.get("default-src")).toEqual(["'self'"]);
  });

  it("allows only the third parties the app loads: Razorpay checkout and the video players", () => {
    const csp = directives(buildCsp({ mode: "nonce", nonce: "n" }));
    expect(csp.get("frame-src")).toEqual(
      expect.arrayContaining(["https://api.razorpay.com", "https://checkout.razorpay.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com"]),
    );
    expect(csp.get("connect-src")).toEqual(expect.arrayContaining(["'self'", "https://api.razorpay.com"]));
    expect(csp.get("connect-src")).not.toContain("*");
    expect(csp.get("connect-src")).not.toContain("https:");
  });

  it("adds eval and the hot-reload websocket only in development", () => {
    const dev = directives(buildCsp({ mode: "nonce", nonce: "n", dev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
    const prod = directives(buildCsp({ mode: "nonce", nonce: "n" }));
    expect(prod.get("connect-src")).not.toContain("ws:");
  });

  it("upgrades stray http sub-resources only when served over https", () => {
    expect(buildCsp({ mode: "nonce", nonce: "n", https: true })).toContain("upgrade-insecure-requests");
    expect(buildCsp({ mode: "nonce", nonce: "n", https: false })).not.toContain("upgrade-insecure-requests");
  });

  it("needs a nonce for the nonce policy", () => {
    expect(() => buildCsp({ mode: "nonce" })).toThrow();
  });

  it("makes a fresh 128-bit nonce each time", () => {
    const a = makeNonce();
    const b = makeNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, "base64")).toHaveLength(16);
  });

  it("gives prerendered pages the static policy and every other page the nonce policy", () => {
    for (const p of ["/site/demo", "/site/demo/blog/hello", "/book-a-demo", "/signup/institute", "/suspended", "/_not-found"]) {
      expect(cspModeFor(p), p).toBe("static");
    }
    for (const p of ["/", "/login", "/marketplace", "/demo/admin", "/demo/learn", "/platform", "/signup", "/sitemap", "/siteadmin"]) {
      expect(cspModeFor(p), p).toBe("nonce");
    }
    const stat = directives(buildCsp({ mode: "static" }));
    expect(stat.get("script-src")).toContain("'self'");
    expect(stat.get("script-src")).not.toContain("'strict-dynamic'");
    expect(stat.get("object-src")).toEqual(["'none'"]);
    expect(stat.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("leaves route handlers (files, JSON, webhooks) to set their own policy", () => {
    for (const p of [
      "/api/storage/uni/abc.pdf",
      "/api/payments/razorpay",
      "/demo/learn/lessons/123/file",
      "/demo/learn/settings/notifications/unsubscribe",
      "/site/demo/media/123",
      "/demo/learn/invoices/123",
      "/demo/admin/products/batches/1/timetable.csv",
    ]) {
      expect(cspModeFor(p), p).toBe("handler");
    }
    // A page with a similar shape keeps its page policy.
    expect(cspModeFor("/demo/admin/finance/invoices/123")).toBe("nonce");
    expect(cspModeFor("/demo/learn/lessons/123")).toBe("nonce");
  });

  it("adds the file bucket's origin for media, frames and fetches when files live in S3", () => {
    expect(storageOrigins({ STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com/" })).toEqual(["https://acc.r2.cloudflarestorage.com"]);
    expect(storageOrigins({ S3_ENDPOINT: "https://acc.r2.cloudflarestorage.com" })).toEqual([]);
    expect(storageOrigins({ STORAGE_DRIVER: "s3", S3_ENDPOINT: "javascript:alert(1)" })).toEqual([]);
    const csp = directives(buildCsp({ mode: "nonce", nonce: "n", storage: ["https://files.example.com"] }));
    expect(csp.get("media-src")).toContain("https://files.example.com");
    expect(csp.get("connect-src")).toContain("https://files.example.com");
  });
});

describe("Fixed security headers", () => {
  it("sends HSTS with preload, nosniff, a strict referrer policy, COOP and frame denial", () => {
    const h = Object.fromEntries(staticSecurityHeaders().map((x) => [x.key, x.value]));
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=(\d+); includeSubDomains; preload/);
    expect(Number(/max-age=(\d+)/.exec(h["Strict-Transport-Security"])![1])).toBeGreaterThanOrEqual(31_536_000);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toMatch(/^same-origin/);
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toBe(PERMISSIONS_POLICY);
  });

  it("switches off camera, microphone and location, and allows full screen only for us and the players", () => {
    expect(PERMISSIONS_POLICY).toContain("camera=()");
    expect(PERMISSIONS_POLICY).toContain("microphone=()");
    expect(PERMISSIONS_POLICY).toContain("geolocation=()");
    expect(PERMISSIONS_POLICY).toMatch(/fullscreen=\(self "https:\/\/www\.youtube-nocookie\.com"/);
  });

  it("next.config.ts removes X-Powered-By, keeps browser source maps private and applies the headers everywhere", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    expect(all.headers.map((h) => h.key)).toEqual(expect.arrayContaining(["Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy", "X-Frame-Options"]));
    // Same-origin framing for the PDF routes comes after the catch-all, so it wins.
    const storage = rules.findIndex((r) => r.source === "/api/storage/:path*");
    expect(storage).toBeGreaterThan(rules.indexOf(all));
    expect(rules[storage].headers).toEqual([{ key: "X-Frame-Options", value: "SAMEORIGIN" }]);
  });
});

describe("Proxy", () => {
  const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(new URL(path, "https://app.zinny.test"), { method: init.method ?? "GET", headers: { host: "app.zinny.test", ...init.headers } });

  it("sets a nonce CSP on the response and hands the same policy to Next.js through the request", () => {
    const res = proxy(req("/demo/learn"));
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("upgrade-insecure-requests");
    // NextResponse.next({ request: { headers } }) passes overridden request headers this way.
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
  });

  it("uses a different nonce on every request", () => {
    const a = proxy(req("/login")).headers.get("content-security-policy");
    const b = proxy(req("/login")).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });

  it("gives prerendered pages the static policy without touching the request", () => {
    const res = proxy(req("/site/demo"));
    expect(res.headers.get("content-security-policy")).not.toContain("'nonce-");
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBeNull();
  });

  it("sets no policy on route handlers, so their own (stricter) headers stand", () => {
    for (const p of ["/demo/learn/settings/notifications/unsubscribe", "/site/demo/media/1", "/api/storage/a/b.pdf"]) {
      const res = proxy(req(p));
      expect(res.headers.get("content-security-policy"), p).toBeNull();
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("fails closed in production when a required secret is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "");
    vi.stubEnv("CRON_SECRET", "x".repeat(40));
    vi.stubEnv("KYC_ENCRYPTION_KEY", "a".repeat(64));
    const res = proxy(req("/login"));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("serves normally in production once the secrets are set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", "y".repeat(48));
    vi.stubEnv("CRON_SECRET", "x".repeat(40));
    vi.stubEnv("KYC_ENCRYPTION_KEY", "a".repeat(64));
    vi.stubEnv("ZINNY_DEMO", "");
    const res = proxy(req("/login"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).not.toContain("'unsafe-eval'");
  });
});

describe("Build check for prerendered pages", () => {
  it("turns a route pattern into a concrete path", () => {
    expect(samplePath("/site/[uni]/blog/[slug]")).toBe("/site/x/blog/x");
    expect(samplePath("/docs/[...rest]")).toBe("/docs/x");
  });

  it("flags a prerendered HTML page that would get the nonce policy, and ignores images and feeds", () => {
    const manifest = {
      routes: {
        "/book-a-demo": { dataRoute: "/book-a-demo.rsc" },
        "/pricing": { dataRoute: "/pricing.rsc" },
        "/icon.png": { initialHeaders: { "content-type": "image/png" } },
        "/site/-/sitemap.xml": { initialHeaders: { "content-type": "text/plain" } },
      },
      dynamicRoutes: { "/site/[uni]": {}, "/courses/[id]": {} },
    };
    expect(uncoveredStaticRoutes(manifest)).toEqual(["/courses/[id]", "/pricing"]);
  });

  it("flags a page that would get no policy and a route handler that would get a page policy", () => {
    const appPaths = {
      "/[uni]/learn/page": "/[uni]/learn",
      "/[uni]/learn/lessons/[lessonId]/file/route": "/[uni]/learn/lessons/[lessonId]/file",
      "/[uni]/admin/reports/export/page": "/[uni]/admin/reports/export",
      "/[uni]/learn/feed/route": "/[uni]/learn/feed",
    };
    expect(misclassifiedRoutes(appPaths)).toEqual({ pages: ["/[uni]/admin/reports/export"], handlers: ["/[uni]/learn/feed"] });
  });
});
