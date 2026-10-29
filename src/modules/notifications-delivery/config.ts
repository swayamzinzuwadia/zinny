/**
 * Environment for delivery (documented in ENV.md). Read on every call, so tests and a
 * redeploy with new keys take effect without a restart.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** The public base URL of the app, without a trailing slash: links in emails and texts point here. */
export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return `http://localhost:${process.env.PORT ?? "3000"}`;
}

export const absoluteUrl = (path: string) => (/^https?:\/\//i.test(path) ? path : `${appUrl()}${path.startsWith("/") ? "" : "/"}${path}`);

export function resendConfig() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    /** "Zinny <notifications@mail.zinny.in>": the address must be on a domain verified in Resend. */
    from: process.env.MAIL_FROM?.trim() || "Zinny <notifications@mail.zinny.in>",
    baseUrl: (process.env.RESEND_BASE_URL?.trim() || "https://api.resend.com").replace(/\/+$/, ""),
  };
}

export function msg91Config() {
  const authKey = process.env.MSG91_AUTH_KEY?.trim();
  if (!authKey) return null;
  let templates: Record<string, string> = {};
  const raw = process.env.MSG91_SMS_TEMPLATES?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        templates = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "string" && v.trim())) as Record<string, string>;
      }
    } catch {
      console.error("[notifications] MSG91_SMS_TEMPLATES is not valid JSON. Expected {\"security.otp\": \"<template id>\", …}.");
    }
  }
  return {
    authKey,
    /** Six-letter DLT sender id (header), e.g. ZINNYE. Optional when the template carries it. */
    senderId: process.env.MSG91_SENDER_ID?.trim() || null,
    /** Template ids per kind, used when a university hasn't set its own. */
    templates,
    /** The WhatsApp business number connected in MSG91, digits with country code: 919800000000. */
    whatsappNumber: process.env.MSG91_WHATSAPP_NUMBER?.replace(/\D/g, "") || null,
    whatsappLanguage: process.env.MSG91_WHATSAPP_LANGUAGE?.trim() || "en",
    baseUrl: (process.env.MSG91_BASE_URL?.trim() || "https://control.msg91.com").replace(/\/+$/, ""),
  };
}

/* ───────────── Signed tokens (unsubscribe links) ───────────── */

function signingSecret(): string {
  const s = process.env.NOTIFICATIONS_SIGNING_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("Set NOTIFICATIONS_SIGNING_SECRET (or CRON_SECRET) so unsubscribe links can be signed.");
  }
  return "zinny-local-notifications-dev-secret";
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (body: string) => createHmac("sha256", signingSecret()).update(`notif-unsubscribe.${body}`).digest();

export type UnsubscribeClaim = {
  /** University id. */
  u: string;
  /** Person id, when the recipient is a person in the university. */
  p?: string;
  /** Email address, when the recipient isn't a known person (direct sends). */
  a?: string;
  /** The kind to stop. */
  k: string;
};

export function signToken(claim: UnsubscribeClaim): string {
  const body = b64(JSON.stringify(claim));
  return `${body}.${b64(mac(body))}`;
}

/** The claim, or null when the token was changed, cut short or signed with another secret. */
export function verifyToken(token: string): UnsubscribeClaim | null {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = mac(body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UnsubscribeClaim;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(c.u) || typeof c.k !== "string" || !c.k) return null;
    if (c.p !== undefined && !uuid.test(c.p)) return null;
    if (c.p === undefined && (typeof c.a !== "string" || !c.a.includes("@"))) return null;
    return c;
  } catch {
    return null;
  }
}
