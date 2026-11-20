/**
 * The pages and features of the Zinny team panel, for the global search in the top bar.
 * Pure (no database): built from the same sidebar the person sees (`navFor`) plus a short
 * list of deeper features, each with the words people use for it ("gst", "kyc", "refund").
 * Which entries a person gets follows the same checks as the pages themselves.
 */
import type { Actor } from "@/server/core";
import { canPlatform } from "@/server/core";
import { withSignups } from "../components/platform-sections";
import { canSeeContentFlags, isSuperAdmin, navFor } from "./access";

export type PageEntry = { label: string; href: string; hint: string; keywords: string[]; section: string };

/** Words for the pages in the sidebar, keyed by their path under /platform ("" is the home page). */
const NAV_WORDS: Record<string, { hint: string; keywords: string[] }> = {
  "": { hint: "Today's numbers and what needs attention", keywords: ["home", "dashboard", "summary", "today", "alerts"] },
  "/institutes": { hint: "Every institute on Zinny", keywords: ["university", "universities", "college", "school", "tenant", "customer", "client", "freeze", "suspend", "trial", "status"] },
  "/signups": { hint: "Institutes that signed themselves up", keywords: ["signup", "sign up", "self sign-up", "kyc", "pan", "tax number", "documents", "verify", "verification", "trial", "extend trial", "approve", "reject", "onboarding"] },
  "/plans": { hint: "What Zinny sells and at what price", keywords: ["plan", "pricing", "price", "tier", "pilot", "standard", "enterprise", "gst rate", "seat price"] },
  "/licences": { hint: "Which institute is on which plan, and until when", keywords: ["licence", "license", "renewal", "expiry", "expire", "caps", "seats", "modules", "students cap", "staff cap"] },
  "/billing": { hint: "Invoices to institutes and what is paid", keywords: ["invoice", "invoices", "gst", "tax", "payment", "paid", "unpaid", "overdue", "refund", "credit note", "receipt", "revenue", "collect"] },
  "/billing/settings": { hint: "Seller details, GST, bank details and seat packs", keywords: ["gst", "gstin", "tax", "seat", "seats", "pack", "packs", "seat pack", "bank", "seller", "invoice prefix", "numbering", "terms", "pricing", "extra seats"] },
  "/people": { hint: "Every account across all institutes", keywords: ["user", "users", "people", "person", "student", "teacher", "admin", "account", "email", "phone", "password", "role", "permission", "invite"] },
  "/support": { hint: "Open an institute to help, with a record of it", keywords: ["support", "help", "impersonate", "sign in as", "view as", "debug", "session", "ticket"] },
  "/support/log": { hint: "What the team did, and when", keywords: ["activity", "audit", "log", "history", "trail", "who did", "changes"] },
  "/content": { hint: "Courses waiting for review and flagged content", keywords: ["content", "review", "flag", "flagged", "courses", "moderation", "qa", "copyright", "abuse", "report"] },
  "/privacy": { hint: "DPDP requests from learners and institutes", keywords: ["privacy", "dpdp", "consent", "request", "erase", "erasure", "delete my data", "access request", "data principal"] },
  "/privacy/breaches": { hint: "Record of personal data breaches", keywords: ["breach", "incident", "leak", "dpdp", "notify", "security", "data board"] },
  "/analytics": { hint: "Growth, usage and revenue across Zinny", keywords: ["analytics", "stats", "metrics", "growth", "usage", "revenue", "charts", "report", "reports", "mrr"] },
  "/data": { hint: "Every table in the database", keywords: ["data console", "database", "tables", "rows", "sql", "records", "edit data", "export"] },
  "/team": { hint: "Zinny team members and their roles", keywords: ["team", "staff", "members", "invite", "super admin", "access", "employees"] },
  "/roles": { hint: "What each role can do", keywords: ["role", "roles", "permission", "permissions", "access", "rbac", "custom role"] },
};

type Feature = PageEntry & { allowed: (actor: Actor) => boolean };

/** Deeper features: pages and actions that aren't in the sidebar. */
const FEATURES: Feature[] = [
  { label: "New institute", href: "/platform/institutes/new", hint: "Set up an institute and its first admin", section: "Institutes", keywords: ["add institute", "create institute", "onboard", "new university", "new customer"], allowed: (a) => canPlatform(a, "platform.manage_universities") },
  { label: "New plan", href: "/platform/plans/new", hint: "Add a plan with its price and limits", section: "Plans and billing", keywords: ["add plan", "create plan", "pricing", "price"], allowed: isSuperAdmin },
  { label: "New invoice", href: "/platform/billing/new", hint: "Raise an invoice for an institute", section: "Plans and billing", keywords: ["create invoice", "raise invoice", "bill", "gst", "charge", "discount"], allowed: (a) => canPlatform(a, "platform.finance") },
  { label: "Seat packs", href: "/platform/billing/settings", hint: "Extra seats an institute can buy", section: "Plans and billing", keywords: ["seat", "seats", "pack", "packs", "extra seats", "add-on", "top up", "pricing"], allowed: (a) => isSuperAdmin(a) || canPlatform(a, "platform.finance") || canPlatform(a, "platform.seat_pricing") },
  { label: "Trials and extensions", href: "/platform/signups", hint: "See trial dates and extend a trial", section: "Institutes", keywords: ["trial", "extend trial", "free trial", "frozen", "freeze", "expired trial"], allowed: (a) => canPlatform(a, "platform.manage_universities") },
  { label: "Suspend or freeze an institute", href: "/platform/institutes", hint: "Open an institute to change its status", section: "Institutes", keywords: ["suspend", "freeze", "frozen", "block", "disable", "reactivate", "status"], allowed: (a) => canPlatform(a, "platform.manage_universities") },
  { label: "Refunds and payments", href: "/platform/billing", hint: "Mark an invoice paid or unpaid", section: "Plans and billing", keywords: ["refund", "mark paid", "payment", "reference", "receipt", "unpaid", "reverse"], allowed: (a) => canPlatform(a, "platform.finance") },
  { label: "Overdue invoices", href: "/platform/billing?status=overdue", hint: "Invoices past their due date", section: "Plans and billing", keywords: ["overdue", "late", "unpaid", "chase", "dues", "outstanding"], allowed: (a) => canPlatform(a, "platform.finance") },
  { label: "Flagged courses", href: "/platform/content?tab=flagged", hint: "Courses with open flags", section: "Content review", keywords: ["flag", "flagged", "report", "abuse", "complaint"], allowed: canSeeContentFlags },
  { label: "Invite a team member", href: "/platform/team", hint: "Give someone a Zinny team role", section: "Team", keywords: ["invite", "add member", "new member", "onboard staff"], allowed: isSuperAdmin },
  { label: "Custom roles", href: "/platform/team/roles", hint: "Create a role with chosen permissions", section: "Team", keywords: ["custom role", "permission", "permissions", "role", "access"], allowed: isSuperAdmin },
];

/** Every page and feature this person may open, in menu order. */
export function pagesFor(actor: Actor): PageEntry[] {
  const out: PageEntry[] = [];
  for (const section of withSignups(navFor(actor))) {
    for (const item of section.items) {
      const w = NAV_WORDS[item.href] ?? { hint: "", keywords: [] };
      out.push({ label: item.label, href: `/platform${item.href}`, hint: w.hint, keywords: w.keywords, section: section.label });
    }
  }
  for (const f of FEATURES) {
    if (!f.allowed(actor)) continue;
    out.push({ label: f.label, href: f.href, hint: f.hint, keywords: f.keywords, section: f.section });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase();
const wordsOf = (s: string) => s.split(/[\s\-_.,&/()]+/).filter(Boolean);

/** 0 label starts with q, 1 a word of the label does, 1.5 a keyword is exactly q, 2 a keyword starts with q, 3 label contains q, 4 hint or keyword contains q. */
export function pageScore(page: PageEntry, q: string): number | null {
  const needle = norm(q.trim());
  if (!needle) return null;
  const label = norm(page.label);
  if (label.startsWith(needle)) return 0;
  if (wordsOf(label).some((w) => w.startsWith(needle))) return 1;
  const keys = page.keywords.map(norm);
  if (keys.includes(needle)) return 1.5;
  if (keys.some((k) => k.startsWith(needle) || wordsOf(k).some((w) => w.startsWith(needle)))) return 2;
  // Anywhere-inside matches are noisy for very short words ("riv" inside "privacy"), so they need four letters.
  if (needle.length < 4) return null;
  if (label.includes(needle)) return 3;
  if (keys.some((k) => k.includes(needle)) || norm(page.hint).includes(needle)) return 4;
  return null;
}

/** The best matching pages, best first (ties keep menu order). */
export function searchPages(pages: PageEntry[], q: string, limit = 6): PageEntry[] {
  return pages
    .map((p, i) => ({ p, i, s: pageScore(p, q) }))
    .filter((x): x is { p: PageEntry; i: number; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}

/** A few pages to suggest before anything is typed. */
export function suggestedPages(pages: PageEntry[], limit = 5): PageEntry[] {
  const order = ["/platform/institutes", "/platform/billing", "/platform/people", "/platform/plans", "/platform/content", "/platform/support", "/platform"];
  const picked = order.map((h) => pages.find((p) => p.href === h)).filter((p): p is PageEntry => !!p);
  return (picked.length ? picked : pages).slice(0, limit);
}
