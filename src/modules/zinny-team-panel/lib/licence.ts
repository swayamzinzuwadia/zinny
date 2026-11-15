/**
 * What the licence form holds, and what it starts with for a plan. Pure, so the pages
 * (server) and the form (browser) share it.
 */
import { addDays, addMonths, isDate } from "./format";

export type LicenceValues = {
  plan: string;
  studentCap: number;
  staffCap: number;
  modules: string[];
  startDate: string;
  endDate: string;
  notes: string;
  /** List price before GST, in paise. */
  pricePaise: number;
  discountPaise: number;
  discountNote: string;
  /** "Renew automatically". Left out on a new licence: the billing settings' default. */
  autoRenew?: boolean;
};

export type ChargeDefaults = {
  /** The invoice date offered, normally today. */
  invoiceDate: string;
  /** Days from the invoice date to the due date. */
  paymentDays: number;
  /** In Zinny's own state (CGST + SGST) or another (IGST). */
  intraState: boolean;
  /** Whether "Renew automatically" starts ticked on a new licence (billing settings). */
  autoRenewDefault?: boolean;
  /** Days before the end date a renewal is invoiced (billing settings), for the hint. */
  renewalLeadDays?: number;
  /** "Renew for another year" keeps the licence's discount (billing settings). */
  keepDiscountOnRenewal?: boolean;
};

/** The last day of a term of `months` starting on `start`: 1 Apr + 12 months → 31 Mar. */
export const termEnd = (start: string, months: number) => (isDate(start) ? addDays(addMonths(start, months), -1) : "");

type PlanTerms = { key: string; studentCap: number; staffCap: number; modules: string[]; billingMonths: number; pricePaise: number };

/** What the form starts with for a licence on `plan` from `start`: the plan's caps, modules, term and price. */
export function licenceDefaults(plan: PlanTerms, start: string): LicenceValues {
  return {
    plan: plan.key,
    studentCap: plan.studentCap,
    staffCap: plan.staffCap,
    modules: plan.modules,
    startDate: start,
    endDate: termEnd(start, plan.billingMonths),
    notes: "",
    pricePaise: plan.pricePaise,
    discountPaise: 0,
    discountNote: "",
  };
}
