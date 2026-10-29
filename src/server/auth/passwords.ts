/**
 * Password hashing and the password rules (NIST SP 800-63B style: length over
 * composition rules, and a refusal of the most common choices).
 */
import bcrypt from "bcryptjs";
import { ValidationError } from "../errors";

export const PASSWORD_MIN = 8;
/** bcrypt only reads the first 72 bytes; longer passwords would be silently cut. */
export const PASSWORD_MAX_BYTES = 72;

const COST = process.env.NODE_ENV === "production" ? 12 : 10;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

let dummy: Promise<string> | null = null;

/**
 * Does the same work as checking a real password, so "no such account" takes as long
 * as "wrong password" and response times don't reveal who has an account.
 */
export async function verifyAgainstNothing(password: string): Promise<false> {
  dummy ??= bcrypt.hash("zinny-timing-equaliser", COST);
  await bcrypt.compare(password, await dummy);
  return false;
}

const COMMON = new Set([
  "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword",
  "12345678", "123456789", "1234567890", "0123456789", "87654321", "11111111", "00000000",
  "12341234", "11223344", "123123123", "1q2w3e4r", "1qaz2wsx", "qwertyui", "qwerty123",
  "qwertyuiop", "asdfghjk", "asdfghjkl", "zxcvbnm1", "iloveyou", "iloveyou1", "sunshine",
  "princess", "football", "baseball", "cricket1", "welcome1", "welcome123", "letmein1",
  "abcd1234", "abc12345", "abcdefgh", "admin123", "administrator", "changeme", "trustno1",
  "india123", "india@123", "student1", "student123", "teacher1", "college1", "zinny123",
  "zinny@123", "zinnyzinny",
]);

/** Throws a ValidationError that says what to change, or returns the password unchanged. */
export function checkNewPassword(password: string, opts: { email?: string; name?: string; confirm?: string } = {}): string {
  if (opts.confirm !== undefined && password !== opts.confirm) {
    throw new ValidationError("The two passwords don't match. Type the same password in both boxes.");
  }
  if (password.length < PASSWORD_MIN) {
    throw new ValidationError(`Use at least ${PASSWORD_MIN} characters. A short sentence is easy to remember and hard to guess.`);
  }
  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    throw new ValidationError("That password is too long. Use 72 characters or fewer.");
  }
  const lower = password.toLowerCase();
  if (new Set(lower).size <= 2) {
    throw new ValidationError("That password repeats the same characters. Choose something harder to guess.");
  }
  if (COMMON.has(lower)) {
    throw new ValidationError("That password is too common. Choose something less predictable.");
  }
  const local = opts.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 3 && (lower === local || lower === opts.email?.toLowerCase())) {
    throw new ValidationError("Don't use your email address as your password.");
  }
  const name = opts.name?.toLowerCase().replace(/\s+/g, "");
  if (name && name.length >= 3 && lower.replace(/\s+/g, "") === name) {
    throw new ValidationError("Don't use your name as your password.");
  }
  return password;
}
