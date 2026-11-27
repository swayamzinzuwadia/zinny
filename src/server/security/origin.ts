/**
 * Cross-site request forgery guard for every request that can change something (POST, PUT,
 * PATCH, DELETE), applied by the proxy before any route handler or server action runs.
 *
 * Next.js already checks the Origin of server actions; route handlers (uploads, lesson
 * progress, attendance) get no such check, so this covers them too. The session cookie is
 * SameSite=Lax, which stops other sites but not sibling subdomains ("same-site"); this
 * refuses those as well.
 *
 * Rules, in order:
 *  1. Safe methods (GET, HEAD, OPTIONS) pass.
 *  2. Endpoints called by other servers with their own secret pass (EXEMPT_WRITES).
 *  3. A browser's Sec-Fetch-Site header must say "same-origin" (or "none": typed by the user).
 *  4. Without it, an Origin header must match the host the request was sent to.
 *  5. With neither header the caller isn't a browser, so it can't be carrying a victim's
 *     cookies from another site: it passes, and the route's own checks apply.
 *
 * Plain module: no Node or Next imports.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Called by other servers, never by our pages; each checks its own signature or token. */
export const EXEMPT_WRITES: readonly RegExp[] = [
  // Razorpay webhook: HMAC signature with RAZORPAY_WEBHOOK_SECRET.
  /^\/api\/payments\/razorpay\/?$/,
  // One-click unsubscribe from mail apps (RFC 8058): a signed token in the link, no cookies.
  /^\/[^/]+\/learn\/settings\/notifications\/unsubscribe\/?$/,
];

type HeaderBag = { get(name: string): string | null };

export type WriteCheck = { ok: true } | { ok: false; reason: "cross-site" | "origin-mismatch" | "opaque-origin" };

/** The host the browser sent the request to: the proxy's forwarded host first (Vercel sets it), then Host. */
export function requestHost(h: HeaderBag): string | null {
  const forwarded = h.get("x-forwarded-host")?.split(",")[0]?.trim();
  return (forwarded || h.get("host")?.trim() || null)?.toLowerCase() ?? null;
}

export function checkWriteOrigin(method: string, pathname: string, h: HeaderBag): WriteCheck {
  if (SAFE_METHODS.has(method.toUpperCase())) return { ok: true };
  if (EXEMPT_WRITES.some((re) => re.test(pathname))) return { ok: true };

  const site = h.get("sec-fetch-site")?.trim().toLowerCase();
  if (site) return site === "same-origin" || site === "none" ? { ok: true } : { ok: false, reason: "cross-site" };

  const origin = h.get("origin")?.trim();
  if (!origin) return { ok: true };
  if (origin === "null") return { ok: false, reason: "opaque-origin" };
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return { ok: false, reason: "opaque-origin" };
  }
  return originHost === requestHost(h) ? { ok: true } : { ok: false, reason: "origin-mismatch" };
}
