/**
 * PAN encryption for student KYC: AES-256-GCM with a random 12-byte IV per value.
 * Stored as "v1.<iv>.<tag>.<ciphertext>" (base64url). The key is KYC_ENCRYPTION_KEY
 * (32 bytes, as 64 hex characters or base64); development and tests fall back to a fixed
 * key, production refuses to run without one (src/modules/onboarding/ENV.md).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { PAN_RE } from "./constants";

const DEV_KEY = createHash("sha256").update("zinny-kyc-development-key-not-for-production").digest();

export function kycKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.KYC_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (env.NODE_ENV === "production" && env.ZINNY_DEMO !== "1") throw new Error("KYC_ENCRYPTION_KEY is not set. See src/modules/onboarding/ENV.md.");
    return DEV_KEY;
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("KYC_ENCRYPTION_KEY must be 32 bytes: 64 hex characters or 44 base64 characters.");
  return key;
}

export function encryptSecret(plain: string, key = kycKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decryptSecret(stored: string, key = kycKey()): string {
  const [v, iv, tag, body] = stored.split(".");
  if (v !== "v1" || !iv || !tag || body === undefined) throw new Error("Unknown encrypted value format.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** "abcde1234f " → "ABCDE1234F". */
export const normalisePan = (v: string) => v.replace(/\s+/g, "").toUpperCase();

export const isPan = (v: string) => PAN_RE.test(normalisePan(v));

/** "ABCDE1234F" → "XXXXX1234F": the only form a PAN is ever shown in. */
export function maskPan(pan: string) {
  const p = normalisePan(pan);
  return p.length === 10 ? `XXXXX${p.slice(5)}` : "XXXXXXXXXX";
}
