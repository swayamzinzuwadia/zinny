/**
 * Unsubscribe links from notification emails. They work without signing in: the signed
 * token names the university, the person (or address) and the kind, and nothing else.
 *
 *   GET   shows what the link does and a button (mail scanners open links, so GET changes nothing)
 *   POST  applies it: the button's form, or a mail app's one-click request (RFC 8058,
 *         body "List-Unsubscribe=One-Click"), which gets a plain 200
 *
 * A route handler rather than a page, because the learner layout requires a session.
 */
import { renderUnsubscribePage } from "@/modules/notifications-delivery/components/unsubscribe-page";
import { unsubscribeLink } from "@/modules/notifications-delivery/service";

export const dynamic = "force-dynamic";

const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });

export async function GET(req: Request, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const view = await unsubscribeLink(token, uni, "view").catch(() => null);
  return html(renderUnsubscribePage(view, { token, done: null }), view ? 200 : 404);
}

export async function POST(req: Request, { params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const url = new URL(req.url);
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const token = String(form?.get("t") ?? url.searchParams.get("t") ?? "");
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const action = !oneClick && form?.get("action") === "resubscribe" ? "resubscribe" : "unsubscribe";
  const view = await unsubscribeLink(token, uni, action).catch(() => null);
  if (oneClick) return new Response(view ? "Unsubscribed." : "This link isn't valid.", { status: view ? 200 : 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return html(renderUnsubscribePage(view, { token, done: view ? action : null }), view ? 200 : 404);
}
