/**
 * Runs before every request (Next.js 16 "proxy", formerly middleware). Security only:
 *
 *  1. Production refuses to serve until its secrets are set (src/server/security/env.ts).
 *  2. Writes from another site are refused (src/server/security/origin.ts).
 *  3. Public searches are rate limited per network (in memory, per instance).
 *  4. Every page gets a Content-Security-Policy. Pages rendered per request get a fresh
 *     nonce, which Next.js reads from the request's CSP header and puts on its own scripts;
 *     prerendered pages get the static policy. Route handlers (files, JSON) keep their own
 *     (src/server/security/csp.ts).
 *
 * The other security headers (HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP,
 * X-Frame-Options) are the same for every response, so next.config.ts sets them, static
 * files included.
 */
import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, cspModeFor, makeNonce, storageOrigins } from "@/server/security/csp";
import { isProductionServer, productionSecretProblems } from "@/server/security/env";
import { checkWriteOrigin } from "@/server/security/origin";
import { slidingWindow } from "@/server/security/rate-limit";

const g = globalThis as unknown as { __zinnySecurity?: { searches: ReturnType<typeof slidingWindow>; warned: boolean } };
const state = (g.__zinnySecurity ??= {
  /** Marketplace searches: 60 a minute from one network, per server instance. */
  searches: slidingWindow({ limit: 60, windowMs: 60_000 }),
  warned: false,
});

const plain = (status: number, body: string, extra: Record<string, string> = {}) =>
  new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...extra } });

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || req.headers.get("x-real-ip")?.trim() || "unknown").slice(0, 64);
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isProductionServer(process.env)) {
    const problems = productionSecretProblems(process.env);
    if (problems.length) {
      if (!state.warned) {
        state.warned = true;
        // Names and reasons only, never values.
        console.error(`[security] Refusing requests until these are fixed: ${problems.map((p) => `${p.name} (${p.problem})`).join("; ")}`);
      }
      return plain(503, "Zinny isn't available right now. The site's settings are incomplete; the team has been told.", { "retry-after": "300" });
    }
  }

  const write = checkWriteOrigin(req.method, pathname, req.headers);
  if (!write.ok) {
    return plain(403, "This request came from another website, so it was refused. Open Zinny directly and try again.");
  }

  if (req.method === "GET" && pathname.startsWith("/marketplace") && req.nextUrl.searchParams.get("q")?.trim()) {
    const hit = state.searches.take(clientIp(req));
    if (!hit.ok) {
      return plain(429, "Too many searches from your network. Wait a minute, then search again.", { "retry-after": String(hit.retryAfterSeconds) });
    }
  }

  const mode = cspModeFor(pathname);
  // Route handlers (files, JSON, webhooks) keep whatever policy they set themselves.
  if (mode === "handler") return NextResponse.next();

  const dev = process.env.NODE_ENV === "development";
  const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const nonce = mode === "nonce" ? makeNonce() : undefined;
  const csp = buildCsp({ mode, nonce, dev, https, storage: storageOrigins(process.env) });

  let res: NextResponse;
  if (nonce) {
    // Next.js takes the nonce from the request's CSP header while rendering.
    const headers = new Headers(req.headers);
    headers.set("content-security-policy", csp);
    headers.set("x-nonce", nonce);
    res = NextResponse.next({ request: { headers } });
  } else {
    res = NextResponse.next();
  }
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // Everything except build assets, which carry no HTML (next.config.ts still gives them the other headers).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|opengraph-image\\.png).*)"],
};
