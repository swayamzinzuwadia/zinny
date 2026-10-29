/**
 * Secrets for links and codes. A token is shown to the person once (in an email, an SMS
 * or a cookie) and only its hash is stored, so a copy of the database can't be used to
 * sign in.
 */
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** 32 random bytes, URL-safe: 43 characters, 256 bits. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Key for HMACs over short secrets (6-digit codes), so a database copy alone can't
 * brute-force them. Set AUTH_SECRET in production (see src/modules/identity/ENV.md).
 */
function authSecret(): string {
  return process.env.AUTH_SECRET || process.env.CRON_SECRET || "zinny-dev-auth-secret";
}

export function hmac(value: string, context: string): string {
  return createHmac("sha256", authSecret()).update(`${context}\n${value}`).digest("hex");
}

/** Constant-time comparison of two hex digests. */
export function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** A 6-digit numeric code, uniformly random (leading zeros allowed). */
export function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID as 22 URL-safe characters, to keep links short. */
export function compactUuid(id: string): string {
  if (!UUID.test(id)) throw new Error("Not a UUID.");
  return Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url");
}

/** The reverse of compactUuid, or null if `s` isn't one. */
export function expandUuid(s: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(s)) return null;
  const hex = Buffer.from(s, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return compactUuid(id) === s ? id : null;
}
