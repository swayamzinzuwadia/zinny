/**
 * Templates: plain text with {{variables}}, turned into a branded HTML email (the
 * university's name, logo and colour) and a plain-text version. Template text is always
 * escaped, so an admin's template can never inject markup into an email.
 */
import type { UniversityLite } from "@/contracts/core";
import { TEMPLATE_VARIABLES, type TemplateVariable } from "./kinds";

export type TemplateVars = Record<TemplateVariable, string>;

const VAR_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Variables used in a template that don't exist, e.g. ["fristName"]. */
export function unknownVariables(template: string): string[] {
  const known = new Set<string>(TEMPLATE_VARIABLES);
  const bad = new Set<string>();
  for (const m of template.matchAll(VAR_RE)) if (!known.has(m[1])) bad.add(m[1]);
  // Unbalanced braces are almost always a typo.
  const stripped = template.replace(VAR_RE, "");
  if (/\{\{|\}\}/.test(stripped)) bad.add("{{…}}");
  return [...bad];
}

export function fill(template: string, vars: Partial<TemplateVars>): string {
  return template.replace(VAR_RE, (_, name: string) => (name in vars ? (vars[name as TemplateVariable] ?? "") : ""));
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Escaped text with http(s) links made clickable. */
function linkify(escaped: string, color: string): string {
  return escaped.replace(/https?:\/\/[^\s<>"']+/g, (url) => {
    const clean = url.replace(/[.,;:)]+$/, "");
    const rest = url.slice(clean.length);
    return `<a href="${clean}" style="color:${color};text-decoration:underline">${clean}</a>${rest}`;
  });
}

/** Plain text → paragraphs: blank lines split paragraphs, single line breaks stay. */
export function textToHtml(text: string, color: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 16px 0">${linkify(escapeHtml(p.trim()), color).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const DEFAULT_COLOR = "#0B5E4C";

export function brandColor(u: Pick<UniversityLite, "branding">): string {
  const c = u.branding?.primaryColor;
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : DEFAULT_COLOR;
}

/** The logo as an absolute http(s) URL, or null. */
export function logoUrl(u: Pick<UniversityLite, "branding">, absolute: (path: string) => string): string | null {
  const l = u.branding?.logoUrl;
  if (typeof l !== "string" || !l.trim() || l.length > 1000) return null;
  const url = l.startsWith("/") ? absolute(l) : l;
  return /^https?:\/\/[^\s"'<>]+$/i.test(url) ? url : null;
}

export function oneLine(s: string, max = 200): string {
  const flat = s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export type EmailFooter = {
  /** Why they got it: "You get these emails because you're enrolled at Demo University." */
  reason: string;
  settingsUrl?: string | null;
  /** Null for security messages, which can't be unsubscribed from. */
  unsubscribeUrl?: string | null;
  /** "timetable changes" in "Unsubscribe from timetable changes emails". */
  unsubscribeLabel?: string;
};

export type BrandedEmail = {
  university: Pick<UniversityLite, "name" | "branding">;
  absolute: (path: string) => string;
  heading: string;
  /** Plain text; paragraphs separated by blank lines. */
  body: string;
  /** Ready-made markup to use instead of `body` (another module's own email). Not escaped. */
  bodyHtml?: string;
  cta?: { label: string; url: string } | null;
  footer: EmailFooter;
};

/** A simple branded layout that renders in every mainstream email client (tables, inline styles). */
export function brandedHtml(e: BrandedEmail): string {
  const color = brandColor(e.university);
  const name = escapeHtml(e.university.name);
  const logo = logoUrl(e.university, e.absolute);
  const preheader = escapeHtml(oneLine(e.body, 140));
  const header = logo
    ? `<img src="${escapeHtml(logo)}" alt="${name}" height="40" style="display:block;height:40px;max-width:220px;border:0">`
    : `<span style="font-size:18px;font-weight:600;color:${color}">${name}</span>`;
  const cta = e.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 8px 0"><tr><td style="border-radius:999px;background:${color}">
<a href="${escapeHtml(e.cta.url)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#FAF6EA;text-decoration:none;border-radius:999px">${escapeHtml(e.cta.label)}</a>
</td></tr></table>`
    : "";
  const links: string[] = [];
  if (e.footer.settingsUrl) links.push(`<a href="${escapeHtml(e.footer.settingsUrl)}" style="color:#5D6B64;text-decoration:underline">Manage notification settings</a>`);
  if (e.footer.unsubscribeUrl)
    links.push(
      `<a href="${escapeHtml(e.footer.unsubscribeUrl)}" style="color:#5D6B64;text-decoration:underline">Unsubscribe from ${escapeHtml(e.footer.unsubscribeLabel ?? "these")} emails</a>`,
    );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(oneLine(e.heading))}</title>
</head>
<body style="margin:0;padding:0;background:#FAF6EA;color:#14261F;font-family:Lexend,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF6EA">
<tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 8px 18px 8px">${header}</td></tr>
<tr><td style="background:#FFFDF7;border:1px solid #E8E0CC;border-radius:22px;padding:28px 28px 20px 28px;font-size:15px;line-height:1.6">
<h1 style="margin:0 0 16px 0;font-size:21px;line-height:1.3;font-weight:600;color:#14261F">${escapeHtml(oneLine(e.heading, 300))}</h1>
${e.bodyHtml ?? textToHtml(e.body, color)}
${cta}
</td></tr>
<tr><td style="padding:18px 8px 0 8px;font-size:12px;line-height:1.6;color:#5D6B64">
<p style="margin:0 0 6px 0">${escapeHtml(e.footer.reason)}</p>
${links.length ? `<p style="margin:0 0 6px 0">${links.join(" &middot; ")}</p>` : ""}
<p style="margin:0">Sent by Zinny for ${name}.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The plain-text version of the same email. */
export function brandedText(e: BrandedEmail): string {
  const lines = [e.university.name, "", oneLine(e.heading, 300), "", e.body.trim()];
  if (e.cta) lines.push("", `${e.cta.label}: ${e.cta.url}`);
  lines.push("", "—", e.footer.reason);
  if (e.footer.settingsUrl) lines.push(`Manage notification settings: ${e.footer.settingsUrl}`);
  if (e.footer.unsubscribeUrl) lines.push(`Unsubscribe from ${e.footer.unsubscribeLabel ?? "these"} emails: ${e.footer.unsubscribeUrl}`);
  lines.push(`Sent by Zinny for ${e.university.name}.`);
  return lines.join("\n");
}

/**
 * An email another module built itself (an invite, a receipt). A fragment is wrapped in
 * the branded layout; a full document keeps its own design and gets the footer links
 * added before </body>. The text version gets them appended.
 */
export function decorateDirectEmail(
  m: { subject: string; html: string; text: string },
  ctx: { university: Pick<UniversityLite, "name" | "branding">; absolute: (path: string) => string; footer: EmailFooter },
): { html: string; text: string } {
  const isDocument = /<html[\s>]/i.test(m.html) || /<body[\s>]/i.test(m.html);
  const footerText = [
    "",
    "—",
    ctx.footer.reason,
    ...(ctx.footer.settingsUrl ? [`Manage notification settings: ${ctx.footer.settingsUrl}`] : []),
    ...(ctx.footer.unsubscribeUrl ? [`Unsubscribe from ${ctx.footer.unsubscribeLabel ?? "these"} emails: ${ctx.footer.unsubscribeUrl}`] : []),
  ].join("\n");
  const text = `${m.text.trimEnd()}\n${footerText}`;
  if (!isDocument) {
    const html = brandedHtml({
      university: ctx.university,
      absolute: ctx.absolute,
      heading: m.subject,
      body: m.text,
      bodyHtml: `<div style="color:#14261F">${m.html}</div>`,
      cta: null,
      footer: ctx.footer,
    });
    return { html, text };
  }
  const links: string[] = [];
  if (ctx.footer.settingsUrl) links.push(`<a href="${escapeHtml(ctx.footer.settingsUrl)}">Manage notification settings</a>`);
  if (ctx.footer.unsubscribeUrl) links.push(`<a href="${escapeHtml(ctx.footer.unsubscribeUrl)}">Unsubscribe from ${escapeHtml(ctx.footer.unsubscribeLabel ?? "these")} emails</a>`);
  const footer = `<div style="margin-top:24px;font-size:12px;color:#5D6B64;font-family:Helvetica,Arial,sans-serif"><p>${escapeHtml(ctx.footer.reason)}</p>${links.length ? `<p>${links.join(" &middot; ")}</p>` : ""}</div>`;
  const html = /<\/body>/i.test(m.html) ? m.html.replace(/<\/body>/i, `${footer}</body>`) : `${m.html}${footer}`;
  return { html, text };
}

/** First name for greetings: "Riya Sharma" → "Riya". */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
