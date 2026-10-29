/**
 * Sign-in and account-security settings, in one place so the rules, the UI copy and the
 * tests all agree. Durations are in milliseconds.
 */
import type { Rule } from "./throttle";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const AUTH = {
  session: {
    /** Signed out after this long without using Zinny. Every visit extends it (sliding expiry). */
    idleMs: 14 * DAY,
    /** Signed out this long after signing in, however active (absolute limit). */
    absoluteMs: 30 * DAY,
    /** Extend the expiry at most this often, so each request doesn't write to the database. */
    touchEveryMs: 10 * MIN,
  },
  invite: { validMs: 7 * DAY, resendGapMs: MIN },
  reset: { validMs: 30 * MIN },
  otp: {
    validMs: 5 * MIN,
    maxAttempts: 5,
    resendAfterMs: 30 * 1000,
    /** New codes one sign-in attempt may ask for (the first one included). */
    maxSendsPerChallenge: 5,
    /** The browser has this long to finish signing in once a code is sent. */
    challengeMs: 15 * MIN,
  },
} as const;

/** Throttle rules. `limit` failures inside `windowMs` lock for `lockMs` (doubling on repeat locks). */
export const LIMITS = {
  /** Wrong passwords for one email address. */
  passwordPerEmail: { limit: 5, windowMs: 15 * MIN, lockMs: 15 * MIN } satisfies Rule,
  /** Wrong passwords from one network (schools share one address, so this is generous). */
  passwordPerIp: { limit: 50, windowMs: 15 * MIN, lockMs: 15 * MIN } satisfies Rule,
  /** Wrong codes for one phone number, across codes. */
  codePerPhone: { limit: 10, windowMs: HOUR, lockMs: 30 * MIN } satisfies Rule,
  /** Codes sent to one phone number. */
  codeSendsPerPhone: { limit: 5, windowMs: HOUR } satisfies Rule,
  /** Codes asked for from one network. */
  codeSendsPerIp: { limit: 30, windowMs: HOUR } satisfies Rule,
  /** Reset emails to one address (silently dropped above this; the screen never says). */
  resetPerEmail: { limit: 3, windowMs: HOUR } satisfies Rule,
  /** Reset requests from one network. */
  resetPerIp: { limit: 20, windowMs: HOUR } satisfies Rule,
  /** Wrong current passwords on the profile page, per person. */
  currentPasswordPerUser: { limit: 5, windowMs: 15 * MIN, lockMs: 15 * MIN } satisfies Rule,
} as const;

/** Repeat locks double, up to this many doublings (15 min → 4 h). */
export const MAX_LOCK_DOUBLINGS = 4;

/** "15 minutes", "1 hour", "2 hours" — for messages. */
export function humanDuration(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / MIN));
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.ceil(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Demo one-click accounts: only outside production, or when ZINNY_DEMO=1. */
export function demoEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ZINNY_DEMO === "1";
}

/**
 * The public address of the app, for links in emails. APP_URL wins; on Vercel the
 * production URL is used; in development, localhost on PORT.
 */
export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL is not set, so links in emails can't be built. Set APP_URL (see src/modules/identity/ENV.md).");
  }
  return `http://localhost:${process.env.PORT || "3000"}`;
}
