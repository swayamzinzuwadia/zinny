/** Labels and fixed lists for the Zinny team panel. */
import type { RoleName } from "@/db/schema";

/* ── Licences ── */

export const PLANS = ["pilot", "standard", "enterprise"] as const;
export type Plan = (typeof PLANS)[number];

export const PLAN_LABELS: Record<Plan, string> = { pilot: "Pilot", standard: "Standard", enterprise: "Enterprise" };

/** What each plan usually comes with, used to prefill a new licence. Every value can be changed. */
export const PLAN_DEFAULTS: Record<Plan, { studentCap: number; staffCap: number; months: number }> = {
  pilot: { studentCap: 100, staffCap: 10, months: 3 },
  standard: { studentCap: 1000, staffCap: 60, months: 12 },
  enterprise: { studentCap: 10000, staffCap: 500, months: 12 },
};

/** Modules a licence can switch on: the product modules a university uses. */
export const LICENSABLE_MODULES = [
  { id: "content-progress", label: "Course content and progress" },
  { id: "live-classes", label: "Live classes and attendance" },
  { id: "assessments", label: "Tests" },
  { id: "assignments-polls", label: "Assignments and polls" },
  { id: "certificates", label: "Certificates" },
  { id: "payments", label: "Online payments" },
  { id: "reports-board", label: "Reports" },
  { id: "gamification", label: "Leaderboards and XP" },
  { id: "website-builder", label: "Website builder" },
] as const;

export const MODULE_LABEL: Record<string, string> = Object.fromEntries(LICENSABLE_MODULES.map((m) => [m.id, m.label]));

/** Warn at 90% of a cap, and this many days before a licence ends. */
export const CAP_WARNING_RATIO = 0.9;
export const END_WARNING_DAYS = 30;

/** Roles that count towards a licence's staff cap. Students count towards the student cap. */
export const STAFF_ROLES = ["institute_admin", "board_owner", "accounts_fees", "hod", "permanent_faculty", "visiting_faculty"] as const satisfies readonly RoleName[];

/* ── Zinny team ── */

export const PLATFORM_ROLES = ["super_admin", "account_manager", "support_agent", "content_qa", "finance_admin", "partnerships"] as const satisfies readonly RoleName[];
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  super_admin: "Super Admin",
  account_manager: "Account Manager",
  support_agent: "Support Agent",
  content_qa: "Content QA",
  finance_admin: "Finance Admin",
  partnerships: "Partnerships",
};

export const PLATFORM_ROLE_HINTS: Record<PlatformRole, string> = {
  super_admin: "Everything, including the Zinny team itself",
  account_manager: "Universities, licences and analytics; reads content flags",
  support_agent: "Support mode, the activity log and analytics",
  content_qa: "The content review queue and flags",
  finance_admin: "Zinny invoices and licences",
  partnerships: "Sponsors and corporate partners",
};

export const isPlatformRole = (r: string): r is PlatformRole => (PLATFORM_ROLES as readonly string[]).includes(r);

/* ── Content review ── */

export const FLAG_CATEGORIES = [
  { id: "accuracy", label: "Wrong or outdated information" },
  { id: "claims", label: "Misleading claims" },
  { id: "copyright", label: "Copyright or plagiarism" },
  { id: "quality", label: "Quality of the material" },
  { id: "pricing", label: "Price or GST looks wrong" },
  { id: "policy", label: "Against content policy" },
  { id: "other", label: "Something else" },
] as const;

export const FLAG_LABEL: Record<string, string> = Object.fromEntries(FLAG_CATEGORIES.map((c) => [c.id, c.label]));

/* ── Partners ── */

export const PARTNER_KINDS = ["sponsor", "corporate_partner"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = { sponsor: "Sponsor", corporate_partner: "Corporate partner" };

export const PARTNER_STATUSES = ["prospect", "in_talks", "active", "paused", "ended"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  prospect: "Prospect",
  in_talks: "In talks",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
};

/* ── Zinny billing ── */

export const GST_RATES_BP = [0, 500, 1200, 1800, 2800] as const;
export const DEFAULT_GST_BP = 1800;
export const DEFAULT_PAYMENT_DAYS = 15;
/** Software licence (SAC 997331), shown on Zinny's invoices. */
export const LICENCE_SAC = "997331";

/** Zinny's own details as the seller on its invoices. Set in production (see ENV.md). */
export function zinnySeller() {
  return {
    name: process.env.ZINNY_LEGAL_NAME?.trim() || "Zinny Learning Private Limited",
    gstin: process.env.ZINNY_GSTIN?.trim().toUpperCase() || null,
    stateCode: process.env.ZINNY_STATE_CODE?.trim() || "27",
    address: process.env.ZINNY_ADDRESS?.trim() || "Mumbai, Maharashtra",
    invoicePrefix: (process.env.ZINNY_INVOICE_PREFIX?.trim().toUpperCase() || "ZNY").slice(0, 4),
  };
}

/* ── GST state codes (for the university's "state") ── */

export const GST_STATES: { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
];

export const STATE_NAME: Record<string, string> = Object.fromEntries(GST_STATES.map((s) => [s.code, s.name]));

/** Time zones offered first in the picker; any IANA zone is accepted. */
export const COMMON_TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Kathmandu", "Asia/Dhaka", "Europe/London", "America/New_York"];
