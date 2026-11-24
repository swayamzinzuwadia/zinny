/**
 * Seat packs: more users on a licence, mid-term, in packs (25 students or 5 staff by
 * default; sizes and year prices in the billing settings, optionally per plan).
 *
 * How it works (the decisions are in docs/handoff/seats.md):
 *  - A pack's seats go onto the licence's cap the moment it is added: plat_licences keeps
 *    the total, so usage, warnings and every page that shows a cap stay right without
 *    knowing about packs. plat_seat_packs keeps each purchase and how many of its packs are
 *    still on the licence.
 *  - Adding packs raises a Zinny invoice for the days left in the term (lib/seat-packs.ts
 *    has the formula), plus GST at the plan's rate, due after the usual payment terms.
 *  - Removing packs takes their seats off straight away and stops them renewing. Money
 *    already invoiced for this term stays (as for the licence itself): Zinny invoices have
 *    no credit notes yet, so a refund is a revision Finance makes by hand.
 *  - Packs still on the licence renew with it at the pack price then (licences.ts).
 *  - Setting caps by hand is platform.seat_pricing, and so are pack sizes and prices.
 *
 * Who can do what:
 *  - The Zinny team (system connection, after assertPlatform, the module's exception):
 *    add and remove packs with platform.licences; set caps by hand with platform.seat_pricing.
 *  - An institute (its own Seats page): an Admin with settings.manage buys packs and pays
 *    its Zinny invoices; finance.view can look. Its own records are read under row-level
 *    security (withTenant). Zinny's price list (plans, billing settings) and the invoice
 *    counter are Zinny's own tables, closed to an institute's connection, so the price is
 *    read and the purchase is written on the system connection, after assertCan and only
 *    ever for the actor's own university, as the daily billing job does.
 */
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { auditLog, universities, users } from "@/db/schema";
import { assertCan, assertPlatform, audit, can, gateway, withTenant, type Actor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { platInvoices, platLicences, platSeatPacks } from "../schema";
import { chargeFor } from "../lib/charge";
import { zinnySeller } from "../lib/constants";
import { addDays, formatDate, formatINR, todayIST } from "../lib/format";
import {
  PACK_KINDS,
  checkPackCount,
  daysInTerm,
  daysLeftIn,
  describePacks,
  isPackKind,
  monthsInTerm,
  packInvoiceLine,
  packPricingFor,
  quotePacks,
  type PackKind,
  type PackPricing,
  type PackQuote,
} from "../lib/seat-packs";
import { isOverdue, issueInvoice, listPriceOf, recordPaymentTx, type Invoice } from "./billing";
import { readBillingSettings, readSeatPackSettings } from "./billing-settings";
import { syncAlertsFor, type Licence } from "./licences";
import { planByKey, planNameFallback, type Plan } from "./plans";
import { db, emptyUsage, isUuid, logAction, usageFor, type Usage } from "./shared";

export type SeatPack = typeof platSeatPacks.$inferSelect;

const MAX_CAP = 1_000_000;
const capKey = (kind: PackKind) => (kind === "student" ? "studentCap" : "staffCap");
const people = (kind: PackKind, n: number) => (kind === "student" ? `${n.toLocaleString("en-IN")} student${n === 1 ? "" : "s"}` : `${n.toLocaleString("en-IN")} staff`);

/* ─────────────────────────── Shared pieces ─────────────────────────── */

/**
 * Logs a seat change. An institute's own change goes through core `audit` with the actor as
 * they are (support mode included); a Zinny team change lands in the institute's log too.
 */
async function logSeats(tx: Tx, actor: Actor, universityId: string, action: string, entity: string, entityId: string | null, data: Record<string, unknown>) {
  if (actor.universityId === universityId) await audit(tx, actor, action, entity, entityId, { universityId, ...data });
  else await logAction(tx, actor, { universityId, inUniversityLog: true }, action, entity, entityId, data);
}

/** The licence (locked), its plan and the packs on it, on the system connection. */
async function packContext(tx: Tx, universityId: string) {
  const [licence] = await tx.select().from(platLicences).where(eq(platLicences.universityId, universityId)).for("update");
  if (!licence) throw new NotFoundError("Licence");
  const plan = await planByKey(tx, licence.plan);
  if (!plan) throw new ValidationError("This licence's plan no longer exists. Pick a plan on the licence page first.");
  const pricing = packPricingFor(await readSeatPackSettings(tx), plan);
  return { licence, plan, pricing };
}

/** Packs per kind still on a licence, and the people they add. */
export function heldPacks(rows: Pick<SeatPack, "kind" | "packs" | "seatsPerPack">[]): Record<PackKind, { packs: number; seats: number }> {
  const out = { student: { packs: 0, seats: 0 }, staff: { packs: 0, seats: 0 } };
  for (const r of rows) {
    if (!isPackKind(r.kind)) continue;
    out[r.kind].packs += r.packs;
    out[r.kind].seats += r.packs * r.seatsPerPack;
  }
  return out;
}

type AddInput = { kind: PackKind; packs: number; source: "institute" | "zinny"; note?: string | null; invoice: boolean; expectedTotalPaise?: number };

/**
 * Adds packs inside the caller's transaction: raises the cap, raises the invoice for the days
 * left, records the purchase, logs it and refreshes the warnings. No permission check.
 */
async function addPacksTx(tx: Tx, actor: Actor, universityId: string, input: AddInput, today: string) {
  if (!isPackKind(input.kind)) throw new ValidationError("Pick student packs or staff packs.");
  const countError = checkPackCount(input.packs);
  if (countError) throw new ValidationError(countError);
  const note = input.note?.trim() || null;
  if (note && note.length > 300) throw new ValidationError("Keep the note under 300 characters.");

  const { licence, plan, pricing } = await packContext(tx, universityId);
  if (today > licence.endDate) throw new ValidationError(`This licence ended on ${formatDate(licence.endDate)}. Renew it first, then add seats.`);
  const terms = pricing[input.kind];
  const quote = quotePacks({ packs: input.packs, terms, startDate: licence.startDate, endDate: licence.endDate, today });
  const key = capKey(input.kind);
  const capBefore = licence[key];
  const capAfter = capBefore + quote.seats;
  if (capAfter > MAX_CAP) throw new ValidationError(`That would take the cap past ${MAX_CAP.toLocaleString("en-IN")}. Talk to Zinny about a bigger plan.`);

  const [uni] = await tx.select({ stateCode: universities.stateCode }).from(universities).where(eq(universities.id, universityId));
  const sum = chargeFor(quote.amountPaise, 0, plan.gstRateBp, uni?.stateCode === zinnySeller().stateCode);
  if (input.expectedTotalPaise !== undefined && input.invoice && input.expectedTotalPaise !== sum.totalPaise) {
    throw new ConflictError(`The price has changed to ${formatINR(sum.totalPaise)} with GST. Check the new price and buy again.`);
  }

  await tx
    .update(platLicences)
    .set({ [key]: capAfter, updatedAt: new Date(), updatedBy: actor.userId || null })
    .where(eq(platLicences.id, licence.id));

  let invoice: Invoice | null = null;
  if (input.invoice && quote.amountPaise > 0) {
    const settings = await readBillingSettings(tx);
    invoice = await issueInvoice(tx, actor, {
      universityId,
      licenceId: licence.id,
      periodStart: quote.periodStart,
      periodEnd: quote.periodEnd,
      description: packInvoiceLine(input.kind, input.packs, quote.seats, quote.periodStart, quote.periodEnd, formatDate),
      listPricePaise: quote.amountPaise,
      gstRateBp: plan.gstRateBp,
      issueDate: today,
      dueDate: addDays(today, settings.paymentDays),
    });
  }

  const [pack] = await tx
    .insert(platSeatPacks)
    .values({
      universityId,
      licenceId: licence.id,
      kind: input.kind,
      packsBought: input.packs,
      packs: input.packs,
      seatsPerPack: terms.size,
      unitPricePaise: terms.yearPricePaise,
      chargedPaise: invoice ? quote.amountPaise : 0,
      periodStart: quote.periodStart,
      periodEnd: quote.periodEnd,
      invoiceId: invoice?.id ?? null,
      source: input.source,
      note,
      createdBy: actor.userId || null,
    })
    .returning();

  await logSeats(tx, actor, universityId, "plat.seats.add", "plat_seat_pack", pack.id, {
    kind: input.kind,
    packs: input.packs,
    seats: quote.seats,
    capBefore,
    capAfter,
    yearPricePaise: terms.yearPricePaise,
    daysLeft: quote.daysLeft,
    termDays: quote.termDays,
    amountPaise: invoice ? quote.amountPaise : 0,
    source: input.source,
    ...(note && { note }),
    ...(invoice ? { number: invoice.number, totalPaise: invoice.totalPaise } : { invoiced: false }),
  });
  await syncAlertsFor(tx, actor, universityId, today, { [plan.key]: plan.name });
  return { pack, invoice, quote, capAfter };
}

/* ─────────────────────────── Zinny team ─────────────────────────── */

export type PackHistoryEntry = { id: string; at: Date; action: string; byName: string | null; data: Record<string, unknown> };

/** What the licence page shows about seat packs for one institute. */
export async function seatPacksFor(actor: Actor, universityId: string, today = todayIST()) {
  assertPlatform(actor, "platform.licences");
  if (!isUuid(universityId)) throw new NotFoundError("Institute");
  const conn = db();
  const [licence] = await conn.select().from(platLicences).where(eq(platLicences.universityId, universityId));
  const defaults = await readSeatPackSettings(conn);
  if (!licence) return { licence: null, defaults, pricing: packPricingFor(defaults), purchases: [], held: heldPacks([]), history: [], term: null };
  const plan = await planByKey(conn, licence.plan);
  const [purchases, history] = await Promise.all([
    conn
      .select({ pack: platSeatPacks, byName: users.name, invoiceNumber: platInvoices.number, invoiceStatus: platInvoices.status, invoiceTotal: platInvoices.totalPaise })
      .from(platSeatPacks)
      .leftJoin(users, eq(users.id, platSeatPacks.createdBy))
      .leftJoin(platInvoices, eq(platInvoices.id, platSeatPacks.invoiceId))
      .where(eq(platSeatPacks.licenceId, licence.id))
      .orderBy(desc(platSeatPacks.createdAt)),
    conn
      .select({ id: auditLog.id, at: auditLog.at, action: auditLog.action, byName: users.name, data: auditLog.data })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(eq(auditLog.universityId, universityId), inArray(auditLog.action, ["plat.seats.add", "plat.seats.remove", "plat.seats.caps", "plat.seats.renew"])))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(30),
  ]);
  return {
    licence,
    defaults,
    planName: plan?.name ?? planNameFallback(licence.plan),
    pricing: packPricingFor(defaults, plan),
    purchases: purchases.map((r) => ({ ...r.pack, byName: r.byName, invoiceNumber: r.invoiceNumber, invoiceStatus: r.invoiceStatus, invoiceTotal: r.invoiceTotal })),
    held: heldPacks(purchases.map((r) => r.pack)),
    history: history.map((h) => ({ ...h, data: (h.data ?? {}) as Record<string, unknown> })) as PackHistoryEntry[],
    term: { daysLeft: daysLeftIn(today, licence.startDate, licence.endDate), termDays: daysInTerm(licence.startDate, licence.endDate), termMonths: monthsInTerm(licence.startDate, licence.endDate) },
  };
}

/**
 * Adds packs to an institute's licence for it (platform.licences): the cap goes up now and
 * the days left in the term are invoiced, unless `invoice` is false (packs given free, say
 * as part of a deal; the note then says why).
 */
export async function addSeatPacks(actor: Actor, universityId: string, input: { kind: PackKind; packs: number; note?: string | null; invoice?: boolean }, today = todayIST()) {
  assertPlatform(actor, "platform.licences");
  if (!isUuid(universityId)) throw new NotFoundError("Licence");
  const invoice = input.invoice ?? true;
  if (!invoice && !input.note?.trim()) throw new ValidationError("Write why these packs aren't charged, so finance can see it later.");
  return db().transaction((tx) => addPacksTx(tx, actor, universityId, { ...input, invoice, source: "zinny" }, today));
}

/**
 * Takes packs off an institute's licence (platform.licences), newest purchase first: their
 * seats come off the cap now and they don't renew. Invoices already raised stay as they are.
 */
export async function removeSeatPacks(actor: Actor, universityId: string, input: { kind: PackKind; packs: number; note: string }, today = todayIST()) {
  assertPlatform(actor, "platform.licences");
  if (!isUuid(universityId)) throw new NotFoundError("Licence");
  if (!isPackKind(input.kind)) throw new ValidationError("Pick student packs or staff packs.");
  const countError = checkPackCount(input.packs);
  if (countError) throw new ValidationError(countError);
  const note = input.note.trim();
  if (note.length < 3) throw new ValidationError("Write why the packs are coming off, so the institute and finance can see it later.");
  if (note.length > 300) throw new ValidationError("Keep the note under 300 characters.");
  return db().transaction(async (tx) => {
    const { licence, plan } = await packContext(tx, universityId);
    const rows = await tx
      .select()
      .from(platSeatPacks)
      .where(and(eq(platSeatPacks.licenceId, licence.id), eq(platSeatPacks.kind, input.kind), gt(platSeatPacks.packs, 0)))
      .orderBy(desc(platSeatPacks.createdAt), desc(platSeatPacks.id))
      .for("update");
    const have = rows.reduce((n, r) => n + r.packs, 0);
    if (have < input.packs) {
      throw new ValidationError(have === 0 ? `This licence has no ${input.kind} packs.` : `This licence has only ${describePacks(input.kind, have, heldPacks(rows)[input.kind].seats)}.`);
    }
    let left = input.packs;
    let seats = 0;
    const touched: { id: string; removed: number }[] = [];
    for (const r of rows) {
      if (left === 0) break;
      const take = Math.min(left, r.packs);
      left -= take;
      seats += take * r.seatsPerPack;
      touched.push({ id: r.id, removed: take });
      await tx
        .update(platSeatPacks)
        .set({ packs: r.packs - take, updatedAt: new Date() })
        .where(eq(platSeatPacks.id, r.id));
    }
    const key = capKey(input.kind);
    const capBefore = licence[key];
    const capAfter = capBefore - seats;
    if (capAfter < 1) {
      throw new ValidationError(`That would leave a ${input.kind} cap of ${capAfter}. Set the caps by hand first, or remove fewer packs.`);
    }
    await tx
      .update(platLicences)
      .set({ [key]: capAfter, updatedAt: new Date(), updatedBy: actor.userId || null })
      .where(eq(platLicences.id, licence.id));
    await logSeats(tx, actor, universityId, "plat.seats.remove", "plat_licence", licence.id, {
      kind: input.kind,
      packs: input.packs,
      seats,
      capBefore,
      capAfter,
      note,
      purchases: touched,
    });
    await syncAlertsFor(tx, actor, universityId, today, { [plan.key]: plan.name });
    return { packs: input.packs, seats, capAfter };
  });
}

/**
 * Sets a licence's caps by hand (platform.seat_pricing): a deal agreed outside packs, or a
 * correction. Packs on the licence stay as they are. `chargePaise` (before GST), when given,
 * is invoiced for the rest of the term at the plan's GST rate.
 */
export async function setUserCaps(
  actor: Actor,
  universityId: string,
  input: { studentCap: number; staffCap: number; note: string; chargePaise?: number },
  today = todayIST(),
) {
  assertPlatform(actor, "platform.licences");
  assertPlatform(actor, "platform.seat_pricing");
  if (!isUuid(universityId)) throw new NotFoundError("Licence");
  for (const [label, v] of [
    ["Student cap", input.studentCap],
    ["Staff cap", input.staffCap],
  ] as const) {
    if (!Number.isInteger(v) || v < 1 || v > MAX_CAP) throw new ValidationError(`${label} must be a whole number between 1 and ${MAX_CAP.toLocaleString("en-IN")}.`);
  }
  const note = input.note.trim();
  if (note.length < 3) throw new ValidationError("Write why the caps are changing, so the team can see it later.");
  if (note.length > 300) throw new ValidationError("Keep the note under 300 characters.");
  const charge = input.chargePaise ?? 0;
  if (!Number.isInteger(charge) || charge < 0) throw new ValidationError("Enter the charge before GST in rupees, or leave it empty.");
  return db().transaction(async (tx) => {
    const { licence, plan } = await packContext(tx, universityId);
    if (licence.studentCap === input.studentCap && licence.staffCap === input.staffCap) {
      throw new ValidationError("Nothing is different. Change a cap, then save.");
    }
    const [row] = await tx
      .update(platLicences)
      .set({ studentCap: input.studentCap, staffCap: input.staffCap, updatedAt: new Date(), updatedBy: actor.userId || null })
      .where(eq(platLicences.id, licence.id))
      .returning();
    let invoice: Invoice | null = null;
    if (charge > 0) {
      if (today > licence.endDate) throw new ValidationError(`This licence ended on ${formatDate(licence.endDate)}. Renew it before charging for caps.`);
      const settings = await readBillingSettings(tx);
      const from = today < licence.startDate ? licence.startDate : today;
      invoice = await issueInvoice(tx, actor, {
        universityId,
        licenceId: licence.id,
        periodStart: from,
        periodEnd: licence.endDate,
        description: `Zinny user caps raised to ${people("student", input.studentCap)} and ${people("staff", input.staffCap)}, ${formatDate(from)} to ${formatDate(licence.endDate)}`,
        listPricePaise: charge,
        gstRateBp: plan.gstRateBp,
        issueDate: today,
        dueDate: addDays(today, settings.paymentDays),
      });
    }
    await logSeats(tx, actor, universityId, "plat.seats.caps", "plat_licence", licence.id, {
      studentCap: input.studentCap,
      staffCap: input.staffCap,
      before: { studentCap: licence.studentCap, staffCap: licence.staffCap },
      note,
      ...(invoice ? { number: invoice.number, totalPaise: invoice.totalPaise } : { invoiced: false }),
    });
    await syncAlertsFor(tx, actor, universityId, today, { [plan.key]: plan.name });
    return { ...row, invoice };
  });
}

/* ─────────────────────────── The institute ─────────────────────────── */

function instituteOf(actor: Actor): string {
  if (!actor.universityId) throw new ForbiddenError("Open your institute's admin panel first.");
  return actor.universityId;
}

/** Admins with settings.manage buy packs and pay Zinny; finance.view can look. */
export function seatAccess(actor: Actor) {
  const universityId = actor.universityId;
  if (!universityId) return { view: false, buy: false };
  const buy = can(actor, "settings.manage", { universityId }) && !actor.viewedBy;
  return { view: buy || can(actor, "settings.manage", { universityId }) || can(actor, "finance.view", { universityId }), buy };
}

/**
 * Zinny invoices are paid online only while the test gateway is on (development and demo
 * sites): Zinny's own Razorpay account isn't connected yet. Otherwise the institute pays by
 * bank transfer and Zinny's finance team marks the invoice paid.
 */
export function zinnyOnlinePayments(env: NodeJS.ProcessEnv = process.env): boolean {
  return gateway().name === "mock" && (env.NODE_ENV !== "production" || env.ZINNY_DEMO === "1");
}

export type InstituteSeats = {
  licence: Pick<Licence, "plan" | "studentCap" | "staffCap" | "startDate" | "endDate"> | null;
  planName: string | null;
  usage: Usage;
  pricing: PackPricing;
  held: Record<PackKind, { packs: number; seats: number }>;
  purchases: (Pick<SeatPack, "id" | "kind" | "packsBought" | "packs" | "seatsPerPack" | "chargedPaise" | "periodStart" | "periodEnd" | "source" | "createdAt"> & { invoiceNumber: string | null })[];
  invoices: (Pick<Invoice, "id" | "number" | "description" | "issueDate" | "dueDate" | "status" | "paidOn" | "basePaise" | "totalPaise" | "periodStart" | "periodEnd"> & { overdue: boolean; listPricePaise: number })[];
  /** For the price as you type. */
  quote: { today: string; gstRateBp: number; intraState: boolean } | null;
  canBuy: boolean;
  onlinePayments: boolean;
};

/**
 * The institute's Seats page: usage against its caps, the packs it holds, the pack prices
 * for its plan and its Zinny invoices. Its own records come through row-level security.
 */
export async function instituteSeats(actor: Actor, today = todayIST()): Promise<InstituteSeats> {
  const universityId = instituteOf(actor);
  const access = seatAccess(actor);
  if (!access.view) throw new ForbiddenError();
  const mine = await withTenant(actor, async (tx) => {
    const [licence] = await tx.select().from(platLicences).where(eq(platLicences.universityId, universityId));
    const [uni] = await tx.select({ stateCode: universities.stateCode }).from(universities).where(eq(universities.id, universityId));
    const packs = licence
      ? await tx
          .select({ pack: platSeatPacks, invoiceNumber: platInvoices.number })
          .from(platSeatPacks)
          .leftJoin(platInvoices, eq(platInvoices.id, platSeatPacks.invoiceId))
          .where(eq(platSeatPacks.licenceId, licence.id))
          .orderBy(desc(platSeatPacks.createdAt))
      : [];
    const invoices = await tx.select().from(platInvoices).where(eq(platInvoices.universityId, universityId)).orderBy(desc(platInvoices.issueDate), desc(platInvoices.number)).limit(20);
    const usage = (await usageFor(tx, [universityId])).get(universityId) ?? emptyUsage();
    return { licence: licence ?? null, stateCode: uni?.stateCode ?? null, packs, invoices, usage };
  });
  // Zinny's price list: read only, on the system connection (see the note at the top).
  const [defaults, plan] = await Promise.all([readSeatPackSettings(), mine.licence ? planByKey(db(), mine.licence.plan) : Promise.resolve(null)]);
  const l = mine.licence;
  return {
    licence: l ? { plan: l.plan, studentCap: l.studentCap, staffCap: l.staffCap, startDate: l.startDate, endDate: l.endDate } : null,
    planName: l ? (plan?.name ?? planNameFallback(l.plan)) : null,
    usage: mine.usage,
    pricing: packPricingFor(defaults, plan),
    held: heldPacks(mine.packs.map((p) => p.pack)),
    purchases: mine.packs.map(({ pack: p, invoiceNumber }) => ({
      id: p.id,
      kind: p.kind,
      packsBought: p.packsBought,
      packs: p.packs,
      seatsPerPack: p.seatsPerPack,
      chargedPaise: p.chargedPaise,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      source: p.source,
      createdAt: p.createdAt,
      invoiceNumber,
    })),
    invoices: mine.invoices.map((i) => ({
      id: i.id,
      number: i.number,
      description: i.description,
      issueDate: i.issueDate,
      dueDate: i.dueDate,
      status: i.status,
      paidOn: i.paidOn,
      basePaise: i.basePaise,
      totalPaise: i.totalPaise,
      periodStart: i.periodStart,
      periodEnd: i.periodEnd,
      listPricePaise: listPriceOf(i),
      overdue: isOverdue(i, today),
    })),
    quote: l && plan && today <= l.endDate ? { today, gstRateBp: plan.gstRateBp, intraState: mine.stateCode === zinnySeller().stateCode } : null,
    canBuy: access.buy,
    onlinePayments: zinnyOnlinePayments(),
  };
}

/**
 * An institute buys packs for itself. The cap goes up now and an invoice for the days left
 * is raised, due after Zinny's payment terms. `expectedTotalPaise` is the total the page
 * showed: if the price has changed since, nothing is bought and the new price is shown.
 */
export async function buySeatPacks(actor: Actor, input: { kind: PackKind; packs: number; expectedTotalPaise?: number }, today = todayIST()) {
  const universityId = instituteOf(actor);
  assertCan(actor, "settings.manage", { universityId });
  if (actor.viewedBy) throw new ForbiddenError("Viewing as someone else is read only.");
  return db().transaction((tx) => addPacksTx(tx, actor, universityId, { kind: input.kind, packs: input.packs, source: "institute", invoice: true, expectedTotalPaise: input.expectedTotalPaise }, today));
}

/**
 * An institute pays one of its own Zinny invoices online. Only while the test gateway is on
 * (see zinnyOnlinePayments): the gateway order is created and the payment is recorded at once.
 */
export async function payZinnyInvoice(actor: Actor, invoiceId: string, today = todayIST()) {
  const universityId = instituteOf(actor);
  assertCan(actor, "settings.manage", { universityId });
  if (actor.viewedBy) throw new ForbiddenError("Viewing as someone else is read only.");
  if (!isUuid(invoiceId)) throw new NotFoundError("Invoice");
  if (!zinnyOnlinePayments()) {
    throw new ValidationError("Paying Zinny online isn't switched on yet. Pay by bank transfer quoting the invoice number; Zinny marks it paid when the money arrives.");
  }
  // Read under row-level security first: another institute's invoice simply isn't there.
  const [inv] = await withTenant(actor, (tx) => tx.select().from(platInvoices).where(eq(platInvoices.id, invoiceId)));
  if (!inv) throw new NotFoundError("Invoice");
  if (inv.status === "paid") throw new ConflictError(`Invoice ${inv.number} is already paid.`);
  const order = await gateway().createOrder({ amountPaise: inv.totalPaise, receipt: inv.number, notes: { kind: "zinny_invoice", invoiceId: inv.id, universityId } });
  const reference = `${order.gatewayOrderId.replace(/^mock_order_/, "mock_pay_")}`;
  return db().transaction((tx) => recordPaymentTx(tx, actor, inv.id, { paidOn: today < inv.issueDate ? inv.issueDate : today, reference, universityId, online: true }));
}

/** Pack history for the Zinny side, as words: "Added 2 student packs (50 students)". */
export function describeSeatEvent(e: { action: string; data: Record<string, unknown> }): string {
  const d = e.data;
  const kind = (isPackKind(d.kind) ? d.kind : "student") as PackKind;
  const packs = Number(d.packs ?? 0);
  const seats = Number(d.seats ?? 0);
  switch (e.action) {
    case "plat.seats.add":
      return `Added ${describePacks(kind, packs, seats)}${d.source === "institute" ? ", bought by the institute" : ""}${typeof d.amountPaise === "number" && d.amountPaise > 0 ? `, ${formatINR(d.amountPaise)} before GST` : ", not charged"}`;
    case "plat.seats.remove":
      return `Removed ${describePacks(kind, packs, seats)}${d.note ? `: ${String(d.note)}` : ""}`;
    case "plat.seats.renew":
      return `Renewed ${describePacks(kind, packs, seats)} with the licence${typeof d.amountPaise === "number" && d.amountPaise > 0 ? `, ${formatINR(d.amountPaise)} before GST` : ""}`;
    case "plat.seats.caps": {
      const before = (d.before ?? {}) as Record<string, unknown>;
      return `Caps set by hand: students ${String(before.studentCap ?? "?")} to ${String(d.studentCap)}, staff ${String(before.staffCap ?? "?")} to ${String(d.staffCap)}${d.note ? `. ${String(d.note)}` : ""}`;
    }
    default:
      return e.action;
  }
}

/** Every plan's own packs (only those that set any), for the billing settings page. */
export function planPackSummary(plans: Pick<Plan, "id" | "name" | "studentPackSize" | "studentPackPricePaise" | "staffPackSize" | "staffPackPricePaise" | "archivedAt">[]) {
  return plans.filter((p) => !p.archivedAt && (p.studentPackSize !== null || p.studentPackPricePaise !== null || p.staffPackSize !== null || p.staffPackPricePaise !== null));
}

export { PACK_KINDS, quotePacks, type PackKind, type PackQuote };
