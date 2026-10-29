/**
 * Mobile numbers come from CSV imports and profiles in many shapes. Texts need E.164.
 * Numbers without a country code are taken as Indian.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const plus = trimmed.startsWith("+") || trimmed.startsWith("00");
  let digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("00")) digits = digits.slice(2);
  if (plus) return digits.length >= 8 && digits.length <= 15 && digits[0] !== "0" ? `+${digits}` : null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0") && /^[6-9]/.test(digits.slice(1))) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]/.test(digits.slice(2))) return `+${digits}`;
  return null;
}

/** "+919812345678" → "+91 98•••• 5678" for pages and logs that shouldn't show the whole number. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return e164;
  const cc = e164.startsWith("+91") ? "+91" : e164.slice(0, 3);
  const rest = e164.slice(cc.length);
  return `${cc} ${rest.slice(0, 2)}${"•".repeat(Math.max(0, rest.length - 6))} ${rest.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, local.length - 2)))}@${domain}`;
}
