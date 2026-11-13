/**
 * The catalogue of notification kinds: who gets them, which channels are on by default,
 * what the default message says and where its button leads. Core's kinds all have an
 * entry; any other kind (another module's) falls back to the generic entry, which uses
 * the notification's own title and body.
 */
import type { RoleName } from "@/db/schema";
import type { Channel, ChannelState } from "./schema";

export const CHANNELS: readonly Channel[] = ["email", "sms", "whatsapp"] as const;
export const CHANNEL_LABEL: Record<Channel, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };
export const STATE_LABEL: Record<ChannelState, string> = { off: "Off", optional: "Optional", on: "On" };

export type Audience = "learners" | "staff";
export type ChannelDefaults = Record<Channel, ChannelState>;

export type KindTemplate = {
  emailSubject: string;
  emailBody: string;
  /** Used for SMS and WhatsApp. */
  smsText: string;
};

export type KindDefinition = {
  kind: string;
  label: string;
  description: string;
  audience: Audience;
  /** Roles that receive this kind (for the personal settings page). Empty = whoever has received one. */
  roles: readonly RoleName[];
  defaults: ChannelDefaults;
  template: KindTemplate;
  /** The email button. */
  ctaLabel: string;
  /** Where the button leads, inside the university's space. */
  link(uni: string, data: Record<string, unknown>): string | null;
  /** Shown in the admin preview and used for test sends. */
  sample: { title: string; body: string; data?: Record<string, unknown> };
};

/** Variables every template may use. */
export const TEMPLATE_VARIABLES = ["name", "firstName", "title", "body", "institute", "link"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export const VARIABLE_HELP: Record<TemplateVariable, string> = {
  name: "the person's full name",
  firstName: "the person's first name",
  title: "the notification's headline",
  body: "the notification's details",
  institute: "your institute's name",
  link: "the page the message points to",
};

const learnerEmail = (closing: string) => `Hi {{firstName}},\n\n{{body}}\n\n${closing}`;
const staffEmail = `Hi {{firstName}},\n\n{{body}}`;
const str = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export const CORE_KINDS: KindDefinition[] = [
  {
    kind: "enrolment.confirmed",
    label: "Enrolment confirmed",
    description: "A learner's seat in a batch is confirmed, free or paid.",
    audience: "learners",
    roles: ["student", "alumni", "individual_learner"],
    defaults: { email: "on", sms: "optional", whatsapp: "optional" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("The batch is on your timetable in Zinny. See you in class."),
      smsText: "{{institute}}: {{title}}. Details: {{link}}",
    },
    ctaLabel: "Open my learning",
    link: (uni) => `/${uni}/learn/my`,
    sample: { title: "You're enrolled in Data Analytics", body: "Weekday morning starts on 2 Nov 2026. It's on your timetable." },
  },
  {
    kind: "timetable.changed",
    label: "Timetable changed",
    description: "A batch's timings or dates changed, or a class was cancelled, moved or added.",
    audience: "learners",
    roles: ["student"],
    defaults: { email: "on", sms: "on", whatsapp: "optional" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("Your timetable in Zinny already shows the change."),
      smsText: "{{institute}}: {{title}}. Timetable: {{link}}",
    },
    ctaLabel: "Open my timetable",
    link: (uni) => `/${uni}/learn/timetable`,
    sample: { title: "Data Analytics: class on Mon 2 Nov is cancelled", body: "Faculty development day. The class is not rescheduled." },
  },
  {
    kind: "switch.approved",
    label: "Batch switch approved",
    description: "A learner's request to move to another batch was approved.",
    audience: "learners",
    roles: ["student"],
    defaults: { email: "on", sms: "optional", whatsapp: "optional" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("Your new classes are on your timetable."),
      smsText: "{{institute}}: {{title}}. Details: {{link}}",
    },
    ctaLabel: "Open my learning",
    link: (uni) => `/${uni}/learn/my`,
    sample: { title: "You've moved to Weekday evening (Data Analytics)", body: "Your timetable is updated." },
  },
  {
    kind: "switch.rejected",
    label: "Batch switch not approved",
    description: "A learner's request to move to another batch was not approved.",
    audience: "learners",
    roles: ["student"],
    defaults: { email: "on", sms: "optional", whatsapp: "optional" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("You stay in your current batch. You can pick another batch from My learning."),
      smsText: "{{institute}}: {{title}}. Details: {{link}}",
    },
    ctaLabel: "Open my learning",
    link: (uni) => `/${uni}/learn/my`,
    sample: { title: "Your switch to Weekend was not approved", body: "That batch has no free seat now." },
  },
  {
    kind: "payment.refund_due",
    label: "Payment to be refunded",
    description: "A learner paid after their seat hold ran out and the batch had filled.",
    audience: "learners",
    roles: ["student", "alumni", "individual_learner"],
    defaults: { email: "on", sms: "on", whatsapp: "off" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("You don't need to do anything for the refund. If you'd like, pick another batch of the course."),
      smsText: "{{institute}}: {{title}}. Your payment will be refunded in full. {{link}}",
    },
    ctaLabel: "Browse courses",
    link: (uni) => `/${uni}/learn/courses`,
    sample: { title: "Weekend filled up before your payment finished", body: "Your payment will be refunded in full. You can pick another batch." },
  },
  {
    kind: "switch.requested",
    label: "Batch switch requested",
    description: "A learner asked to move to another batch. Goes to the department's heads.",
    audience: "staff",
    roles: ["hod"],
    defaults: { email: "on", sms: "off", whatsapp: "off" },
    template: {
      emailSubject: "{{title}}",
      emailBody: `${staffEmail}\n\nApprove or reject it from your dashboard.`,
      smsText: "{{institute}}: {{title}}. Review: {{link}}",
    },
    ctaLabel: "Review the request",
    link: (uni) => `/${uni}/admin`,
    sample: { title: "Batch switch request: Data Analytics", body: "Kabir Mehta wants to move from Weekday morning to Weekday evening." },
  },
  {
    kind: "finance.refund_due",
    label: "Refund needed",
    description: "A payment arrived after the batch filled and must be refunded. Goes to admins and accounts.",
    audience: "staff",
    roles: ["institute_admin", "accounts_fees"],
    defaults: { email: "on", sms: "off", whatsapp: "off" },
    template: {
      emailSubject: "{{title}}",
      emailBody: `${staffEmail}\n\nRefund it from Sales.`,
      smsText: "{{institute}}: {{title}}. {{link}}",
    },
    ctaLabel: "Open sales",
    link: (uni) => `/${uni}/admin/finance/sales`,
    sample: { title: "Refund needed", body: "Data Analytics — Weekend: paid after the seat hold ran out and the batch was full." },
  },
  {
    kind: "batch.faculty_expiring",
    label: "Faculty access ending",
    description: "Visiting faculty lose access before their batch ends. Goes to the department's heads.",
    audience: "staff",
    roles: ["hod"],
    defaults: { email: "on", sms: "off", whatsapp: "off" },
    template: {
      emailSubject: "{{title}}",
      emailBody: `${staffEmail}\n\nAssign another faculty member to the batch before then.`,
      smsText: "{{institute}}: {{title}}. {{link}}",
    },
    ctaLabel: "Open the batch",
    link: (uni, data) => (str(data.batchId) ? `/${uni}/admin/products/batches/${str(data.batchId)}` : `/${uni}/admin`),
    sample: { title: "Data Analytics: Weekend needs a new faculty member", body: "Visiting faculty access ends on 8 Nov 2026, before the batch ends on 31 Jan 2027." },
  },
];

const securityKind = (kind: string, label: string, description: string): KindDefinition => ({
  kind,
  label,
  description,
  audience: "learners",
  roles: [],
  defaults: { email: "on", sms: "on", whatsapp: "off" },
  template: { emailSubject: "{{title}}", emailBody: "{{body}}", smsText: "{{body}}" },
  ctaLabel: "Open Zinny",
  link: () => null,
  sample: { title: label, body: "Your code is 482913. It expires in 5 minutes." },
});

/**
 * Security messages other modules send (identity). Their text is written by the sender and
 * never stored; the institute only sets the MSG91 template ids that Indian SMS rules require.
 */
export const SECURITY_KINDS_CATALOGUE: KindDefinition[] = [
  securityKind("security.otp", "Sign-in code", "The 6-digit code for signing in with a phone number."),
  securityKind("security.reset", "Password reset", "The link to set a new password."),
  securityKind("identity.invite", "Invitation", "The link a new person uses to set their password."),
  securityKind("security.password_changed", "Password changed", "Tells a person their password was changed, with a reset link in case it wasn't them."),
];

/**
 * Kinds the other wave 1 modules send through notify() (wave 1 integration). Each uses the
 * notification's own title and details, like the generic entry, and has the same channel
 * defaults; the catalogue adds a name, a description, the audience and where the button
 * leads (the notification's own link first, then the page below).
 */
const moduleKind = (
  kind: string,
  label: string,
  description: string,
  audience: Audience,
  roles: readonly RoleName[],
  ctaLabel: string,
  path: string,
): KindDefinition => ({
  ...genericKind(kind),
  label,
  description,
  audience,
  roles,
  ctaLabel,
  link: (uni, data) => dataLink(uni, data) ?? `/${uni}${path}`,
  sample: { title: `${label}: an example`, body: "The details of the notification appear here." },
});

const LEARNERS: readonly RoleName[] = ["student", "alumni", "individual_learner"];
export const MODULE_KINDS: KindDefinition[] = [
  moduleKind("assess.test.published", "New test", "A test or quiz was published for the learner's batch.", "learners", LEARNERS, "Open my tests", "/learn/tests"),
  moduleKind("assess.result.ready", "Test result ready", "A test with hand-graded answers has its final score.", "learners", LEARNERS, "See my result", "/learn/tests"),
  moduleKind("assignment.new", "New assignment", "Work was set for the learner's batch.", "learners", ["student"], "Open the assignment", "/learn/assignments"),
  moduleKind("assignment.due_soon", "Assignment due soon", "A reminder the day before work is due, for learners who haven't handed in.", "learners", ["student"], "Hand in my work", "/learn/assignments"),
  moduleKind("assignment.graded", "Assignment graded", "A learner's work was graded.", "learners", ["student"], "See my grade", "/learn/assignments"),
  moduleKind("poll.open", "Poll open", "A poll opened for the learner's course or batch.", "learners", ["student"], "Vote now", "/learn/polls"),
  moduleKind("attendance.low", "Low attendance", "A learner's attendance in a batch fell below the institute's threshold (weekly).", "learners", ["student"], "See my attendance", "/learn/my"),
  moduleKind("attendance.low_summary", "Low attendance summary", "Weekly list of learners below the attendance threshold in the department.", "staff", ["hod"], "Open the dashboard", "/admin"),
  moduleKind("certificate.issued", "Certificate issued", "A learner received a certificate.", "learners", LEARNERS, "See my certificate", "/learn/certificates"),
  moduleKind("certificate.revoked", "Certificate revoked", "A learner's certificate was revoked.", "learners", LEARNERS, "Open my certificates", "/learn/certificates"),
  moduleKind("certificate.expiring", "Certificate expiring", "A learner's certificate expires soon and can be renewed.", "learners", LEARNERS, "Open my certificates", "/learn/certificates"),
  moduleKind("certificate.expired", "Certificate expired", "A learner's certificate has expired.", "learners", LEARNERS, "Open my certificates", "/learn/certificates"),
  moduleKind("gamification.badge", "Badge earned", "A learner earned a badge.", "learners", ["student"], "See my badges", "/learn/leaderboard"),
  moduleKind("gamification.challenge_won", "Challenge won", "A learner finished a challenge among its winners.", "learners", ["student"], "Open the leaderboard", "/learn/leaderboard"),
  moduleKind("payment.refunded", "Refund processed", "A refund for a learner's payment was processed.", "learners", LEARNERS, "Open my invoices", "/learn/invoices"),
  moduleKind("payments.invoice", "GST invoice", "A learner's GST invoice is ready after payment.", "learners", LEARNERS, "Open my invoices", "/learn/invoices"),
  moduleKind("payments.fee_reminder", "Fee reminder", "An invoice the institute raised is unpaid past its due date. Sent when staff press Send reminders.", "learners", LEARNERS, "Open my invoices", "/learn/invoices"),
  moduleKind("batch.announcement", "Batch announcement", "Faculty, a HOD or an admin sent a message to everyone in a batch.", "learners", ["student"], "Open Zinny", "/learn"),
  moduleKind("finance.refund_failed", "Refund failed", "Razorpay couldn't process a refund. Goes to Accounts and the Institute Admin.", "staff", ["accounts_fees", "institute_admin"], "Open Sales", "/admin/finance/sales"),
];

const BY_KIND = new Map([...CORE_KINDS, ...SECURITY_KINDS_CATALOGUE, ...MODULE_KINDS].map((k) => [k.kind, k]));

/**
 * What each kind means to the learner who gets it, for their own notification settings.
 * The descriptions in the catalogue above are written for the institute's staff.
 */
export const LEARNER_DESCRIPTION: Readonly<Record<string, string>> = {
  "enrolment.confirmed": "You get a seat in a batch, and its classes go on your timetable.",
  "enrolment.declined": "Faculty don't accept your request to join a batch.",
  "timetable.changed": "A class of yours is cancelled, moved or added, or your batch's timings change.",
  "switch.approved": "Your request to move to another batch is approved.",
  "switch.rejected": "Your request to move to another batch isn't approved.",
  "payment.refund_due": "A batch fills up before your payment goes through, so your money comes back to you.",
  "assess.test.published": "A new test or quiz is set for your batch.",
  "assess.result.ready": "Your teacher finishes marking a test and your score is ready.",
  "assignment.new": "New work is set for your batch.",
  "assignment.due_soon": "A reminder the day before work is due, if you haven't handed it in yet.",
  "assignment.graded": "Your work is graded.",
  "poll.open": "A poll opens in one of your courses.",
  "attendance.low": "Your attendance in a batch falls below what your institute asks for. Checked weekly.",
  "certificate.issued": "You receive a certificate.",
  "certificate.revoked": "Your institute revokes one of your certificates.",
  "certificate.expiring": "One of your certificates expires soon and can be renewed.",
  "certificate.expired": "One of your certificates has expired.",
  "gamification.badge": "You earn a badge.",
  "gamification.challenge_won": "You finish a challenge among its winners.",
  "payment.refunded": "A refund of your payment is on its way to you.",
  "payments.invoice": "The GST invoice for something you paid for is ready.",
  "payments.fee_reminder": "An invoice the institute gave you is still unpaid after its due date.",
  "batch.announcement": "Your teacher or the institute sends a message to your batch.",
};

/** Kinds about money. Institute courses are free for their students, so most learners never get one. */
export const PAYMENT_KINDS: ReadonlySet<string> = new Set(["payment.refund_due", "payment.refunded", "payments.invoice", "payments.fee_reminder"]);

/**
 * Whether a kind belongs on a learner's own settings page: never a staff kind, and a payment
 * kind only for a learner who has paid for something here (has an invoice).
 */
export function forLearnerSettings(kind: string, hasPaid: boolean): boolean {
  if (kindDefinition(kind).audience === "staff") return false;
  return hasPaid || !PAYMENT_KINDS.has(kind);
}

/** The learner-facing description of a kind; empty for kinds this catalogue doesn't describe. */
export function learnerDescription(kind: string): string {
  return LEARNER_DESCRIPTION[kind] ?? "";
}

/** "assignment.graded" → "Assignment graded". */
export function humanizeKind(kind: string): string {
  const words = kind.replace(/[._-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : kind;
}

/** A relative link a module put in the notification's data, if any. */
function dataLink(uni: string, data: Record<string, unknown>): string | null {
  for (const key of ["link", "url", "href", "path"]) {
    const v = data[key];
    if (typeof v === "string" && v.startsWith(`/${uni}/`) && !v.includes("//", 1) && v.length < 500) return v;
  }
  return null;
}

/** The generic entry for kinds this module doesn't know (other modules' kinds). */
export function genericKind(kind: string): KindDefinition {
  return {
    kind,
    label: humanizeKind(kind),
    description: "Sent by another part of Zinny. The message uses the notification's own title and details.",
    audience: "learners",
    roles: [],
    defaults: { email: "on", sms: "off", whatsapp: "off" },
    template: { emailSubject: "{{title}}", emailBody: "Hi {{firstName}},\n\n{{body}}", smsText: "{{institute}}: {{title}}" },
    ctaLabel: "Open Zinny",
    link: dataLink,
    sample: { title: `${humanizeKind(kind)}: an example`, body: "The details of the notification appear here." },
  };
}

export function kindDefinition(kind: string): KindDefinition {
  const known = BY_KIND.get(kind);
  if (known) return known;
  const generic = genericKind(kind);
  if (kind === "message") return { ...generic, label: "General messages", description: "Messages sent without a specific kind." };
  if (isSecurityKind(kind)) return { ...generic, label: `${humanizeKind(kind)} (security)`, description: "Sign-in codes, password resets and invitations. Always sent." };
  return generic;
}

export const isCoreKind = (kind: string) => CORE_KINDS.some((k) => k.kind === kind);

/** Kind names: lower case, dots, dashes and underscores, like "assignment.graded". */
export const KIND_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,79}$/;

/**
 * Security messages (sign-in codes, password resets, invitations) always go out: no
 * quiet hours, no unsubscribe link, no opting out, and their text is never stored.
 * Modules should use a "security." kind ("security.otp", "security.reset"); kinds whose
 * last part names a code, reset, password, invitation or verification are treated the same,
 * so a security message is never held back or unsubscribed by mistake.
 */
const SECURITY_WORD = /(^|[._-])(otp|login[_-]?code|sign[_-]?in[_-]?code|reset|password[_-]?reset|password|invite|invited|invitation|verify|verification|2fa|mfa)$/;
export function isSecurityKind(kind: string | undefined | null): boolean {
  if (!kind) return false;
  return kind.startsWith("security.") || SECURITY_WORD.test(kind);
}
