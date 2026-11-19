/**
 * Licences (platform.licences): plan, caps, modules, term and price per university, usage
 * against the caps, and the warnings on the platform home (90% of a cap, 30 days
 * before the end date) kept in plat_alerts.
 *
 * A licence charges the institute: making one, renewing it or moving it to another plan
 * raises a Zinny invoice in the same transaction for the plan's price less any discount,
 * plus GST, unless the caller says not to.
 *
 * The price is copied onto the licence, so a later change to the plan's price leaves the
 * licence (and its invoices) alone until it renews: a renewal, by hand or by the daily
 * billing job, is priced at the plan's price on that day.
 */
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Conn, Tx } from "@/db/client";
import { universities, users } from "@/db/schema";
import { assertPlatform, canPlatform, type Actor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { platAlerts, platLicences, platSeatPacks } from "../schema";
import { CAP_WARNING_RATIO, END_WARNING_DAYS, LICENSABLE_MODULES } from "../lib/constants";
import { addDays, daysBetween, formatDate, isDate, todayIST } from "../lib/format";
import { termEnd } from "../lib/licence";
import { PACK_KINDS, packInvoiceLine, packPricingFor, renewalPackAmount } from "../lib/seat-packs";
import { invoicesForLicence, issueInvoice, licenceInvoiceLine, type Invoice } from "./billing";
import { readBillingSettings, readSeatPackSettings, type BillingSettings } from "./billing-settings";
import { planByKey, planNameFallback, planNames, planOptions, type Plan } from "./plans";
import { db, emptyUsage, isUuid, logAction, universityOrThrow, usageFor, type Usage } from "./shared";

/** How a licence's invoice is dated. Anything left out takes the default: today, due after the payment terms in the billing settings, the plan's GST rate. */
export type LicenceInvoiceInput = { issueDate?: string; dueDate?: string; gstRateBp?: number };

export type LicenceInput = {
  /** A plan's key. */
  plan: string;
  studentCap: number;
  staffCap: number;
  modules: string[];
  startDate: string;
  endDate: string;
  notes?: string | null;
  /**
   * List price before GST, for the term. Left out: the plan's price when the licence is
   * new, renewed or moved to another plan; otherwise the price it already has.
   */
  pricePaise?: number;
  discountPaise?: number;
  discountNote?: string | null;
  /**
   * The invoice to raise with this change. `false` (or null): don't create one. Left out:
   * one is raised when the licence is new, its term changed or its plan changed.
   * A net amount of 0 never creates an invoice.
   */
  invoice?: LicenceInvoiceInput | false | null;
  /** Renew by itself before it ends. Left out: what the licence has, or the billing settings' default for a new one. */
  autoRenew?: boolean;
};

export type Licence = typeof platLicences.$inferSelect;

const MAX_CAP = 1_000_000;
const MAX_PRICE = 100_00_00_000_00;
const MODULE_IDS = new Set<string>(LICENSABLE_MODULES.map((m) => m.id));

/**
 * Checks and tidies a licence before it is saved. Error messages say how to fix the field.
 * Whether the plan exists and can be picked is checked against the plans table in
 * `planForLicence`.
 */
export function validateLicence(input: LicenceInput) {
  const plan = (input.plan ?? "").trim();
  if (!plan) throw new ValidationError("Pick a plan.");
  for (const [label, v] of [
    ["Student cap", input.studentCap],
    ["Staff cap", input.staffCap],
  ] as const) {
    if (!Number.isInteger(v) || v < 1 || v > MAX_CAP) throw new ValidationError(`${label} must be a whole number between 1 and ${MAX_CAP.toLocaleString("en-IN")}.`);
  }
  const unknown = input.modules.filter((m) => !MODULE_IDS.has(m));
  if (unknown.length) throw new ValidationError(`Unknown module: ${unknown.join(", ")}.`);
  if (!isDate(input.startDate)) throw new ValidationError("Enter a start date.");
  if (!isDate(input.endDate)) throw new ValidationError("Enter an end date.");
  if (input.endDate < input.startDate) throw new ValidationError("The end date must be on or after the start date.");
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 2000) throw new ValidationError("Keep the notes under 2,000 characters.");
  if (input.pricePaise !== undefined && (!Number.isInteger(input.pricePaise) || input.pricePaise < 0 || input.pricePaise > MAX_PRICE)) {
    throw new ValidationError("Enter the price before GST in rupees, like 720000. Use 0 for a free licence.");
  }
  if (input.discountPaise !== undefined && (!Number.isInteger(input.discountPaise) || input.discountPaise < 0)) {
    throw new ValidationError("Enter the discount in rupees, or leave it at 0.");
  }
  const discountNote = input.discountNote?.trim() || null;
  if (discountNote && discountNote.length > 300) throw new ValidationError("Keep the discount note under 300 characters.");
  if (input.invoice) {
    const { issueDate, dueDate } = input.invoice;
    if (issueDate !== undefined && !isDate(issueDate)) throw new ValidationError("Enter the invoice date.");
    if (dueDate !== undefined && !isDate(dueDate)) throw new ValidationError("Enter the due date.");
    if (issueDate && dueDate && dueDate < issueDate) throw new ValidationError("The due date can't be before the invoice date.");
  }
  return {
    plan,
    studentCap: input.studentCap,
    staffCap: input.staffCap,
    // Keep the catalogue order so the stored list is stable.
    modules: LICENSABLE_MODULES.map((m) => m.id).filter((id) => input.modules.includes(id)),
    startDate: input.startDate,
    endDate: input.endDate,
    notes,
  };
}

/**
 * The plan a licence is being saved on. It must exist, and an archived plan can only stay
 * on a licence that already has it (`currentPlan`).
 */
export async function planForLicence(conn: Conn, key: string, currentPlan?: string | null): Promise<Plan> {
  const plan = await planByKey(conn, key.trim());
  if (!plan) throw new ValidationError("Pick a plan from the list. Plans are managed on the Plans page.");
  if (plan.archivedAt && plan.key !== currentPlan) {
    throw new ValidationError(`${plan.name} is archived, so it can't be used for a new licence. Restore it on the Plans page or pick another plan.`);
  }
  return plan;
}

/** `packInvoices`: the seat packs that renewed with a new term, one invoice per kind. */
export type SavedLicence = Licence & { invoice: Invoice | null; packInvoices?: Invoice[] };

/**
 * Creates or replaces a university's licence, raises its invoice when there is something
 * to charge, then refreshes its warnings. All in one transaction: a problem with the
 * invoice leaves the licence as it was.
 */
export async function saveLicence(actor: Actor, universityId: string, input: LicenceInput, today = todayIST()): Promise<SavedLicence> {
  assertPlatform(actor, "platform.licences");
  validateLicence(input);
  const settings = await readBillingSettings();
  return db().transaction((tx) => saveLicenceTx(tx, actor, universityId, input, settings, today));
}

/**
 * The work of `saveLicence` inside the caller's transaction, for the services that have
 * already checked permission (saveLicence, renewals by hand and by the daily billing job).
 * `automatic` marks the log entries as made by Zinny on its own; `renewal` as a renewal.
 */
export async function saveLicenceTx(
  tx: Tx,
  actor: Actor,
  universityId: string,
  input: LicenceInput,
  settings: Pick<BillingSettings, "paymentDays" | "autoRenewDefault">,
  today = todayIST(),
  opts: { automatic?: boolean; renewal?: boolean } = {},
): Promise<SavedLicence> {
  const clean = validateLicence(input);
  await universityOrThrow(tx, universityId);
  const [before] = await tx.select().from(platLicences).where(eq(platLicences.universityId, universityId)).for("update");
  const plan = await planForLicence(tx, clean.plan, before?.plan);

  // New, renewed (the term moved) or on another plan: that is what gets charged.
  const billable = !before || before.plan !== plan.key || before.startDate !== clean.startDate || before.endDate !== clean.endDate;
  const pricePaise = input.pricePaise ?? (billable ? plan.pricePaise : before.pricePaise);
  const discountPaise = input.discountPaise ?? (billable ? 0 : before.discountPaise);
  const discountNote = discountPaise > 0 ? (input.discountNote !== undefined ? input.discountNote?.trim() || null : billable ? null : before.discountNote) : null;
  if (discountPaise > pricePaise) throw new ValidationError("The discount can't be more than the price.");
  if (discountPaise > 0 && !discountNote) throw new ValidationError("Write why the discount was given, so finance can see it later.");
  // Caps set by hand on a licence that stays on its plan are a pricing decision: platform.seat_pricing.
  // A new licence, or one moving to another plan, takes the caps agreed for it.
  if (before && before.plan === plan.key && (before.studentCap !== clean.studentCap || before.staffCap !== clean.staffCap) && !canPlatform(actor, "platform.seat_pricing")) {
    throw new ForbiddenError("Changing the student or staff cap needs the Edit seat packs and user caps permission. Add seat packs to the licence instead, or ask a Super Admin.");
  }
  const autoRenew = input.autoRenew ?? before?.autoRenew ?? settings.autoRenewDefault;

  const values = { ...clean, plan: plan.key, pricePaise, discountPaise, discountNote, autoRenew, updatedAt: new Date(), updatedBy: actor.userId || null };
  const [row] = before
    ? await tx.update(platLicences).set(values).where(eq(platLicences.id, before.id)).returning()
    : await tx.insert(platLicences).values({ universityId, ...values }).returning();

  const wanted = input.invoice === false || input.invoice === null ? false : input.invoice ? true : billable;
  let invoice: Invoice | null = null;
  if (wanted && pricePaise - discountPaise > 0) {
    const terms = input.invoice || {};
    const issueDate = terms.issueDate ?? today;
    invoice = await issueInvoice(tx, actor, {
      universityId,
      licenceId: row.id,
      periodStart: row.startDate,
      periodEnd: row.endDate,
      description: licenceInvoiceLine(plan.name, row.startDate, row.endDate),
      listPricePaise: pricePaise,
      discountPaise,
      discountNote,
      gstRateBp: terms.gstRateBp ?? plan.gstRateBp,
      issueDate,
      dueDate: terms.dueDate ?? addDays(issueDate, settings.paymentDays),
      automatic: opts.automatic,
    });
  }

  // A new term after the old one ended: the seat packs still on the licence renew with it,
  // at today's pack price, on an invoice of their own. (Changing the dates of the same term
  // doesn't charge the packs again.)
  const packInvoices: Invoice[] = [];
  if (before && wanted && clean.startDate > before.endDate) {
    const terms = input.invoice || {};
    const issueDate = terms.issueDate ?? today;
    packInvoices.push(
      ...(await renewPacksTx(tx, actor, row, plan, { issueDate, dueDate: terms.dueDate ?? addDays(issueDate, settings.paymentDays), gstRateBp: terms.gstRateBp }, opts)),
    );
  }

  const action = opts.renewal ? "plat.licence.renew" : before ? "plat.licence.update" : "plat.licence.create";
  await logAction(tx, actor, { universityId, inUniversityLog: true }, action, "plat_licence", row.id, {
    plan: row.plan,
    studentCap: row.studentCap,
    staffCap: row.staffCap,
    modules: row.modules,
    startDate: row.startDate,
    endDate: row.endDate,
    pricePaise: row.pricePaise,
    discountPaise: row.discountPaise,
    autoRenew: row.autoRenew,
    ...(row.discountNote && { discountNote: row.discountNote }),
    ...(invoice ? { number: invoice.number, totalPaise: invoice.totalPaise } : { invoiced: false }),
    ...(opts.automatic && { automatic: true }),
    ...(before && {
      before: {
        plan: before.plan,
        studentCap: before.studentCap,
        staffCap: before.staffCap,
        modules: before.modules,
        startDate: before.startDate,
        endDate: before.endDate,
        pricePaise: before.pricePaise,
        discountPaise: before.discountPaise,
        autoRenew: before.autoRenew,
      },
    }),
  });
  await syncAlertsFor(tx, actor, universityId, today, { [plan.key]: plan.name });
  return { ...row, invoice, packInvoices };
}

/**
 * Invoices the seat packs still on `licence` for its new term (licence.startDate to
 * endDate), one invoice per kind, at the pack price today: the plan's own when it sets one,
 * otherwise the billing settings' default. Inside the caller's transaction; no permission
 * check. Packs priced at 0 are carried over without an invoice.
 */
async function renewPacksTx(
  tx: Tx,
  actor: Actor,
  licence: Licence,
  plan: Plan,
  terms: { issueDate: string; dueDate: string; gstRateBp?: number },
  opts: { automatic?: boolean },
): Promise<Invoice[]> {
  const held = await tx
    .select({ kind: platSeatPacks.kind, packs: platSeatPacks.packs, seatsPerPack: platSeatPacks.seatsPerPack })
    .from(platSeatPacks)
    .where(and(eq(platSeatPacks.licenceId, licence.id), gt(platSeatPacks.packs, 0)));
  if (held.length === 0) return [];
  const pricing = packPricingFor(await readSeatPackSettings(tx), plan);
  const out: Invoice[] = [];
  for (const kind of PACK_KINDS) {
    const mine = held.filter((h) => h.kind === kind);
    if (mine.length === 0) continue;
    const sum = renewalPackAmount(mine, pricing[kind], licence.startDate, licence.endDate);
    let inv: Invoice | null = null;
    if (sum.amountPaise > 0) {
      inv = await issueInvoice(tx, actor, {
        universityId: licence.universityId,
        licenceId: licence.id,
        periodStart: licence.startDate,
        periodEnd: licence.endDate,
        description: packInvoiceLine(kind, sum.packs, sum.seats, licence.startDate, licence.endDate, formatDate, true),
        listPricePaise: sum.amountPaise,
        gstRateBp: terms.gstRateBp ?? plan.gstRateBp,
        issueDate: terms.issueDate,
        dueDate: terms.dueDate,
        automatic: opts.automatic,
      });
      out.push(inv);
    }
    await logAction(tx, actor, { universityId: licence.universityId, inUniversityLog: true }, "plat.seats.renew", "plat_licence", licence.id, {
      kind,
      packs: sum.packs,
      seats: sum.seats,
      yearPricePaise: pricing[kind].yearPricePaise,
      packSize: pricing[kind].size,
      amountPaise: sum.amountPaise,
      periodStart: licence.startDate,
      periodEnd: licence.endDate,
      ...(inv ? { number: inv.number, totalPaise: inv.totalPaise } : { invoiced: false }),
      ...(opts.automatic && { automatic: true }),
    });
  }
  return out;
}

/** The term after `licence`: from the day after it ends, for the plan's billing period. */
export function nextTerm(licence: Pick<Licence, "endDate">, billingMonths: number) {
  const startDate = addDays(licence.endDate, 1);
  return { startDate, endDate: termEnd(startDate, billingMonths) };
}

/**
 * What a renewal of `licence` on `plan` charges: the plan's price today (not the price the
 * licence was sold at), less the licence's discount when the settings carry it over and
 * it is still smaller than the price.
 */
export function renewalCharge(licence: Pick<Licence, "discountPaise" | "discountNote">, plan: Pick<Plan, "pricePaise">, keepDiscount: boolean) {
  const keep = keepDiscount && licence.discountPaise > 0 && licence.discountPaise < plan.pricePaise && !!licence.discountNote;
  return { pricePaise: plan.pricePaise, discountPaise: keep ? licence.discountPaise : 0, discountNote: keep ? licence.discountNote : null };
}

/**
 * Renews a licence for its next term inside the caller's transaction: same caps, modules
 * and notes, the plan's current price, the discount per the settings, and an invoice dated
 * `today` due after the payment terms. No permission check (callers check theirs).
 */
export async function renewLicenceTx(tx: Tx, actor: Actor, licence: Licence, plan: Plan, settings: BillingSettings, today: string, opts: { automatic?: boolean } = {}) {
  if (plan.archivedAt) throw new ValidationError(`Plan ${plan.name} is archived; pick a plan to renew on the licence page.`);
  const term = nextTerm(licence, plan.billingMonths);
  return saveLicenceTx(
    tx,
    actor,
    licence.universityId,
    {
      plan: plan.key,
      studentCap: licence.studentCap,
      staffCap: licence.staffCap,
      modules: licence.modules,
      ...term,
      notes: licence.notes,
      ...renewalCharge(licence, plan, settings.keepDiscountOnRenewal),
      autoRenew: licence.autoRenew,
      invoice: {},
    },
    settings,
    today,
    { automatic: opts.automatic, renewal: true },
  );
}

/** "Renew now": renews one institute's licence for its next term straight away, invoiced at the plan's price today. */
export async function renewLicenceNow(actor: Actor, universityId: string, today = todayIST()): Promise<SavedLicence> {
  assertPlatform(actor, "platform.licences");
  if (!isUuid(universityId)) throw new NotFoundError("Licence");
  const settings = await readBillingSettings();
  return db().transaction(async (tx) => {
    const [licence] = await tx.select().from(platLicences).where(eq(platLicences.universityId, universityId)).for("update");
    if (!licence) throw new NotFoundError("Licence");
    const plan = await planByKey(tx, licence.plan);
    if (!plan) throw new ValidationError("This licence's plan no longer exists. Pick a plan on the licence page to renew it.");
    return renewLicenceTx(tx, actor, licence, plan, settings, today);
  });
}

/** Turns "Renew automatically" on or off for one institute's licence. */
export async function setAutoRenew(actor: Actor, universityId: string, on: boolean): Promise<Licence> {
  assertPlatform(actor, "platform.licences");
  if (!isUuid(universityId)) throw new NotFoundError("Licence");
  return db().transaction(async (tx) => {
    const [licence] = await tx.select().from(platLicences).where(eq(platLicences.universityId, universityId)).for("update");
    if (!licence) throw new NotFoundError("Licence");
    if (licence.autoRenew === on) return licence;
    const [row] = await tx
      .update(platLicences)
      .set({ autoRenew: on, updatedAt: new Date(), updatedBy: actor.userId || null })
      .where(eq(platLicences.id, licence.id))
      .returning();
    await logAction(tx, actor, { universityId, inUniversityLog: true }, "plat.licence.auto_renew", "plat_licence", row.id, { autoRenew: on, before: { autoRenew: licence.autoRenew } });
    return row;
  });
}

export type LicenceRow = {
  universityId: string;
  universityName: string;
  slug: string;
  status: string;
  licence: Licence | null;
  /** The licence's plan by name. */
  planName: string | null;
  usage: Usage;
  studentPct: number | null;
  staffPct: number | null;
  daysLeft: number | null;
  openAlerts: number;
};

function pct(n: number, cap: number) {
  return cap > 0 ? Math.round((n / cap) * 100) : null;
}

/** Every university with its licence (if any) and usage against the caps. */
export async function listLicences(actor: Actor, today = todayIST()): Promise<LicenceRow[]> {
  assertPlatform(actor, "platform.licences");
  const conn = db();
  const unis = await conn
    .select({ id: universities.id, name: universities.name, slug: universities.slug, status: universities.status })
    .from(universities)
    .orderBy(asc(universities.name));
  const [lics, usage, alerts, names] = await Promise.all([
    conn.select().from(platLicences),
    usageFor(conn),
    conn.select({ universityId: platAlerts.universityId }).from(platAlerts).where(isNull(platAlerts.resolvedAt)),
    planNames(conn),
  ]);
  const licOf = new Map(lics.map((l) => [l.universityId, l]));
  const alertCount = new Map<string, number>();
  for (const a of alerts) alertCount.set(a.universityId, (alertCount.get(a.universityId) ?? 0) + 1);
  return unis.map((u) => {
    const licence = licOf.get(u.id) ?? null;
    const use = usage.get(u.id) ?? emptyUsage();
    return {
      universityId: u.id,
      universityName: u.name,
      slug: u.slug,
      status: u.status,
      licence,
      planName: licence ? (names[licence.plan] ?? planNameFallback(licence.plan)) : null,
      usage: use,
      studentPct: licence ? pct(use.students, licence.studentCap) : null,
      staffPct: licence ? pct(use.staff, licence.staffCap) : null,
      daysLeft: licence ? daysBetween(today, licence.endDate) : null,
      openAlerts: alertCount.get(u.id) ?? 0,
    };
  });
}

/** One university's licence with its usage, the plans it can be on and the invoices raised for it. */
export async function licenceFor(actor: Actor, universityId: string, today = todayIST()) {
  assertPlatform(actor, "platform.licences");
  if (!isUuid(universityId)) throw new NotFoundError("Institute");
  const conn = db();
  const university = await universityOrThrow(conn, universityId);
  const [licence] = await conn.select().from(platLicences).where(eq(platLicences.universityId, universityId));
  const usage = (await usageFor(conn, [universityId])).get(universityId) ?? emptyUsage();
  const alerts = await conn
    .select()
    .from(platAlerts)
    .where(and(eq(platAlerts.universityId, universityId), isNull(platAlerts.resolvedAt)))
    .orderBy(asc(platAlerts.kind));
  const [plans, invoices] = await Promise.all([planOptions(actor, { keep: licence?.plan }), licence ? invoicesForLicence(actor, licence.id, today) : []]);
  return {
    university,
    licence: licence ?? null,
    plans,
    invoices,
    usage,
    alerts,
    daysLeft: licence ? daysBetween(today, licence.endDate) : null,
  };
}

/* ─────────────────────────── Warnings ─────────────────────────── */

export type AlertKind = "student_cap" | "staff_cap" | "licence_end";
const LICENCE_ALERT_KINDS: readonly AlertKind[] = ["student_cap", "staff_cap", "licence_end"];
export type Condition = { kind: AlertKind; level: "warning" | "critical"; title: string; body: string; data: Record<string, unknown> };

/**
 * What a licence should warn about today. Pure, so the thresholds are easy to test:
 * a cap warns from 90% and is critical from 100%; the end date warns from 30 days
 * before and is critical once it has passed.
 */
export function licenceConditions(
  licence: { plan: string; studentCap: number; staffCap: number; endDate: string },
  usage: Usage,
  today: string,
  universityName: string,
  planName: string = planNameFallback(licence.plan),
): Condition[] {
  const out: Condition[] = [];
  const plan = planName;
  const caps = [
    { kind: "student_cap" as const, used: usage.students, cap: licence.studentCap, noun: "student", nouns: "students" },
    { kind: "staff_cap" as const, used: usage.staff, cap: licence.staffCap, noun: "staff", nouns: "staff" },
  ];
  for (const c of caps) {
    const ratio = c.used / c.cap;
    if (ratio < CAP_WARNING_RATIO) continue;
    const percent = Math.floor(ratio * 100);
    const over = c.used > c.cap;
    out.push({
      kind: c.kind,
      level: ratio >= 1 ? "critical" : "warning",
      title: over
        ? `${universityName} is over its ${c.noun} cap`
        : ratio >= 1
          ? `${universityName} has reached its ${c.noun} cap`
          : `${universityName} is at ${percent}% of its ${c.noun} cap`,
      body: `${c.used.toLocaleString("en-IN")} of ${c.cap.toLocaleString("en-IN")} ${c.nouns} on the ${plan} plan.`,
      data: { used: c.used, cap: c.cap, percent },
    });
  }
  const daysLeft = daysBetween(today, licence.endDate);
  if (daysLeft < 0) {
    out.push({
      kind: "licence_end",
      level: "critical",
      title: `${universityName}'s licence has ended`,
      body: `The ${plan} licence ended on ${formatDate(licence.endDate)}. Renew it or agree the next plan.`,
      data: { endDate: licence.endDate, daysLeft },
    });
  } else if (daysLeft <= END_WARNING_DAYS) {
    out.push({
      kind: "licence_end",
      level: "warning",
      title:
        daysLeft === 0
          ? `${universityName}'s licence ends today`
          : `${universityName}'s licence ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      body: `The ${plan} licence ends on ${formatDate(licence.endDate)}. Agree a renewal before then.`,
      data: { endDate: licence.endDate, daysLeft },
    });
  }
  return out;
}

/**
 * Brings one university's open alerts in line with its licence today: raises new ones,
 * updates changed ones, resolves cleared ones. An alert someone marked as handled shows
 * again only if it gets worse (warning → critical). Suspended universities and
 * universities without a licence have no warnings.
 *
 * Runs on the system connection (after a licence change) and inside withTenant from the
 * hourly job, so it only uses tables row-level security lets a university's system
 * actor read. Plans are Zinny's own table, which a university's connection can't read:
 * the job passes the plan names in, and without them the plan's key is shown as its name.
 */
export async function syncAlertsFor(conn: Tx, actor: Actor, universityId: string, today: string, names?: Record<string, string>) {
  const [uni] = await conn.select({ name: universities.name, status: universities.status }).from(universities).where(eq(universities.id, universityId));
  if (!uni) return { raised: 0, updated: 0, resolved: 0 };
  const [licence] = await conn.select().from(platLicences).where(eq(platLicences.universityId, universityId));
  const usage = (await usageFor(conn, [universityId])).get(universityId) ?? emptyUsage();
  // Only the Zinny team's own connection (no university on the actor) can read the plans.
  const planName = licence ? (names?.[licence.plan] ?? (actor.universityId ? undefined : (await planNames(conn))[licence.plan])) : undefined;
  const wanted = licence && uni.status === "active" ? licenceConditions(licence, usage, today, uni.name, planName ?? planNameFallback(licence.plan)) : [];
  // Only the kinds worked out here; the billing job raises and clears its own ("renewal_blocked").
  const open = await conn
    .select()
    .from(platAlerts)
    .where(and(eq(platAlerts.universityId, universityId), isNull(platAlerts.resolvedAt), inArray(platAlerts.kind, [...LICENCE_ALERT_KINDS])))
    .for("update");
  const openByKind = new Map(open.map((a) => [a.kind, a]));
  // The job runs as the university's system actor (its log); licence changes run as a Zinny team member.
  const log = (action: string, id: string, data: Record<string, unknown>) =>
    logAction(conn, actor, { universityId, inUniversityLog: !!actor.universityId }, action, "plat_alert", id, data);

  let raised = 0;
  let updated = 0;
  let resolved = 0;
  const now = new Date();
  for (const c of wanted) {
    const existing = openByKind.get(c.kind);
    if (!existing) {
      const [row] = await conn
        .insert(platAlerts)
        .values({ universityId, kind: c.kind, level: c.level, title: c.title, body: c.body, data: c.data })
        .onConflictDoNothing()
        .returning();
      if (row) {
        raised++;
        await log("plat.alert.raise", row.id, { kind: c.kind, level: c.level, title: c.title });
      }
      continue;
    }
    if (existing.title === c.title && existing.body === c.body && existing.level === c.level) continue;
    const worse = existing.level === "warning" && c.level === "critical";
    await conn
      .update(platAlerts)
      .set({
        level: c.level,
        title: c.title,
        body: c.body,
        data: c.data,
        updatedAt: now,
        ...(worse && { acknowledgedAt: null, acknowledgedBy: null }),
      })
      .where(eq(platAlerts.id, existing.id));
    updated++;
  }
  const keep = new Set(wanted.map((c) => c.kind));
  const gone = open.filter((a) => !keep.has(a.kind as AlertKind));
  if (gone.length) {
    await conn
      .update(platAlerts)
      .set({ resolvedAt: now, updatedAt: now })
      .where(inArray(platAlerts.id, gone.map((a) => a.id)));
    for (const a of gone) {
      resolved++;
      await log("plat.alert.resolve", a.id, { kind: a.kind });
    }
  }
  return { raised, updated, resolved };
}

/** Re-checks every university now (the hourly job does this too). */
export async function syncAllAlerts(actor: Actor, today = todayIST()) {
  assertPlatform(actor, "platform.licences");
  const unis = await db().select({ id: universities.id }).from(universities);
  const names = await planNames();
  const total = { raised: 0, updated: 0, resolved: 0 };
  for (const u of unis) {
    const r = await db().transaction((tx) => syncAlertsFor(tx, actor, u.id, today, names));
    total.raised += r.raised;
    total.updated += r.updated;
    total.resolved += r.resolved;
  }
  return total;
}

export type AlertRow = typeof platAlerts.$inferSelect & { universityName: string; acknowledgedByName: string | null };

/** Open warnings, the most serious first. `handled: false` leaves out the ones someone marked as handled. */
export async function listAlerts(actor: Actor, opts: { handled?: boolean } = {}): Promise<AlertRow[]> {
  assertPlatform(actor, "platform.licences");
  const rows = await db()
    .select({ alert: platAlerts, universityName: universities.name, acknowledgedByName: users.name })
    .from(platAlerts)
    .innerJoin(universities, eq(universities.id, platAlerts.universityId))
    .leftJoin(users, eq(users.id, platAlerts.acknowledgedBy))
    .where(and(isNull(platAlerts.resolvedAt), opts.handled === false ? isNull(platAlerts.acknowledgedAt) : undefined))
    .orderBy(desc(platAlerts.updatedAt));
  return rows
    .map((r) => ({ ...r.alert, universityName: r.universityName, acknowledgedByName: r.acknowledgedByName }))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
}

/** Marks a warning as handled: it leaves the home page until it gets worse or clears. */
export async function acknowledgeAlert(actor: Actor, alertId: string) {
  assertPlatform(actor, "platform.licences");
  if (!isUuid(alertId)) throw new NotFoundError("Alert");
  return db().transaction(async (tx) => {
    const [a] = await tx.select().from(platAlerts).where(eq(platAlerts.id, alertId)).for("update");
    if (!a) throw new NotFoundError("Alert");
    if (a.resolvedAt) throw new ConflictError("This warning has already cleared.");
    if (a.acknowledgedAt) return a;
    const [row] = await tx
      .update(platAlerts)
      .set({ acknowledgedAt: new Date(), acknowledgedBy: actor.userId || null })
      .where(eq(platAlerts.id, alertId))
      .returning();
    await logAction(tx, actor, { universityId: a.universityId }, "plat.alert.acknowledge", "plat_alert", a.id, { kind: a.kind, title: a.title });
    return row;
  });
}
