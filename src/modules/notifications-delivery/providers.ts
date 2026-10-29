/**
 * Provider clients. Email goes through Resend; SMS and WhatsApp through MSG91. Without
 * keys, messages print to the console (the same console transports core uses), so
 * development and tests never reach a real provider.
 *
 * Every client throws ProviderError on failure, saying whether trying again later can help
 * (rate limits, timeouts and server errors) or not (a bad number, a missing template).
 */
import { consoleMailTransport } from "@/contracts/mail";
import { consoleSmsTransport } from "@/contracts/sms";
import { msg91Config, resendConfig } from "./config";
import type { Channel } from "./schema";

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type OutboundEmail = {
  to: string;
  /** Shown as the sender's name, e.g. the university's name. The address always comes from MAIL_FROM. */
  fromName?: string | null;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  headers?: Record<string, string>;
  kind: string;
  /** Resend keeps a key for 24 hours and won't send the same key twice. */
  idempotencyKey: string;
};

export type OutboundText = {
  /** E.164. */
  to: string;
  /** The rendered message (what the console prints; MSG91 gets it as the `text` variable). */
  text: string;
  kind: string;
  /** Template variables for MSG91 (SMS: by name; WhatsApp: in TEXT_VARIABLE_ORDER). */
  vars: Record<string, string>;
  /** MSG91 template id for SMS (DLT). */
  templateId?: string | null;
  /** Approved WhatsApp template name. */
  whatsappTemplate?: string | null;
};

export type SendResult = { id: string | null };

export type EmailProvider = { name: string; send(m: OutboundEmail): Promise<SendResult> };
/** SMS and WhatsApp share one interface. */
export type TextProvider = { name: string; send(m: OutboundText): Promise<SendResult> };
export type Providers = { email: EmailProvider; sms: TextProvider; whatsapp: TextProvider };

/** WhatsApp template body variables, in order: {{1}} first name, {{2}} headline, {{3}} institute, {{4}} link. */
export const WHATSAPP_VARIABLE_ORDER = ["firstName", "title", "university", "link"] as const;

const TIMEOUT_MS = 10_000;

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; data: unknown }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let data: unknown = raw;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      /* not JSON: keep the text */
    }
    return { status: res.status, data };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new ProviderError(aborted ? "The provider didn't answer within 10 seconds." : `Couldn't reach the provider: ${e instanceof Error ? e.message : String(e)}`, true);
  } finally {
    clearTimeout(timer);
  }
}

const retryableStatus = (s: number) => s === 408 || s === 409 || s === 425 || s === 429 || s >= 500;

function errorText(data: unknown): string {
  if (typeof data === "string") return data.slice(0, 300);
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const parts = [d.message, d.error, d.errors, d.name].filter((v) => v !== undefined && v !== null);
    if (parts.length) return parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ").slice(0, 300);
  }
  return "no details";
}

/* ───────────────────────────── Resend ───────────────────────────── */

/** "Zinny <n@mail.zinny.in>" + "Demo University" → "\"Demo University via Zinny\" <n@mail.zinny.in>". */
export function fromHeader(from: string, name?: string | null): string {
  const address = /<([^>]+)>/.exec(from)?.[1]?.trim() ?? from.trim();
  const clean = (name ?? "").replace(/["<>\\\r\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 70);
  return clean ? `"${clean} via Zinny" <${address}>` : from;
}

/** Resend tag values allow only letters, numbers, underscores and dashes. */
const tagValue = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256) || "none";

export function resendProvider(): EmailProvider | null {
  const cfg = resendConfig();
  if (!cfg) return null;
  return {
    name: "resend",
    async send(m) {
      const { status, data } = await post(
        `${cfg.baseUrl}/emails`,
        { Authorization: `Bearer ${cfg.apiKey}`, "Idempotency-Key": m.idempotencyKey.slice(0, 256), "User-Agent": "zinny-notifications/1" },
        {
          from: fromHeader(cfg.from, m.fromName),
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(m.replyTo ? { reply_to: m.replyTo } : {}),
          ...(m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {}),
          tags: [{ name: "kind", value: tagValue(m.kind) }],
        },
      );
      if (status >= 200 && status < 300) {
        const id = data && typeof data === "object" ? (data as { id?: unknown }).id : null;
        return { id: typeof id === "string" ? id : null };
      }
      throw new ProviderError(`Resend refused the email (HTTP ${status}): ${errorText(data)}`, retryableStatus(status), status);
    },
  };
}

/* ───────────────────────────── MSG91 ───────────────────────────── */

const msg91Mobile = (e164: string) => e164.replace(/^\+/, "");

/** MSG91 answers 200 with { type: "error" } for some refusals. */
function msg91Outcome(status: number, data: unknown, what: string): SendResult {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const failed = d.type === "error" || d.hasError === true || d.status === "fail" || d.status === "error";
  if (status >= 200 && status < 300 && !failed) {
    const id = d.request_id ?? d.requestId ?? (typeof d.message === "string" ? d.message : null) ?? (typeof d.data === "string" ? d.data : null);
    return { id: typeof id === "string" ? id : null };
  }
  // Throttling words in a 200 body still mean "try later".
  const throttled = /throttl|too many|rate limit/i.test(errorText(data));
  throw new ProviderError(`MSG91 refused the ${what} (HTTP ${status}): ${errorText(data)}`, retryableStatus(status) || throttled, status);
}

export function msg91SmsProvider(): TextProvider | null {
  const cfg = msg91Config();
  if (!cfg) return null;
  return {
    name: "msg91",
    async send(m) {
      const templateId = m.templateId?.trim() || cfg.templates[m.kind] || cfg.templates.default || null;
      if (!templateId) {
        throw new ProviderError(
          `No MSG91 template id for "${m.kind}". Indian SMS must use a DLT-registered template: add its MSG91 template id in Settings, Notifications.`,
          false,
        );
      }
      const { status, data } = await post(
        `${cfg.baseUrl}/api/v5/flow`,
        { authkey: cfg.authKey },
        {
          template_id: templateId,
          short_url: "0",
          ...(cfg.senderId ? { sender: cfg.senderId } : {}),
          recipients: [{ mobiles: msg91Mobile(m.to), ...m.vars, text: m.text }],
        },
      );
      return msg91Outcome(status, data, "SMS");
    },
  };
}

export function msg91WhatsappProvider(): TextProvider | null {
  const cfg = msg91Config();
  if (!cfg) return null;
  return {
    name: "msg91-whatsapp",
    async send(m) {
      if (!cfg.whatsappNumber) {
        throw new ProviderError("WhatsApp isn't set up: set MSG91_WHATSAPP_NUMBER to the business number connected in MSG91.", false);
      }
      const template = m.whatsappTemplate?.trim();
      if (!template) {
        throw new ProviderError(`No WhatsApp template for "${m.kind}". Add the approved template's name in Settings, Notifications.`, false);
      }
      const components: Record<string, { type: "text"; value: string }> = {};
      WHATSAPP_VARIABLE_ORDER.forEach((key, i) => {
        components[`body_${i + 1}`] = { type: "text", value: (m.vars[key] ?? "").slice(0, 1000) || "-" };
      });
      const { status, data } = await post(
        `${cfg.baseUrl}/api/v5/whatsapp/whatsapp-outbound-message/bulk/`,
        { authkey: cfg.authKey },
        {
          integrated_number: cfg.whatsappNumber,
          content_type: "template",
          payload: {
            messaging_product: "whatsapp",
            type: "template",
            template: {
              name: template,
              language: { code: cfg.whatsappLanguage, policy: "deterministic" },
              namespace: null,
              to_and_components: [{ to: [msg91Mobile(m.to)], components }],
            },
          },
        },
      );
      return msg91Outcome(status, data, "WhatsApp message");
    },
  };
}

/* ───────────────────────────── Console ───────────────────────────── */

export const consoleEmailProvider: EmailProvider = {
  name: "console",
  async send(m) {
    await consoleMailTransport.send({ to: m.to, subject: m.subject, html: m.html, text: m.text, kind: m.kind });
    return { id: null };
  },
};

export const consoleSmsProvider: TextProvider = {
  name: "console",
  async send(m) {
    await consoleSmsTransport.send({ to: m.to, text: m.text, kind: m.kind });
    return { id: null };
  },
};

export const consoleWhatsappProvider: TextProvider = {
  name: "console",
  async send(m) {
    console.log(`[whatsapp] to ${m.to} (${m.kind}): ${m.text}`);
    return { id: null };
  },
};

let override: Providers | null = null;

/** Tests only: use these providers instead of the environment's. Pass null to go back. */
export function setTestProviders(p: Providers | null) {
  if (p && process.env.NODE_ENV === "production") throw new Error("setTestProviders is for tests only.");
  override = p;
}

/** The providers the environment configures, falling back to the console. */
export function activeProviders(): Providers {
  if (override) return override;
  return {
    email: resendProvider() ?? consoleEmailProvider,
    sms: msg91SmsProvider() ?? consoleSmsProvider,
    whatsapp: msg91WhatsappProvider() ?? consoleWhatsappProvider,
  };
}

/** Email can be retried after an interrupted send: Resend drops a repeated idempotency key. */
export const safeToRepeat = (channel: Channel, providerName: string) => channel === "email" && providerName === "resend";

export type ProviderStatus = Record<Channel, { provider: string; live: boolean; note: string }>;

/** What the admin page shows about the setup. Never includes keys. */
export function providerStatus(): ProviderStatus {
  const r = resendConfig();
  const m = msg91Config();
  return {
    email: r
      ? { provider: "Resend", live: true, note: `Sending from ${r.from}.` }
      : { provider: "Console", live: false, note: "RESEND_API_KEY isn't set, so emails are printed to the server log." },
    sms: m
      ? {
          provider: "MSG91",
          live: true,
          note: `${Object.keys(m.templates).length} template id${Object.keys(m.templates).length === 1 ? "" : "s"} set for the whole platform${m.senderId ? `, sender ${m.senderId}` : ""}.`,
        }
      : { provider: "Console", live: false, note: "MSG91_AUTH_KEY isn't set, so texts are printed to the server log." },
    whatsapp:
      m && m.whatsappNumber
        ? { provider: "MSG91 WhatsApp", live: true, note: `Sending from +${m.whatsappNumber}.` }
        : m
          ? { provider: "Not set up", live: false, note: "MSG91_WHATSAPP_NUMBER isn't set, so WhatsApp messages fail." }
          : { provider: "Console", live: false, note: "MSG91 isn't set up, so WhatsApp messages are printed to the server log." },
  };
}
