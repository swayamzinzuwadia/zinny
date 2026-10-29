/**
 * The catalogue of notification kinds: who gets them, which channels are on by default,
 * what the default message says and where its button leads. Core's kinds all have an
 * entry; any other kind (another module's) falls back to the generic entry, which uses
 * the notification's own title and body.
 */
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
export const TEMPLATE_VARIABLES = ["name", "firstName", "title", "body", "university", "link"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export const VARIABLE_HELP: Record<TemplateVariable, string> = {
  name: "the person's full name",
  firstName: "the person's first name",
  title: "the notification's headline",
  body: "the notification's details",
  university: "your institute's name",
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
    defaults: { email: "on", sms: "optional", whatsapp: "optional" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("The batch is on your timetable in Zinny. See you in class."),
      smsText: "{{university}}: {{title}}. Details: {{link}}",
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
    defaults: { email: "on", sms: "on", whatsapp: "optional" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("Your timetable in Zinny already shows the change."),
      smsText: "{{university}}: {{title}}. Timetable: {{link}}",
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
    defaults: { email: "on", sms: "optional", whatsapp: "optional" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("Your new classes are on your timetable."),
      smsText: "{{university}}: {{title}}. Details: {{link}}",
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
    defaults: { email: "on", sms: "optional", whatsapp: "optional" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("You stay in your current batch. You can pick another batch from My learning."),
      smsText: "{{university}}: {{title}}. Details: {{link}}",
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
    defaults: { email: "on", sms: "on", whatsapp: "off" },
    template: {
      emailSubject: "{{title}}",
      emailBody: learnerEmail("You don't need to do anything for the refund. If you'd like, pick another batch of the course."),
      smsText: "{{university}}: {{title}}. Your payment will be refunded in full. {{link}}",
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
    defaults: { email: "on", sms: "off", whatsapp: "off" },
    template: {
      emailSubject: "{{title}}",
      emailBody: `${staffEmail}\n\nApprove or reject it from your dashboard.`,
      smsText: "{{university}}: {{title}}. Review: {{link}}",
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
    defaults: { email: "on", sms: "off", whatsapp: "off" },
    template: {
      emailSubject: "{{title}}",
      emailBody: `${staffEmail}\n\nRefund it from Sales.`,
      smsText: "{{university}}: {{title}}. {{link}}",
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
    defaults: { email: "on", sms: "off", whatsapp: "off" },
    template: {
      emailSubject: "{{title}}",
      emailBody: `${staffEmail}\n\nAssign another faculty member to the batch before then.`,
      smsText: "{{university}}: {{title}}. {{link}}",
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
];

const BY_KIND = new Map([...CORE_KINDS, ...SECURITY_KINDS_CATALOGUE].map((k) => [k.kind, k]));

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
    defaults: { email: "on", sms: "off", whatsapp: "off" },
    template: { emailSubject: "{{title}}", emailBody: "Hi {{firstName}},\n\n{{body}}", smsText: "{{university}}: {{title}}" },
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
 * Modules mark them with a "security." kind; identity's own names are recognised too.
 */
const SECURITY_KINDS = new Set([
  "identity.invite",
  "identity.otp",
  "identity.login_code",
  "identity.reset",
  "identity.password_reset",
  "identity.verify",
]);
export function isSecurityKind(kind: string | undefined | null): boolean {
  if (!kind) return false;
  return kind.startsWith("security.") || SECURITY_KINDS.has(kind);
}
