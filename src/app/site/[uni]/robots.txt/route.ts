/**
 * The site's robots rules: /site/<uni>/robots.txt. Search engines read robots.txt only at the
 * root of a domain, so on a shared domain the root robots.txt should point here (see the
 * handoff); on a custom domain, /robots.txt is rewritten to this route.
 */
import { getSite } from "@/modules/website-builder/cached";
import { origin } from "@/modules/website-builder/site-url";

export async function GET(req: Request, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const site = await getSite(uni);
  if (!site) return new Response("Not found", { status: 404 });
  const base = origin(req);
  const lines = site.live
    ? ["User-agent: *", `Allow: /site/${uni}/`, `Disallow: /site/${uni}/preview`, "", `Sitemap: ${base}/site/${uni}/sitemap.xml`]
    : ["User-agent: *", `Disallow: /site/${uni}/`];
  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=3600" },
  });
}
