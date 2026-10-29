/**
 * Small pure helpers: certificate codes, dates and statuses, the verify link.
 * No database access here, so the rules are easy to test.
 */
import { randomBytes } from "node:crypto";
import type { CertStatus } from "./schema";

/* ─────────────────────────── Codes ─────────────────────────── */

/** Crockford base32: no I, L, O or U, so a code read aloud or from paper is unambiguous. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 12;
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;

/** A new random code: 12 characters, 60 bits, e.g. "7K3P9QXAM2D4". */
export function newCode(): string {
  // 256 is a multiple of 32, so the low five bits of each random byte are uniform.
  return [...randomBytes(CODE_LENGTH)].map((b) => ALPHABET[b & 31]).join("");
}

/**
 * The stored form of a code someone typed or scanned: upper case, without spaces or
 * hyphens, with the letters Crockford base32 reads as digits (O as 0, I and L as 1).
 * Null when it can't be a certificate code, so nothing is looked up.
 */
export function normalizeCode(input: string | null | undefined): string | null {
  const c = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return CODE_RE.test(c) ? c : null;
}

/** "7K3P9QXAM2D4" → "7K3P-9QXA-M2D4". */
export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/* ─────────────────────────── Dates ─────────────────────────── */

/** Today, "YYYY-MM-DD", in a time zone. */
export function dateIn(timezone: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Calendar months, keeping the day where it exists (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** The last day a certificate issued on `issuedOn` is valid. 12 months from 12 Oct 2026 → 11 Oct 2027. */
export function validUntilFor(issuedOn: string, validityMonths: number | null | undefined): string | null {
  if (!validityMonths) return null;
  return addDays(addMonths(issuedOn, validityMonths), -1);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** "2026-10-12" → "12 Oct 2026". */
export function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${date}T00:00:00Z`));
}

export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/* ─────────────────────────── Status ─────────────────────────── */

export type EffectiveStatus = "valid" | "expired" | "revoked";

/**
 * What a certificate's status is today. Revoked wins; a certificate past its last valid
 * day is expired even before the daily job has marked it.
 */
export function effectiveStatus(c: { status: CertStatus; validUntil: string | null }, today: string): EffectiveStatus {
  if (c.status === "revoked") return "revoked";
  if (c.status === "expired" || (c.validUntil !== null && today > c.validUntil)) return "expired";
  return "valid";
}

export const STATUS_LABEL: Record<EffectiveStatus, string> = { valid: "Valid", expired: "Expired", revoked: "Revoked" };

/* ─────────────────────────── Links ─────────────────────────── */

/**
 * Where the QR code and share links point. Printed into every PDF, which never changes
 * afterwards, so production must set CERTIFICATE_VERIFY_BASE_URL before issuing anything.
 */
export function verifyBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const set = env.CERTIFICATE_VERIFY_BASE_URL?.trim();
  if (set) {
    const u = new URL(set);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("CERTIFICATE_VERIFY_BASE_URL must start with https://");
    return u.origin + u.pathname.replace(/\/+$/, "");
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Set CERTIFICATE_VERIFY_BASE_URL (for example https://app.zinny.in) before issuing certificates. See src/modules/certificates/ENV.md.");
  }
  return `http://localhost:${env.PORT || 3000}`;
}

export const verifyPath = (code: string) => `/verify/${formatCode(code)}`;
export const verifyUrl = (code: string, env: NodeJS.ProcessEnv = process.env) => `${verifyBaseUrl(env)}${verifyPath(code)}`;

/** A file name that is safe in a Content-Disposition header (ASCII, no quotes). */
export function downloadName(...parts: string[]): string {
  const name = parts
    .join(" - ")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._()+,=@-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${name || "Certificate"}.pdf`;
}
