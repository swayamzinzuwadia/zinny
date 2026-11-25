/**
 * npm run build → postbuild. Checks the build's manifests against the Content-Security-Policy
 * route lists in src/server/security/csp.ts, and fails the build when:
 *
 *  - a page is prerendered (static or ISR) but would get the nonce policy. Its HTML is made
 *    once and can't carry a per-request nonce, so in production its scripts would be blocked
 *    and the page would stop working, while `next dev` (which renders every request) looks fine.
 *    Fix: add it to STATIC_ROUTES, or make the page render per request (`await connection()`).
 *  - a page matches HANDLER_ROUTES, so it would get no policy at all. Fix: rename the route or
 *    narrow the pattern.
 *  - a route handler doesn't match HANDLER_ROUTES, so the proxy would replace its own headers
 *    with a page policy. Fix: add a pattern for it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cspModeFor } from "./csp";

type PrerenderManifest = {
  routes: Record<string, { dataRoute?: string | null; initialHeaders?: Record<string, string> }>;
  dynamicRoutes: Record<string, unknown>;
};
/** .next/app-path-routes-manifest.json: "/[uni]/learn/page" → "/[uni]/learn". */
type AppPaths = Record<string, string>;

/** A concrete path for a route pattern: /site/[uni]/blog/[slug] → /site/x/blog/x. */
export const samplePath = (route: string) => route.replace(/\[\[?\.{0,3}[^\]]+\]\]?/g, "x");

const isFile = (path: string) => /\.[a-z0-9]+$/i.test(path.split("/").pop() ?? "");

function isHtml(route: string, info: PrerenderManifest["routes"][string] | undefined): boolean {
  if (isFile(route)) return false;
  const type = info?.initialHeaders?.["content-type"];
  return !type || type.startsWith("text/html");
}

/** Prerendered HTML routes that would get the nonce policy. */
export function uncoveredStaticRoutes(m: PrerenderManifest): string[] {
  const out: string[] = [];
  for (const [route, info] of Object.entries(m.routes)) if (isHtml(route, info) && cspModeFor(route) !== "static") out.push(route);
  for (const route of Object.keys(m.dynamicRoutes)) if (isHtml(route, undefined) && cspModeFor(samplePath(route)) !== "static") out.push(route);
  return [...new Set(out)].sort();
}

/** Pages that would get no policy, and route handlers that would get a page policy. */
export function misclassifiedRoutes(m: AppPaths): { pages: string[]; handlers: string[] } {
  const pages: string[] = [];
  const handlers: string[] = [];
  for (const [entry, route] of Object.entries(m)) {
    const mode = cspModeFor(samplePath(route));
    if (entry.endsWith("/page") && mode === "handler") pages.push(route);
    if (entry.endsWith("/route") && mode !== "handler") handlers.push(route);
  }
  return { pages: pages.sort(), handlers: handlers.sort() };
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

function main() {
  const dir = join(process.cwd(), ".next");
  const prerender = readJson<PrerenderManifest>(join(dir, "prerender-manifest.json"));
  const appPaths = readJson<AppPaths>(join(dir, "app-path-routes-manifest.json"));
  if (!prerender || !appPaths) {
    console.log("check-static-csp: no build manifests in .next, nothing to check.");
    return;
  }
  const problems: string[] = [];
  const statics = uncoveredStaticRoutes(prerender);
  if (statics.length) {
    problems.push(
      "These pages are prerendered, so they can't carry the per-request CSP nonce and their scripts would be blocked in production. Add each to STATIC_ROUTES, or make the page render per request (await connection() from next/server):",
      ...statics.map((r) => `  ${r}`),
    );
  }
  const { pages, handlers } = misclassifiedRoutes(appPaths);
  if (pages.length) problems.push("These pages match HANDLER_ROUTES, so they would get no Content-Security-Policy:", ...pages.map((r) => `  ${r}`));
  if (handlers.length) {
    problems.push("These route handlers don't match HANDLER_ROUTES, so the proxy would replace their headers with a page policy:", ...handlers.map((r) => `  ${r}`));
  }
  if (problems.length) {
    console.error(["check-static-csp: the route lists in src/server/security/csp.ts need updating.", ...problems].join("\n"));
    process.exit(1);
  }
  console.log("check-static-csp: every page and route handler gets the right Content-Security-Policy.");
}

if (process.argv[1] && /check-static-csp\.ts$/.test(process.argv[1])) main();
