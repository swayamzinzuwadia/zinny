import { createHash, randomBytes } from "node:crypto";

/** A salted SHA-256 of an IP address: enough to tell two consents apart, useless to find the person. */
export function ipHash(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const salt = process.env.PRIVACY_IP_SALT?.trim() || "zinny-dev-ip-salt";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

/** A random URL-safe token and the hash we store in its place. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: tokenHash(token) };
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
