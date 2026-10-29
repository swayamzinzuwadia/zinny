/**
 * The standalone unsubscribe page (served by a route handler, outside the app's layouts,
 * so it works without signing in). Plain HTML with the brand tokens and the university's
 * own name, logo and colour. Every value is escaped.
 */
import { absoluteUrl } from "../config";
import { brandColor, escapeHtml, logoUrl } from "../render";
import type { UnsubscribeView } from "../service";

const shell = (title: string, inner: string, color: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#FAF6EA;color:#14261F;font-family:"Lexend Variable",Lexend,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  main{max-width:480px;margin:0 auto;padding:40px 16px}
  .card{background:#FFFDF7;border:1px solid #E8E0CC;border-radius:22px;padding:28px}
  h1{margin:0 0 10px;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.02em}
  p{margin:0 0 14px;font-size:15px;line-height:1.6;color:#5D6B64}
  strong{color:#14261F;font-weight:500}
  .brand{margin:0 0 18px 4px;font-size:17px;font-weight:600;color:${color}}
  .brand img{display:block;height:36px;max-width:220px}
  button{appearance:none;border:0;border-radius:999px;height:42px;padding:0 22px;font:inherit;font-size:14px;font-weight:500;cursor:pointer}
  .primary{background:${color};color:#FAF6EA}
  .secondary{background:#FFFDF7;color:#14261F;border:1px solid #E8E0CC}
  button:focus-visible{outline:2px solid #D4A72A;outline-offset:2px}
  .done{background:#E3EEE8;color:#084A3C;border-radius:16px;padding:12px 14px;font-size:14px;margin:0 0 16px}
  .foot{margin-top:18px;font-size:12px;color:#98A39D;text-align:center}
</style>
</head>
<body><main>${inner}<p class="foot">Sent by Zinny</p></main></body>
</html>`;

export function renderUnsubscribePage(view: UnsubscribeView | null, opts: { token: string; done: "unsubscribe" | "resubscribe" | null }): string {
  if (!view) {
    return shell(
      "Link not valid",
      `<div class="card"><h1>This link isn't valid</h1><p>It may have been copied only in part. Open the link from the email again, or sign in to Zinny and change your notification settings there.</p></div>`,
      "#0B5E4C",
    );
  }
  const color = brandColor(view.university);
  const logo = logoUrl(view.university, absoluteUrl);
  const name = escapeHtml(view.university.name);
  const brand = `<div class="brand">${logo ? `<img src="${escapeHtml(logo)}" alt="${name}">` : name}</div>`;
  const label = escapeHtml(view.label.toLowerCase());
  const token = escapeHtml(opts.token);
  const form = (action: "unsubscribe" | "resubscribe", text: string, cls: string) =>
    `<form method="post"><input type="hidden" name="t" value="${token}"><input type="hidden" name="action" value="${action}"><button class="${cls}" type="submit">${text}</button></form>`;

  const notice =
    opts.done === "unsubscribe"
      ? `<div class="done">Done. ${escapeHtml(view.recipient)} won't get ${label} emails from ${name} any more.</div>`
      : opts.done === "resubscribe"
        ? `<div class="done">Done. ${label[0]?.toUpperCase() ?? ""}${label.slice(1)} emails are back on.</div>`
        : "";

  const body = view.subscribed
    ? `<h1>Stop ${label} emails?</h1>
<p>${escapeHtml(view.recipient)} will stop getting <strong>${label}</strong> emails from ${name}. You'll still see these notifications when you sign in, and other emails don't change.</p>
${form("unsubscribe", "Unsubscribe", "primary")}`
    : `<h1>You're unsubscribed</h1>
<p>${escapeHtml(view.recipient)} doesn't get <strong>${label}</strong> emails from ${name}. You'll still see these notifications when you sign in.</p>
${form("resubscribe", "Turn these emails back on", "secondary")}`;

  return shell(`${view.label} emails`, `${brand}<div class="card">${notice}${body}</div>`, color);
}
