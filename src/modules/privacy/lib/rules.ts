/**
 * The numbers the DPDP Act and Rules set, and the date maths built on them. Pure functions,
 * no database, so the tests can check them exactly.
 */

/** Bump this whenever the notice at /privacy changes in substance. Consents record it. */
export const NOTICE_VERSION = "2026-11.1";
export const NOTICE_DATE = "2026-11-19";

export type Purpose = "account" | "service" | "kyc" | "marketing" | "analytics" | "guardian";

/** Purposes a person can switch on or off themselves. Account and service come with having an account. */
export const OPTIONAL_PURPOSES: readonly Purpose[] = ["marketing", "analytics"];

export const PURPOSE_LABEL: Record<Purpose, string> = {
  account: "Your account",
  service: "Running your courses",
  kyc: "KYC details",
  marketing: "News and offers",
  analytics: "Usage analytics",
  guardian: "Parent or guardian consent",
};

export const PURPOSE_LINE: Record<Purpose, string> = {
  account: "Your name, email, mobile number and password, so you can sign in and we can reach you about your account.",
  service: "Your enrolments, attendance, tests, assignments, certificates and payments, so your institute can teach you and we can run Zinny for it.",
  kyc: "Your PAN (kept encrypted, shown masked) and the last 4 digits of your Aadhaar, for your institute's KYC.",
  marketing: "Emails about new courses, offers and Zinny news. Optional.",
  analytics: "An analytics cookie that tells us which pages are used, so we can improve them. Optional.",
  guardian: "A parent or guardian's verifiable consent for a learner under 18.",
};

/** Withdrawing these closes the account, so the page asks for an erasure request instead. */
export const ESSENTIAL_PURPOSES: readonly Purpose[] = ["account", "service"];

/* ─────────────────────────── Requests ─────────────────────────── */

export type RequestKind = "access" | "correction" | "erasure" | "nomination" | "grievance";

export const REQUEST_LABEL: Record<RequestKind, string> = {
  access: "Download of my data",
  correction: "Correction",
  erasure: "Erasure",
  nomination: "Nominee",
  grievance: "Grievance",
};

/**
 * Days we promise to answer in. Rule 14(3) caps grievance redressal at 90 days; we promise far
 * less so there is room to escalate. Downloads are immediate.
 */
export const REQUEST_SLA_DAYS: Record<RequestKind, number> = {
  access: 0,
  correction: 15,
  erasure: 30,
  nomination: 15,
  grievance: 30,
};
export const MAX_RESPONSE_DAYS = 90;

/** "YYYY-MM-DD" plus whole days, without time zone surprises. */
export function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dueOnFor(kind: RequestKind, today: string): string {
  return addDays(today, REQUEST_SLA_DAYS[kind]);
}

/** Days from `today` to `due` (negative when overdue). */
export function daysLeft(due: string, today: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/* ─────────────────────────── Breaches (Rule 7) ─────────────────────────── */

export const BREACH_WINDOW_HOURS = 72;
const HOUR = 3_600_000;

export type Deadline = { due: Date; msLeft: number; overdue: boolean; done: boolean; doneLate: boolean };

function deadline(detectedAt: Date, doneAt: Date | null, now: Date): Deadline {
  const due = new Date(detectedAt.getTime() + BREACH_WINDOW_HOURS * HOUR);
  return {
    due,
    msLeft: due.getTime() - now.getTime(),
    overdue: !doneAt && now.getTime() > due.getTime(),
    done: !!doneAt,
    doneLate: !!doneAt && doneAt.getTime() > due.getTime(),
  };
}

/**
 * The two 72-hour clocks, both from the moment Zinny became aware: the detailed report to the
 * Data Protection Board (Rule 7(2)(b)), and telling every affected person (Rule 7(1) says
 * "without delay"; 72 hours is our outer limit).
 */
export function breachDeadlines(b: { detectedAt: Date; boardReportAt: Date | null; principalsNotifiedAt: Date | null }, now = new Date()) {
  return { board: deadline(b.detectedAt, b.boardReportAt, now), principals: deadline(b.detectedAt, b.principalsNotifiedAt, now) };
}

/** "2 d 5 h left", "41 min left", "6 h overdue". */
export function countdownText(msLeft: number): string {
  const late = msLeft < 0;
  const ms = Math.abs(msLeft);
  const d = Math.floor(ms / (24 * HOUR));
  const h = Math.floor((ms % (24 * HOUR)) / HOUR);
  const m = Math.floor((ms % HOUR) / 60_000);
  const text = d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m} min` : `${m} min`;
  return late ? `${text} overdue` : `${text} left`;
}

/* ─────────────────────────── Age (Act s.2(f), s.9) ─────────────────────────── */

export const ADULT_AGE = 18;

/** Whole years between a "YYYY-MM-DD" birth date and `today`. */
export function ageOn(birthDate: string, today: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export function isMinor(birthDate: string, today: string): boolean {
  return ageOn(birthDate, today) < ADULT_AGE;
}

/** A guardian's link works for this long. */
export const GUARDIAN_LINK_DAYS = 7;

/* ─────────────────────────── Retention (Rule 8, Third Schedule) ─────────────────────────── */

/** Three years without signing in or learning, the period the Third Schedule uses. */
export const DEFAULT_INACTIVE_DAYS = 1095;
/** Rule 8(2): the person is told at least 48 hours before their data is erased. */
export const ERASURE_NOTICE_HOURS = 48;
/** Rule 8(3): consent and processing logs are kept at least this long. */
export const LOG_RETENTION_DAYS = 365;
/** CGST Act s.36 with s.35: tax invoices are kept for 72 months after the annual return is due, about 8 years. */
export const INVOICE_RETENTION_YEARS = 8;

export function isInactive(lastActiveAt: Date, inactiveDays: number, now = new Date()): boolean {
  return now.getTime() - lastActiveAt.getTime() > inactiveDays * 24 * HOUR;
}

/** A flagged account may be anonymised once the notice period has passed since it was flagged. */
export function noticeServed(flaggedAt: Date, now = new Date()): boolean {
  return now.getTime() - flaggedAt.getTime() >= ERASURE_NOTICE_HOURS * HOUR;
}
