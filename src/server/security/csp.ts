/**
 * Content-Security-Policy and the other browser security headers, in one place so the
 * proxy (src/proxy.ts), next.config.ts and the tests all agree.
 *
 * Two page policies, and one hands-off case:
 *  - "nonce" (the default, every page rendered per request): scripts run only when they
 *    carry this request's nonce, or were added by a script that did ('strict-dynamic').
 *    Next.js reads the nonce from the request's CSP header and puts it on its own scripts.
 *  - "static" (pages prerendered at build time or by ISR, listed in STATIC_ROUTES): their
 *    HTML is made once and served to everyone, so it can't carry a per-request nonce. They
 *    run inline scripts from our own origin only. Everything else is the same.
 *  - "handler" (route handlers, listed in HANDLER_ROUTES: files, downloads, JSON, webhooks):
 *    the proxy sets no policy, because a header it set would replace the handler's own
 *    (the unsubscribe page and website media set stricter ones) and a PDF shown in the
 *    browser must not be held to a page's rules.
 *
 * `npm run build` checks the build's manifests against these lists
 * (src/server/security/check-static-csp.ts) and fails when a prerendered page would get the
 * nonce policy (its scripts would be blocked in production, though `next dev` looks fine),
 * when a page would get no policy, or when a route handler would get a page policy.
 *
 * Plain module: no Node or Next imports, so the proxy, the build check and tests can use it.
 */

export type CspMode = "nonce" | "static" | "handler";

/**
 * Route handlers (route.ts). Matched on the path's shape, since a page and a route handler
 * can't share a path.
 */
export const HANDLER_ROUTES: readonly RegExp[] = [
  /^\/api\//,
  // Files, downloads, exports and uploads.
  /\/(file|download|pdf|export|sample|upload|uploads|progress|start|search|unsubscribe)\/?$/,
  /\/uploads\/[^/]+\/?$/,
  /\/documents\/[^/]+\/?$/,
  /\/assignments\/files\/[^/]+\/?$/,
  /\/(learn|sales)\/invoices\/[^/]+\/?$/,
  /^\/site\/[^/]+\/media\/[^/]+\/?$/,
  /^\/verify\/fonts\//,
  /\.(csv|txt|xml|png|ico)$/,
];

/**
 * Pages prerendered at build time or by ISR (the ○ and ● rows of `next build`). Each is a
 * pathname regex. Keep this list short: anything here allows inline scripts.
 */
export const STATIC_ROUTES: readonly RegExp[] = [
  // Institute websites: ISR, revalidated every few minutes (website-builder).
  /^\/site(\/|$)/,
  // Plain marketing and status pages with no per-request data.
  /^\/book-a-demo\/?$/,
  /^\/signup\/institute\/?$/,
  /^\/suspended\/?$/,
  // Next's own prerendered fallbacks (served for unmatched URLs and render errors).
  /^\/_not-found\/?$/,
  /^\/_global-error\/?$/,
];

export function cspModeFor(pathname: string): CspMode {
  if (HANDLER_ROUTES.some((re) => re.test(pathname))) return "handler";
  return STATIC_ROUTES.some((re) => re.test(pathname)) ? "static" : "nonce";
}

/** Third parties the app really loads. Add a host only with the feature that needs it. */
export const THIRD_PARTY = {
  /** Razorpay Checkout: checkout.js on our page, its payment form in an iframe from api.razorpay.com. */
  razorpay: {
    script: ["https://checkout.razorpay.com"],
    frame: ["https://api.razorpay.com", "https://checkout.razorpay.com"],
    connect: ["https://api.razorpay.com", "https://lumberjack.razorpay.com", "https://lumberjack-cx.razorpay.com"],
  },
  /** Lesson videos and institute-site videos (YouTube's iframe API is a script on our page). */
  video: {
    script: ["https://www.youtube.com"],
    frame: ["https://www.youtube-nocookie.com", "https://www.youtube.com", "https://player.vimeo.com"],
  },
} as const;

/**
 * The origin of the file store when files are served from a bucket (STORAGE_DRIVER=s3):
 * signed links send videos, PDFs and images straight from there.
 */
export function storageOrigins(env: Record<string, string | undefined>): string[] {
  if (env.STORAGE_DRIVER !== "s3") return [];
  // Signed links are path-style: <S3_ENDPOINT>/<bucket>/<key> (src/contracts/storage.ts).
  if (!env.S3_ENDPOINT) return [];
  try {
    const u = new URL(env.S3_ENDPOINT);
    return u.protocol === "https:" || u.protocol === "http:" ? [u.origin] : [];
  } catch {
    // Not a URL: storage itself refuses to start, so there's nothing to allow.
    return [];
  }
}

export type CspOptions = {
  mode: Exclude<CspMode, "handler">;
  /** Required for mode "nonce". */
  nonce?: string;
  /** `next dev`: React needs eval for its error overlay, and hot reload uses a websocket. */
  dev?: boolean;
  /** Served over https: ask the browser to upgrade any stray http:// sub-resource. */
  https?: boolean;
  /** Extra origins for media, frames and fetches (the file store). */
  storage?: string[];
};

const uniq = (xs: readonly string[]) => [...new Set(xs)];

export function buildCsp(o: CspOptions): string {
  if (o.mode === "nonce" && !o.nonce) throw new Error("A nonce is required for the nonce policy.");
  const storage = o.storage ?? [];
  const thirdPartyScripts = [...THIRD_PARTY.razorpay.script, ...THIRD_PARTY.video.script];
  const script =
    o.mode === "nonce"
      ? // 'self' and the hosts only matter to browsers without 'strict-dynamic' (CSP level 2).
        ["'self'", `'nonce-${o.nonce}'`, "'strict-dynamic'", ...thirdPartyScripts]
      : ["'self'", "'unsafe-inline'", ...thirdPartyScripts];
  if (o.dev) script.push("'unsafe-eval'");

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", script],
    // React renders style="" attributes and Next injects <style> tags; style injection can't run code.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    ["media-src", uniq(["'self'", "blob:", ...storage])],
    ["connect-src", uniq(["'self'", ...THIRD_PARTY.razorpay.connect, ...storage, ...(o.dev ? ["ws:", "wss:"] : [])])],
    ["frame-src", uniq(["'self'", ...THIRD_PARTY.razorpay.frame, ...THIRD_PARTY.video.frame, ...storage])],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'none'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const parts = directives.map(([k, v]) => `${k} ${v.join(" ")}`);
  if (o.https) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** 128 random bits, base64. Web Crypto, so it works in any runtime. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Video players embedded in our pages may go full screen, autoplay and play encrypted media. */
const PLAYERS = THIRD_PARTY.video.frame.map((o) => `"${o}"`).join(" ");
const PAYMENTS = THIRD_PARTY.razorpay.frame.map((o) => `"${o}"`).join(" ");

/**
 * Browser features. Off unless a screen uses them: no camera or microphone (live classes
 * open in the meeting app), no location, no USB. Full screen for tests and video players.
 */
export const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "display-capture=()",
  "usb=()",
  "serial=()",
  "hid=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "xr-spatial-tracking=()",
  "idle-detection=()",
  "browsing-topics=()",
  `payment=(self ${PAYMENTS})`,
  `fullscreen=(self ${PLAYERS})`,
  `autoplay=(self ${PLAYERS})`,
  `picture-in-picture=(self ${PLAYERS})`,
  `encrypted-media=(self ${PLAYERS})`,
  "clipboard-write=(self)",
].join(", ");

export type Header = { key: string; value: string };

/**
 * Headers for every response (pages, files, static assets), set in next.config.ts.
 * The CSP is set per request by the proxy, because it carries the nonce.
 */
export function staticSecurityHeaders(): Header[] {
  return [
    // Two years, every subdomain, and eligible for the browsers' preload list.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    // Pages we open keep their opener (Razorpay's bank and UPI windows need it); pages that open us don't.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    // For browsers that predate CSP frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "Origin-Agent-Cluster", value: "?1" },
  ];
}

/**
 * Files our own pages show inside an iframe (the PDF viewer's fallback frame): next.config.ts
 * `headers()` sources that get X-Frame-Options: SAMEORIGIN instead of DENY.
 */
export const SAME_ORIGIN_FRAMEABLE_SOURCES = [
  "/api/storage/:path*",
  "/:uni/learn/lessons/:lessonId/file",
  "/:uni/admin/products/content/lessons/:lessonId/file",
];
