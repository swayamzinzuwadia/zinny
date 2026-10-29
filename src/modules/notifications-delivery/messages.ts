/**
 * Turns a notification into the message each channel sends, using the university's
 * template for its kind and the university's own name, logo and colour.
 */
import type { UniversityLite } from "@/contracts/core";
import { absoluteUrl, signToken } from "./config";
import { isSecurityKind, type KindTemplate } from "./kinds";
import { brandedHtml, brandedText, fill, firstName, oneLine, type EmailFooter, type TemplateVars } from "./render";
import type { DeliveryPayload } from "./schema";
import type { KindConfig } from "./store";

export type MessagePerson = { id: string | null; name: string; email: string; learner: boolean };

export type MessageInput = {
  university: UniversityLite;
  person: MessagePerson;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export const settingsPath = (uni: string, learner: boolean) =>
  learner ? `/${uni}/learn/settings/notifications` : `/${uni}/admin/settings/notifications?tab=mine`;

export const unsubscribePath = (uni: string, token: string) => `/${uni}/learn/settings/notifications/unsubscribe?t=${encodeURIComponent(token)}`;

/** The one-click unsubscribe link for one person (or address) and one kind. */
export function unsubscribeUrl(university: Pick<UniversityLite, "id" | "slug">, recipient: { personId: string | null; email: string }, kind: string) {
  const token = signToken(recipient.personId ? { u: university.id, p: recipient.personId, k: kind } : { u: university.id, a: recipient.email.toLowerCase(), k: kind });
  return absoluteUrl(unsubscribePath(university.slug, token));
}

export function messageVars(m: MessageInput, link: string | null): TemplateVars {
  return {
    name: m.person.name,
    firstName: firstName(m.person.name),
    title: m.title,
    body: m.body,
    university: m.university.name,
    link: link ? absoluteUrl(link) : absoluteUrl(`/${m.university.slug}`),
  };
}

/** "You get these emails because …": why this person receives the message. */
export function footerReason(university: Pick<UniversityLite, "name">, opts: { security: boolean; learner: boolean; person: boolean }) {
  if (opts.security) return `This is a security message about your ${university.name} account, so it can't be turned off.`;
  if (!opts.person) return `You got this email from ${university.name}.`;
  return opts.learner
    ? `You get these emails because you learn at ${university.name}.`
    : `You get these emails because of your role at ${university.name}.`;
}

export function emailFooter(
  university: Pick<UniversityLite, "id" | "slug" | "name">,
  recipient: { personId: string | null; email: string; learner: boolean },
  kind: string,
  kindLabel: string,
): EmailFooter {
  const security = isSecurityKind(kind);
  return {
    reason: footerReason(university, { security, learner: recipient.learner, person: !!recipient.personId }),
    settingsUrl: recipient.personId ? absoluteUrl(settingsPath(university.slug, recipient.learner)) : null,
    unsubscribeUrl: security ? null : unsubscribeUrl(university, recipient, kind),
    unsubscribeLabel: kindLabel.toLowerCase(),
  };
}

/** Headers for one-click unsubscribe (RFC 8058), which Gmail and Yahoo expect from bulk senders. */
export function unsubscribeHeaders(url: string | null | undefined): Record<string, string> {
  if (!url) return {};
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}

const tidy = (s: string) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export function renderEmail(m: MessageInput, cfg: KindConfig, template: KindTemplate = cfg.template): Required<Pick<DeliveryPayload, "subject" | "html" | "text" | "headers">> {
  const link = cfg.def.link(m.university.slug, m.data);
  const vars = messageVars(m, link);
  const subject = oneLine(fill(template.emailSubject, vars), 200) || oneLine(m.title, 200) || cfg.def.label;
  const body = tidy(fill(template.emailBody, vars));
  const footer = emailFooter(m.university, { personId: m.person.id, email: m.person.email, learner: m.person.learner }, m.kind, cfg.def.label);
  const email = {
    university: m.university,
    absolute: absoluteUrl,
    heading: m.title || subject,
    body,
    cta: link ? { label: cfg.def.ctaLabel, url: absoluteUrl(link) } : null,
    footer,
  };
  return { subject, html: brandedHtml(email), text: brandedText(email), headers: unsubscribeHeaders(footer.unsubscribeUrl) };
}

/** SMS and WhatsApp: one line, with the variables MSG91 templates use. */
export function renderText(m: MessageInput, cfg: KindConfig, template: KindTemplate = cfg.template): { text: string; vars: Record<string, string> } {
  const link = cfg.def.link(m.university.slug, m.data);
  const vars = messageVars(m, link);
  const text = oneLine(fill(template.smsText, vars), 480) || oneLine(`${m.university.name}: ${m.title}`, 480);
  return {
    text,
    vars: {
      name: oneLine(vars.name, 60),
      firstName: oneLine(vars.firstName, 30),
      title: oneLine(vars.title, 120),
      body: oneLine(vars.body, 200),
      university: oneLine(vars.university, 60),
      link: vars.link,
      text,
    },
  };
}
