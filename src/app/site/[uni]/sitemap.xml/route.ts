/**
 * The site's sitemap: /site/<uni>/sitemap.xml. Lists the home page, the blog, every published
 * post, every published course and every live faculty profile. Nothing before the first publish.
 */
import { getSitemap, getSite } from "@/modules/website-builder/cached";
import { origin } from "@/modules/website-builder/site-url";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function GET(req: Request, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const site = await getSite(uni);
  if (!site) return new Response("Not found", { status: 404 });
  const base = origin(req);
  const entries = await getSitemap(uni, site.universityId);
  const body = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...entries.map(
      (e) =>
        `  <url><loc>${esc(base + e.path)}</loc>${e.lastModified ? `<lastmod>${e.lastModified}</lastmod>` : ""}<priority>${e.priority.toFixed(1)}</priority></url>`,
    ),
    `</urlset>`,
  ].join("\n");
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
