/**
 * Seat packs: the sums. Pure, so the institute's Seats page can show the price as you type
 * and the services charge the very same numbers. Money is integer paise.
 *
 * A pack adds a fixed number of people (25 students by default) to a licence's cap. Its
 * price is before GST, for a year of one pack. A licence term that isn't a year pays for
 * its share of the year (a 3-month Pilot term pays a quarter), and a pack bought part-way
 * through a term pays only for the days left:
 *
 *   charge = packs × year price × (months in the term ÷ 12) × (days left ÷ days in the term)
 *
 * rounded once, at the end, to the nearest rupee. Days left count today and the last day.
 * GST is added on top at the plan's rate, split by state like every Zinny invoice
 * (see charge.ts).
 */
import { addDays, addMonths, daysBetween, isDate } from "./format";

export const PACK_KINDS = ["student", "staff"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const isPackKind = (v: unknown): v is PackKind => v === "student" || v === "staff";

/** What one pack of a kind is: people per pack and the price of a year of it, before GST. */
export type PackTerms = { size: number; yearPricePaise: number; /** Set on the plan rather than taken from the billing settings. */ fromPlan: boolean };
export type PackPricing = Record<PackKind, PackTerms>;

export type PackDefaults = { studentPackSize: number; studentPackPricePaise: number; staffPackSize: number; staffPackPricePaise: number };
export type PlanPackOverrides = { studentPackSize: number | null; studentPackPricePaise: number | null; staffPackSize: number | null; staffPackPricePaise: number | null };

/** The packs on a plan: its own size and price where it sets them, otherwise the billing settings' defaults. */
export function packPricingFor(defaults: PackDefaults, plan?: Partial<PlanPackOverrides> | null): PackPricing {
  const pick = (own: number | null | undefined, fallback: number) => (own === null || own === undefined ? { v: fallback, own: false } : { v: own, own: true });
  const ss = pick(plan?.studentPackSize, defaults.studentPackSize);
  const sp = pick(plan?.studentPackPricePaise, defaults.studentPackPricePaise);
  const fs = pick(plan?.staffPackSize, defaults.staffPackSize);
  const fp = pick(plan?.staffPackPricePaise, defaults.staffPackPricePaise);
  return {
    student: { size: ss.v, yearPricePaise: sp.v, fromPlan: ss.own || sp.own },
    staff: { size: fs.v, yearPricePaise: fp.v, fromPlan: fs.own || fp.own },
  };
}

/** Nearest whole rupee, in paise. Halves go up. */
export const roundToRupee = (paise: number) => Math.round(paise / 100) * 100;

/** Days from `start` to `end`, both counted. */
export const daysInTerm = (start: string, end: string) => daysBetween(start, end) + 1;

/**
 * Months a term covers: exact when it runs whole months (1 Apr to 31 Mar is 12), otherwise
 * its length in average months, at least 1.
 */
export function monthsInTerm(start: string, end: string): number {
  if (!isDate(start) || !isDate(end) || end < start) return 12;
  for (let m = 1; m <= 120; m++) {
    const last = addDays(addMonths(start, m), -1);
    if (last === end) return m;
    if (last > end) break;
  }
  return Math.max(1, Math.round(daysInTerm(start, end) / 30.4375));
}

/** Days still to run on `today`, today and the last day counted. All of them before it starts; 0 once it has ended. */
export function daysLeftIn(today: string, start: string, end: string): number {
  if (today > end) return 0;
  return daysInTerm(today < start ? start : today, end);
}

export type PackQuote = {
  packs: number;
  /** People these packs add. */
  seats: number;
  yearPricePaise: number;
  termMonths: number;
  termDays: number;
  daysLeft: number;
  /** One pack for the whole term, to the rupee. */
  termPricePaise: number;
  /** What is charged before GST: the packs for the days left, to the rupee. */
  amountPaise: number;
  /** From the day of purchase (or the term's start) to the term's end. */
  periodStart: string;
  periodEnd: string;
};

/** What `packs` packs cost bought on `today`, on a licence running `startDate` to `endDate`. */
export function quotePacks(input: { packs: number; terms: Pick<PackTerms, "size" | "yearPricePaise">; startDate: string; endDate: string; today: string }): PackQuote {
  const { packs, terms, startDate, endDate, today } = input;
  const termMonths = monthsInTerm(startDate, endDate);
  const termDays = daysInTerm(startDate, endDate);
  const daysLeft = daysLeftIn(today, startDate, endDate);
  // One division, so nothing is rounded twice: packs × price × months × days left ÷ (12 × days in term).
  const amountPaise = roundToRupee((packs * terms.yearPricePaise * termMonths * daysLeft) / (12 * termDays));
  return {
    packs,
    seats: packs * terms.size,
    yearPricePaise: terms.yearPricePaise,
    termMonths,
    termDays,
    daysLeft,
    termPricePaise: roundToRupee((terms.yearPricePaise * termMonths) / 12),
    amountPaise,
    periodStart: today < startDate ? startDate : today,
    periodEnd: endDate,
  };
}

/**
 * What packs that renew with a licence cost for its next term, at today's pack price. A pack
 * keeps the size it was bought at; when the pack size has changed since, it is priced by its
 * people (a 25-person pack when packs are now 30 costs 25/30 of today's price).
 */
export function renewalPackAmount(
  held: { packs: number; seatsPerPack: number }[],
  terms: Pick<PackTerms, "size" | "yearPricePaise">,
  startDate: string,
  endDate: string,
): { packs: number; seats: number; amountPaise: number; termMonths: number } {
  const termMonths = monthsInTerm(startDate, endDate);
  let packs = 0;
  let seats = 0;
  let exact = 0;
  for (const h of held) {
    if (h.packs <= 0) continue;
    packs += h.packs;
    seats += h.packs * h.seatsPerPack;
    exact += (h.packs * terms.yearPricePaise * termMonths * h.seatsPerPack) / (12 * terms.size);
  }
  return { packs, seats, amountPaise: roundToRupee(exact), termMonths };
}

/** "2 student packs (50 students)". */
export function describePacks(kind: PackKind, packs: number, seats: number) {
  const noun = kind === "student" ? "student" : "staff";
  const people = kind === "student" ? (seats === 1 ? "student" : "students") : "staff";
  return `${packs} ${noun} pack${packs === 1 ? "" : "s"} (${seats.toLocaleString("en-IN")} ${people})`;
}

/** The line a pack invoice carries. */
export function packInvoiceLine(kind: PackKind, packs: number, seats: number, from: string, to: string, fmt: (d: string) => string, renewal = false) {
  return `Zinny ${renewal ? "seat packs renewed" : "seat packs"}: ${describePacks(kind, packs, seats)}, ${fmt(from)} to ${fmt(to)}`;
}

export const MAX_PACKS_PER_PURCHASE = 100;
export const MAX_PACK_SIZE = 10_000;
export const MAX_PACK_PRICE = 1_00_00_000_00;

/** Checks a number of packs from a form. */
export function checkPackCount(packs: number) {
  if (!Number.isInteger(packs) || packs < 1 || packs > MAX_PACKS_PER_PURCHASE) {
    return `Enter how many packs, a whole number from 1 to ${MAX_PACKS_PER_PURCHASE}.`;
  }
  return null;
}

/** The day after `end`, for "from the next term". */
export const nextDay = (end: string) => addDays(end, 1);
