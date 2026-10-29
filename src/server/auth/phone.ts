/**
 * Mobile numbers. Stored and sent as E.164 ("+919820011001"). People type them in every
 * shape ("98200 11001", "+91-98200-11001", "09820011001"), and numbers that came in by
 * CSV import may be stored that way, so matching always goes through `normalizePhone`.
 */

/** Indian numbers are the default: a bare 10-digit number gets +91. */
const DEFAULT_COUNTRY = "91";

/** E.164 for a number someone typed, or null when it can't be a mobile number. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!/^[+\d\s().-]+$/.test(trimmed)) return null;
  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!plus) {
    if (digits.length === 12 && digits.startsWith(DEFAULT_COUNTRY)) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length !== 10) return null;
    if (!/^[6-9]/.test(digits)) return null; // Indian mobile numbers start with 6–9
    return `+${DEFAULT_COUNTRY}${digits}`;
  }
  if (digits.startsWith(DEFAULT_COUNTRY)) {
    const local = digits.slice(2);
    return local.length === 10 && /^[6-9]/.test(local) ? `+${digits}` : null;
  }
  return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
}

/** The last 10 digits, for a first, index-friendly match in SQL before normalizing in code. */
export function phoneTail(e164: string): string {
  return e164.replace(/\D/g, "").slice(-10);
}

/** "+91 98••• ••001": enough to recognise your own number, not enough to learn someone else's. */
export function maskPhone(e164: string): string {
  const d = e164.replace(/\D/g, "");
  if (e164.startsWith(`+${DEFAULT_COUNTRY}`) && d.length === 12) {
    const local = d.slice(2);
    return `+91 ${local.slice(0, 2)}••• ••${local.slice(7)}`;
  }
  return `+${d.slice(0, d.length - 7)}${"•".repeat(4)}${d.slice(-3)}`;
}

/** "+91 98200 11001" for showing a full number to its owner. */
export function formatPhone(e164: string | null): string {
  if (!e164) return "";
  const d = e164.replace(/\D/g, "");
  if (e164.startsWith(`+${DEFAULT_COUNTRY}`) && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return e164;
}

/** "r•••@demo.edu" */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 1)}•••@${domain}`;
}
