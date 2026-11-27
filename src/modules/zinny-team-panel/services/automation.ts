/**
 * Billing automation: what the daily job does for each institute, and "Run billing now".
 *
 *  1. Renewals. A licence with "Renew automatically" on, whose end date is within the
 *     renewal lead time and which has no invoice yet for its next term, is renewed: the
 *     next term starts the day after it ends and lasts the plan's billing period, at the
 *     plan's price today, with its discount carried over when the settings say so, and is
 *     invoiced (renewLicenceTx, the same code as saving a licence by hand). Logged as done
 *     by Zinny, automatically. A licence on an archived plan isn't renewed: it gets a
 *     "renewal_blocked" warning instead, cleared once that no longer applies.
 *  2. Payment reminders for unpaid invoices on the settings' schedule (before the due
 *     date, on it, then every N days up to a limit). The institute's admins get an in-app
 *     notification and an email; the reminder goes into the invoice's history. Each step
 *     is stored on the invoice (reminder_stage) and is never sent twice.
 *  3. Licence-end reminders (licenceEndRemindersFor): 30, 14, 7 and 1 days before the end
 *     date, the admins get a notification and an email, once per step and end date.
 *
 * Overdue is not a stored status: an unpaid invoice past its due date shows as overdue
 * everywhere (see `isOverdue`).
 *
 * Runs on the system connection: plans, settings and the invoice counter are Zinny's own
 * tables, which row-level security keeps from a university's connection (the exception
 * named in this module's brief). Everything is idempotent, so the job can run more than
 * once a day.
 */
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { roleAssignments, universities, users } from "@/db/schema";
import { assertPlatform, notify, sendEmail, systemActorFor, type Actor } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import { platAlerts, platInvoices, platLicences } from "../schema";
import { reminderLevel } from "../components/licence-reminder";
import { assertSuperAdmin, canPlatform } from "../lib/access";
import { chargeFor } from "../lib/charge";
import { zinnySeller } from "../lib/constants";
import { addDays, daysBetween, formatDate, formatINR, plural, todayIST } from "../lib/format";
import { readBillingSettings, type BillingSettings } from "./billing-settings";
import { allPlans, planNameFallback, type Plan } from "./plans";
import { nextTerm, renewalCharge, renewLicenceTx, type Licence } from "./licences";
import { db, logAction } from "./shared";

export const REMINDER_KIND = "zinny.invoice_reminder";

export type BillingRun = { renewed: number; blocked: number; reminders: number };

/* ─────────────────────────── Reminder schedule ─────────────────────────── */

export type ReminderStep = { stage: number; kind: "before" | "due" | "overdue"; on: string; n?: number };

/** Every step on the schedule for an invoice due on `dueDate`, in order. Stage numbers never change meaning. */
export function reminderSteps(dueDate: string, s: Pick<BillingSettings, "remindDaysBefore" | "remindOnDueDate" | "remindEveryDaysAfter" | "maxOverdueReminders">): ReminderStep[] {
  const steps: ReminderStep[] = [];
  if (s.remindDaysBefore > 0) steps.push({ stage: 1, kind: "before", on: addDays(dueDate, -s.remindDaysBefore) });
  if (s.remindOnDueDate) steps.push({ stage: 2, kind: "due", on: dueDate });
  for (let n = 1; n <= s.maxOverdueReminders; n++) steps.push({ stage: 2 + n, kind: "overdue", on: addDays(dueDate, n * s.remindEveryDaysAfter), n });
  return steps;
}

/**
 * The reminder to send today for an unpaid invoice, or null. The latest step that has come
 * round and is past the last one sent; steps missed while the job didn't run are skipped,
 * so an institute never gets several at once. Nothing on the day the invoice is issued,
 * and no "due soon" reminder once the due date has passed.
 */
export function reminderDue(
  inv: { issueDate: string; dueDate: string; reminderStage: number; status: string },
  today: string,
  s: Pick<BillingSettings, "remindersOn" | "remindDaysBefore" | "remindOnDueDate" | "remindEveryDaysAfter" | "maxOverdueReminders">,
): ReminderStep | null {
  if (!s.remindersOn || inv.status !== "unpaid" || today <= inv.issueDate) return null;
  const step = reminderSteps(inv.dueDate, s)
    .filter((x) => x.on <= today)
    .at(-1);
  if (!step || step.stage <= inv.reminderStage) return null;
  if (step.kind === "before" && today >= inv.dueDate) return null;
  return step;
}

/** The reminder's headline and text. Amounts with paise, as on the invoice. */
export function reminderMessage(inv: { number: string; totalPaise: number; dueDate: string }, step: ReminderStep, today: string) {
  const amount = formatINR(inv.totalPaise);
  const due = formatDate(inv.dueDate);
  if (step.kind === "before") {
    const days = daysBetween(today, inv.dueDate);
    return {
      title: `Zinny invoice ${inv.number} is due in ${plural(days, "day")}`,
      body: `Invoice ${inv.number} for ${amount} is due on ${due}. If you have already paid, send the payment reference to Zinny so it can be marked paid.`,
    };
  }
  if (step.kind === "due") {
    return {
      title: `Zinny invoice ${inv.number} is due today`,
      body: `Invoice ${inv.number} for ${amount} is due today, ${due}. If you have already paid, send the payment reference to Zinny so it can be marked paid.`,
    };
  }
  return {
    title: `Zinny invoice ${inv.number} is overdue`,
    body: `Invoice ${inv.number} for ${amount} was due on ${due} and is still unpaid. Pay it as soon as you can, or send the payment reference to Zinny if you already have.`,
  };
}

/* ─────────────────────────── The job ─────────────────────────── */

/** The daily job runs as a university's system actor; nobody else can call it for a university. */
function assertSystemActor(actor: Actor): string {
  if (!actor.universityId || actor.userId) throw new ForbiddenError("Billing runs automatically. Use Run billing now on the billing settings page.");
  return actor.universityId;
}

/**
 * One institute's billing for today: renewals, then reminders. Called by the daily job and
 * by "Run billing now", always as the institute's system actor.
 */
export async function runBillingFor(actor: Actor, today = todayIST(), loaded?: { settings: BillingSettings; plans: Plan[] }): Promise<BillingRun> {
  const universityId = assertSystemActor(actor);
  const [uni] = await db().select({ status: universities.status }).from(universities).where(eq(universities.id, universityId));
  // A suspended institute is neither renewed nor chased.
  if (!uni || uni.status !== "active") return { renewed: 0, blocked: 0, reminders: 0 };
  const settings = loaded?.settings ?? (await readBillingSettings());
  const plans = loaded?.plans ?? (await allPlans());
  const { renewed, blocked } = await renewalsFor(actor, universityId, settings, plans, today);
  const reminders = await remindersFor(actor, universityId, settings, today);
  return { renewed, blocked, reminders };
}

const BLOCKED = "renewal_blocked";

async function renewalsFor(actor: Actor, universityId: string, settings: BillingSettings, plans: Plan[], today: string) {
  const planOf = new Map(plans.map((p) => [p.key, p]));
  return db().transaction(async (tx) => {
    const [licence] = await tx.select().from(platLicences).where(eq(platLicences.universityId, universityId)).for("update");
    const [openBlock] = await tx
      .select()
      .from(platAlerts)
      .where(and(eq(platAlerts.universityId, universityId), eq(platAlerts.kind, BLOCKED), isNull(platAlerts.resolvedAt)));
    // Only before the licence has ended: an ended one is renewed by a person (Renew now), so a
    // licence that lapsed long ago is never billed for terms nobody agreed.
    const due = !!licence && licence.autoRenew && licence.endDate >= today && daysBetween(today, licence.endDate) <= settings.renewalLeadDays;
    const plan = licence ? planOf.get(licence.plan) : undefined;
    const invoiced = due ? await hasNextTermInvoice(tx, licence, plan?.billingMonths ?? 12) : false;

    if (due && !invoiced && plan && !plan.archivedAt) {
      await renewLicenceTx(tx, actor, licence, plan, settings, today, { automatic: true });
      if (openBlock) await resolveBlock(tx, actor, universityId, openBlock.id);
      return { renewed: 1, blocked: 0 };
    }
    if (due && !invoiced && licence) {
      const name = plan?.name ?? planNameFallback(licence.plan);
      const [u] = await tx.select({ name: universities.name }).from(universities).where(eq(universities.id, universityId));
      const ended = licence.endDate < today;
      const alert = {
        level: ended ? "critical" : "warning",
        title: `${u?.name ?? "This institute"}'s licence can't renew automatically`,
        body: `Plan ${name} is archived; pick a plan to renew. The licence ${ended ? "ended" : "ends"} on ${formatDate(licence.endDate)}.`,
        data: { plan: licence.plan, endDate: licence.endDate },
      };
      if (!openBlock) {
        const [row] = await tx
          .insert(platAlerts)
          .values({ universityId, kind: BLOCKED, ...alert })
          .onConflictDoNothing()
          .returning();
        if (row) await logAction(tx, actor, { universityId, inUniversityLog: true }, "plat.alert.raise", "plat_alert", row.id, { kind: BLOCKED, level: alert.level, title: alert.title, automatic: true });
      } else if (openBlock.body !== alert.body || openBlock.level !== alert.level) {
        await tx.update(platAlerts).set({ ...alert, updatedAt: new Date() }).where(eq(platAlerts.id, openBlock.id));
      }
      return { renewed: 0, blocked: 1 };
    }
    if (openBlock) await resolveBlock(tx, actor, universityId, openBlock.id);
    return { renewed: 0, blocked: 0 };
  });
}

/** An invoice already raised for the term after this licence's (so it must not renew again). */
async function hasNextTermInvoice(tx: Tx, licence: Licence, billingMonths: number) {
  const { startDate } = nextTerm(licence, billingMonths);
  const [inv] = await tx
    .select({ id: platInvoices.id })
    .from(platInvoices)
    .where(and(eq(platInvoices.licenceId, licence.id), eq(platInvoices.periodStart, startDate)))
    .limit(1);
  return !!inv;
}

async function resolveBlock(tx: Tx, actor: Actor, universityId: string, alertId: string) {
  const now = new Date();
  await tx.update(platAlerts).set({ resolvedAt: now, updatedAt: now }).where(eq(platAlerts.id, alertId));
  await logAction(tx, actor, { universityId, inUniversityLog: true }, "plat.alert.resolve", "plat_alert", alertId, { kind: BLOCKED, automatic: true });
}

/** The institute's admins, who get Zinny's payment reminders. */
async function instituteAdmins(tx: Tx, universityId: string, now = new Date()) {
  const rows = await tx
    .selectDistinct({ id: users.id, email: users.email })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(
      and(
        eq(roleAssignments.universityId, universityId),
        eq(roleAssignments.role, "institute_admin"),
        isNull(roleAssignments.revokedAt),
        lte(roleAssignments.startsAt, now),
        or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)),
      ),
    );
  return rows;
}

async function remindersFor(actor: Actor, universityId: string, settings: BillingSettings, today: string) {
  if (!settings.remindersOn) return 0;
  const unpaid = await db()
    .select()
    .from(platInvoices)
    .where(and(eq(platInvoices.universityId, universityId), eq(platInvoices.status, "unpaid")))
    .orderBy(asc(platInvoices.dueDate));
  let sent = 0;
  for (const candidate of unpaid) {
    if (!reminderDue(candidate, today, settings)) continue;
    const email = await db().transaction(async (tx) => {
      // Locked and checked again, so two runs at once send each step only once.
      const [inv] = await tx.select().from(platInvoices).where(eq(platInvoices.id, candidate.id)).for("update");
      const step = inv ? reminderDue(inv, today, settings) : null;
      if (!inv || !step) return null;
      const admins = await instituteAdmins(tx, universityId);
      const message = reminderMessage(inv, step, today);
      await tx.update(platInvoices).set({ reminderStage: step.stage, lastReminderOn: today }).where(eq(platInvoices.id, inv.id));
      await notify(
        tx,
        universityId,
        admins.map((a) => a.id),
        { kind: REMINDER_KIND, title: message.title, body: message.body, data: { invoiceNumber: inv.number, totalPaise: inv.totalPaise, dueDate: inv.dueDate } },
      );
      await logAction(tx, actor, { universityId, inUniversityLog: true }, "plat.invoice.reminder", "plat_invoice", inv.id, {
        number: inv.number,
        step: step.kind,
        ...(step.n && { overdueReminder: step.n }),
        totalPaise: inv.totalPaise,
        dueDate: inv.dueDate,
        recipients: admins.length,
        automatic: true,
      });
      return { to: admins.map((a) => a.email), ...message };
    });
    if (!email) continue;
    sent++;
    if (email.to.length) {
      // After the commit: an email that fails doesn't undo the reminder (it is in the app and the history).
      await sendEmail({
        to: email.to,
        subject: email.title,
        text: `${email.body}\n\nZinny`,
        html: `<p>${escapeHtml(email.body)}</p><p>Zinny</p>`,
        kind: REMINDER_KIND,
        universityId,
      }).catch((e) => console.error(`[billing] reminder email for ${universityId} failed:`, e));
    }
  }
  return sent;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ─────────────────────────── Run now ─────────────────────────── */

/**
 * "Run billing now" (Super Admins): the daily job's billing for every institute, now. The
 * work is done and logged as each institute's automatic billing; the run itself is logged
 * with the Super Admin's name.
 */
export async function runBillingNow(actor: Actor, today = todayIST()): Promise<BillingRun & { institutes: number }> {
  assertPlatform(actor, "platform.finance");
  assertSuperAdmin(actor);
  const [unis, settings, plans] = await Promise.all([
    db().select({ id: universities.id }).from(universities).orderBy(asc(universities.createdAt)),
    readBillingSettings(),
    allPlans(),
  ]);
  const total = { renewed: 0, blocked: 0, reminders: 0, institutes: unis.length };
  for (const u of unis) {
    const r = await runBillingFor(systemActorFor(u.id), today, { settings, plans });
    total.renewed += r.renewed;
    total.blocked += r.blocked;
    total.reminders += r.reminders;
  }
  await db().transaction((tx) => logAction(tx, actor, {}, "plat.billing.run", "plat_billing_settings", null, { ...total, today }));
  return total;
}

/** "Renewed 1 licence, sent 2 reminders." */
export function describeRun(r: BillingRun) {
  const parts = [
    r.renewed ? `renewed ${plural(r.renewed, "licence")}` : "",
    r.reminders ? `sent ${plural(r.reminders, "reminder")}` : "",
    r.blocked ? `${plural(r.blocked, "licence")} can't renew because ${r.blocked === 1 ? "its plan is" : "their plans are"} archived` : "",
  ].filter(Boolean);
  if (!parts.length) return "Billing is up to date. Nothing to renew and no reminders due today.";
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/* ─────────────────────────── Coming up ─────────────────────────── */

export type UpcomingRenewal = {
  universityId: string;
  universityName: string;
  endDate: string;
  /** The day the renewal is invoiced (end date less the lead time), or today when that has passed. */
  invoiceOn: string;
  daysLeft: number;
  planName: string;
  planArchived: boolean;
  autoRenew: boolean;
  /** What the renewal invoice will total, GST included. */
  totalPaise: number;
  discountPaise: number;
};

/** Licences ending within `days`, with what their renewal will be invoiced at. For the Invoices page. */
export async function upcomingRenewals(actor: Actor, days = 60, today = todayIST()): Promise<UpcomingRenewal[]> {
  assertPlatform(actor, "platform.finance");
  const [rows, settings, plans] = await Promise.all([
    db()
      .select({ licence: platLicences, universityName: universities.name, stateCode: universities.stateCode })
      .from(platLicences)
      .innerJoin(universities, eq(universities.id, platLicences.universityId))
      .where(and(eq(universities.status, "active"), lte(platLicences.endDate, addDays(today, days))))
      .orderBy(asc(platLicences.endDate)),
    readBillingSettings(),
    allPlans(),
  ]);
  const planOf = new Map(plans.map((p) => [p.key, p]));
  const seller = zinnySeller();
  return rows
    .filter((r) => r.licence.endDate >= addDays(today, -30))
    .map(({ licence: l, universityName, stateCode }) => {
      const plan = planOf.get(l.plan);
      const price = renewalCharge(l, plan ?? { pricePaise: l.pricePaise }, settings.keepDiscountOnRenewal);
      const charge = price.pricePaise - price.discountPaise > 0 ? chargeFor(price.pricePaise, price.discountPaise, plan?.gstRateBp ?? 1800, stateCode === seller.stateCode) : null;
      const invoiceOn = addDays(l.endDate, -settings.renewalLeadDays);
      return {
        universityId: l.universityId,
        universityName,
        endDate: l.endDate,
        invoiceOn: invoiceOn < today ? today : invoiceOn,
        daysLeft: daysBetween(today, l.endDate),
        planName: plan?.name ?? planNameFallback(l.plan),
        planArchived: !plan || !!plan.archivedAt,
        autoRenew: l.autoRenew,
        totalPaise: charge?.totalPaise ?? 0,
        discountPaise: price.discountPaise,
      };
    });
}

/* ─────────────────────────── Overview ─────────────────────────── */

/** The "Plans and billing" line on the platform home. Each figure is null for someone who can't see it. */
export async function billingOverview(actor: Actor, today = todayIST()) {
  const licences = canPlatform(actor, "platform.licences");
  const finance = canPlatform(actor, "platform.finance");
  if (!licences && !finance) throw new ForbiddenError();
  const [plans, renewing, unpaid] = await Promise.all([
    licences ? allPlans() : null,
    licences
      ? db()
          .select({ id: platLicences.id })
          .from(platLicences)
          .innerJoin(universities, eq(universities.id, platLicences.universityId))
          .where(and(eq(universities.status, "active"), lte(platLicences.endDate, addDays(today, 30)), gt(platLicences.endDate, addDays(today, -1))))
      : null,
    finance ? db().select({ total: platInvoices.totalPaise }).from(platInvoices).where(eq(platInvoices.status, "unpaid")) : null,
  ]);
  return {
    plans: plans ? plans.filter((p) => !p.archivedAt).length : null,
    renewing: renewing ? renewing.length : null,
    unpaidPaise: unpaid ? unpaid.reduce((n, r) => n + r.total, 0) : null,
    unpaidCount: unpaid ? unpaid.length : null,
  };
}


/* ─────────────────────────── Licence-end reminders ─────────────────────────── */

export const LICENCE_END_REMINDER_KIND = "zinny.licence_end_reminder";

/**
 * The licence-end reminder to send today, or null: one at 30, 14, 7 and 1 days before the end
 * date (the same steps as the banners). Only the latest step that has come is sent, so a
 * missed day doesn't send two at once; a step already sent for this end date is never sent again.
 */
export function licenceEndReminderDue(
  lic: { endDate: string; endReminderFor: string | null; endReminderDays: number | null },
  today: string,
): { days: 30 | 14 | 7 | 1; daysLeft: number } | null {
  const daysLeft = daysBetween(today, lic.endDate);
  const level = reminderLevel(daysLeft);
  if (!level || level.ended || level.threshold === 0) return null;
  const sent = lic.endReminderFor === lic.endDate ? lic.endReminderDays : null;
  if (sent !== null && sent <= level.threshold) return null;
  return { days: level.threshold, daysLeft };
}

/** The reminder's headline and text. */
export function licenceEndMessage(lic: { endDate: string; autoRenew: boolean }, daysLeft: number) {
  const when = formatDate(lic.endDate, { year: true });
  const left = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
  if (lic.autoRenew) {
    return {
      title: `Your Zinny licence renews on ${when}`,
      body: `Your licence renews automatically ${left}, on ${when}, and Zinny will send the invoice for the next term. To change your plan or add seats before then, open Settings in Zinny or reply to this email.`,
    };
  }
  return {
    title: `Your Zinny licence ends on ${when}`,
    body: `Your licence ends ${left}, on ${when}, and it isn't set to renew. To keep your institute running without a break, renew before then: open Settings in Zinny or reply to this email.`,
  };
}

/**
 * Emails and notifies the institute's admins as its licence end date comes near. Called by the
 * daily billing job as the institute's system actor. Idempotent: each step is stored on the
 * licence before the email goes, so a second run the same day sends nothing.
 */
export async function licenceEndRemindersFor(actor: Actor, today = todayIST()): Promise<number> {
  const universityId = assertSystemActor(actor);
  const [uni] = await db().select({ status: universities.status }).from(universities).where(eq(universities.id, universityId));
  if (!uni || uni.status !== "active") return 0;
  const email = await db().transaction(async (tx) => {
    const [lic] = await tx.select().from(platLicences).where(eq(platLicences.universityId, universityId)).for("update");
    const due = lic ? licenceEndReminderDue(lic, today) : null;
    if (!lic || !due) return null;
    const admins = await instituteAdmins(tx, universityId);
    const message = licenceEndMessage(lic, due.daysLeft);
    await tx.update(platLicences).set({ endReminderFor: lic.endDate, endReminderDays: due.days }).where(eq(platLicences.id, lic.id));
    await notify(
      tx,
      universityId,
      admins.map((a) => a.id),
      { kind: LICENCE_END_REMINDER_KIND, title: message.title, body: message.body, data: { endDate: lic.endDate, daysLeft: due.daysLeft, autoRenew: lic.autoRenew } },
    );
    await logAction(tx, actor, { universityId, inUniversityLog: true }, "plat.licence.end_reminder", "plat_licence", lic.id, {
      endDate: lic.endDate,
      step: due.days,
      recipients: admins.length,
      automatic: true,
    });
    return { to: admins.map((a) => a.email), ...message };
  });
  if (!email) return 0;
  if (email.to.length) {
    await sendEmail({
      to: email.to,
      subject: email.title,
      text: `${email.body}\n\nZinny`,
      html: `<p>${escapeHtml(email.body)}</p><p>Zinny</p>`,
      kind: LICENCE_END_REMINDER_KIND,
      universityId,
    }).catch((e) => console.error(`[billing] licence reminder email for ${universityId} failed:`, e));
  }
  return 1;
}
