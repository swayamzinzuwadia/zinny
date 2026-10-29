/** Input checks shared by the services. Messages say what is wrong and how to fix it. */
import { ValidationError } from "@/server/errors";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

export function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
}

export function requireText(v: unknown, label: string, opts: { min?: number; max: number }): string {
  const raw = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  const min = opts.min ?? 1;
  if (raw.length < min) throw new ValidationError(min > 1 ? `${label} needs at least ${min} characters.` : `Add ${label.toLowerCase()}.`);
  if (raw.length > opts.max) throw new ValidationError(`${label} can be at most ${opts.max} characters. It has ${raw.length}.`);
  return raw;
}

export function optionalText(v: unknown, label: string, max: number): string {
  const raw = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
  if (raw.length > max) throw new ValidationError(`${label} can be at most ${max} characters. It has ${raw.length}.`);
  return raw;
}

export function cleanEmail(v: unknown, opts: { required: boolean }): string {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!e) {
    if (opts.required) throw new ValidationError("Add an email address so we can reply.");
    return "";
  }
  if (e.length > 200 || !EMAIL_RE.test(e)) throw new ValidationError(`"${e.slice(0, 60)}" doesn't look like an email address. Check it and try again.`);
  return e;
}

/** Indian and international numbers: digits with optional +, spaces, dashes and brackets; 7 to 15 digits. */
export function cleanPhone(v: unknown, opts: { required: boolean }): string {
  const p = typeof v === "string" ? v.trim() : "";
  if (!p) {
    if (opts.required) throw new ValidationError("Add a phone number.");
    return "";
  }
  const digits = p.replace(/\D/g, "");
  if (!/^\+?[\d\s()-]+$/.test(p) || digits.length < 7 || digits.length > 15) {
    throw new ValidationError("Enter the phone number with digits only, like +91 98765 43210.");
  }
  return p.replace(/\s+/g, " ");
}

/** An http(s) link, or "" when empty. */
export function cleanUrl(v: unknown, label: string): string {
  const raw = typeof v === "string" ? v.trim() : "";
  if (!raw) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new ValidationError(`${label} isn't a valid link. Paste the full address, like https://example.com.`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new ValidationError(`${label} must start with https://.`);
  if (!u.hostname.includes(".")) throw new ValidationError(`${label} isn't a valid link. Paste the full address, like https://example.com.`);
  if (u.href.length > 500) throw new ValidationError(`${label} is too long.`);
  return u.href;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Words that would clash with site routes. */
const RESERVED_SLUGS = new Set(["page", "feed", "rss", "new", "preview"]);

export function slugify(title: string): string {
  return (
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "post"
  );
}

export function cleanSlug(v: unknown): string {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!s) throw new ValidationError("Add a web address for the post, like campus-placements-2026.");
  if (s.length > 80) throw new ValidationError("The web address can be at most 80 characters.");
  if (!SLUG_RE.test(s)) throw new ValidationError("Use only lowercase letters, numbers and single dashes in the web address, like campus-placements-2026.");
  if (RESERVED_SLUGS.has(s)) throw new ValidationError(`"${s}" is reserved. Pick a different web address.`);
  return s;
}
