/**
 * The public origin for absolute links (sitemaps, robots). SITE_ORIGIN wins when set
 * (e.g. https://campus.zinny.in); otherwise the request's own host, as the proxy reports it.
 */
export function origin(req: Request): string {
  const configured = process.env.SITE_ORIGIN?.replace(/\/+$/, "");
  if (configured && /^https?:\/\/[^/]+$/.test(configured)) return configured;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
