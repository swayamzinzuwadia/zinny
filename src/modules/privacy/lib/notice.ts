/**
 * What the privacy notice says, as data, so the page, the consent forms and the export all
 * use the same words (Act s.5, Rule 3: itemised, plain, on its own). Contact details come from
 * the environment (ENV.md) with safe defaults for development.
 */
import { INVOICE_RETENTION_YEARS, LOG_RETENTION_DAYS, MAX_RESPONSE_DAYS, REQUEST_SLA_DAYS } from "./rules";

export function grievanceOfficer() {
  return {
    name: process.env.PRIVACY_GRIEVANCE_NAME?.trim() || "Grievance Officer, Zinny",
    email: process.env.PRIVACY_GRIEVANCE_EMAIL?.trim() || "grievance@zinny.in",
    phone: process.env.PRIVACY_GRIEVANCE_PHONE?.trim() || null,
    address: process.env.PRIVACY_GRIEVANCE_ADDRESS?.trim() || null,
    fiduciary: process.env.ZINNY_LEGAL_NAME?.trim() || "Zinny Learning Private Limited",
    responseDays: REQUEST_SLA_DAYS.grievance,
  };
}

export type DataItem = { what: string; why: string; kept: string };

/** Itemised: every kind of personal data, why it is used, and how long it is kept. */
export const DATA_ITEMS: DataItem[] = [
  { what: "Name, email address and mobile number", why: "To create your account, sign you in, and send you messages about it.", kept: "While your account is open, then up to 3 years of inactivity." },
  { what: "Password (stored only as a one-way hash)", why: "To sign you in safely. We cannot read it.", kept: "While your account is open." },
  { what: "Profile photo, if you add one", why: "To show your teachers and classmates who you are.", kept: "Until you remove it or your account is erased." },
  { what: "Courses, batches and enrolments", why: "To give you a seat and show you your classes.", kept: "While you study, then up to 3 years of inactivity." },
  { what: "Attendance, test scores, assignments, progress and certificates", why: "So your institute can teach and assess you, and anyone can verify a certificate you share.", kept: "While you study, then up to 3 years of inactivity. Issued certificates stay verifiable." },
  { what: "Payments, orders and GST invoices", why: "To take payment and meet tax law.", kept: `${INVOICE_RETENTION_YEARS} years, because GST law requires it, even after erasure.` },
  { what: "PAN (encrypted, shown masked) and the last 4 Aadhaar digits", why: "For your institute's KYC, only if you give them.", kept: "Until you ask for erasure or leave the institute. Never the full Aadhaar number." },
  { what: "Date of birth or age, and a parent's name and contact", why: "To ask a parent or guardian for consent when a learner is under 18.", kept: "While the learner's account is open." },
  { what: "Sign-in records: device, browser, IP address and time", why: "To keep your account safe and investigate misuse.", kept: `At least ${LOG_RETENTION_DAYS} days, as the DPDP Rules require.` },
  { what: "Consent records (with a scrambled form of your IP address)", why: "To prove what you agreed to and when.", kept: `At least ${LOG_RETENTION_DAYS} days after you withdraw.` },
  { what: "Institute details and documents (for people who sign an institute up)", why: "To set up the institute, check it is genuine, and bill it.", kept: `While the institute uses Zinny; invoices ${INVOICE_RETENTION_YEARS} years.` },
];

export const RIGHTS = [
  { title: "See what we hold", body: "Download a copy of your data as a file, any time, from your privacy page." },
  { title: "Correct it", body: "Change your name, mobile number and photo on your profile, or ask us to correct anything else." },
  { title: "Erase it", body: "Ask us to erase your account. We anonymise your details and delete your KYC data. Invoices stay, because the law requires them." },
  { title: "Withdraw consent", body: "Switch off news and analytics with one tap. It is as easy as giving it, and doesn't change anything you did before." },
  { title: "Nominate someone", body: "Name a person who can use these rights for you if you die or can't act yourself." },
  { title: "Complain", body: `Write to the grievance officer. We answer within ${REQUEST_SLA_DAYS.grievance} days, and never later than ${MAX_RESPONSE_DAYS}.` },
];
