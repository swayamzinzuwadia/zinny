/**
 * Billing settings (/platform/billing/settings): how Zinny invoices institutes. Payment
 * terms, how early a licence renews, whether new licences renew by themselves, whether a
 * discount carries over to the renewal, and the payment reminder schedule.
 *
 * One row in plat_billing_settings, Zinny's own table. A Super Admin or anyone with
 * platform.finance can read and change it; every change is logged with the values before.
 * Until someone saves, the defaults below apply (and nothing is written).
 */
import { eq } from "drizzle-orm";
import type { Conn } from "@/db/client";
import { assertPlatform, canPlatform, type Actor } from "@/server/core";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { platBillingSettings } from "../schema";
import { isSuperAdmin } from "../lib/access";
import { DEFAULT_PAYMENT_DAYS } from "../lib/constants";
import { db, logAction } from "./shared";

export type BillingSettings = {
  paymentDays: number;
  renewalLeadDays: number;
  autoRenewDefault: boolean;
  keepDiscountOnRenewal: boolean;
  remindersOn: boolean;
  remindDaysBefore: number;
  remindOnDueDate: boolean;
  remindEveryDaysAfter: number;
  maxOverdueReminders: number;
};

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  paymentDays: DEFAULT_PAYMENT_DAYS,
  renewalLeadDays: 15,
  autoRenewDefault: true,
  keepDiscountOnRenewal: true,
  remindersOn: true,
  remindDaysBefore: 3,
  remindOnDueDate: true,
  remindEveryDaysAfter: 7,
  maxOverdueReminders: 3,
};

const ROW_ID = "zinny";
const FIELDS = Object.keys(DEFAULT_BILLING_SETTINGS) as (keyof BillingSettings)[];

const pick = (row: BillingSettings): BillingSettings => Object.fromEntries(FIELDS.map((k) => [k, row[k]])) as BillingSettings;

/** The settings in force. No permission check: for services that have already checked theirs, and the job. */
export async function readBillingSettings(conn: Conn = db()): Promise<BillingSettings & { updatedAt: Date | null }> {
  const [row] = await conn.select().from(platBillingSettings).where(eq(platBillingSettings.id, ROW_ID));
  return row ? { ...pick(row), updatedAt: row.updatedAt } : { ...DEFAULT_BILLING_SETTINGS, updatedAt: null };
}

/** Super Admins and Finance can open and change the billing settings. */
export function canManageBillingSettings(actor: Actor): boolean {
  return isSuperAdmin(actor) || canPlatform(actor, "platform.finance");
}

function assertManageBillingSettings(actor: Actor) {
  if (!canManageBillingSettings(actor)) throw new ForbiddenError("Only a Super Admin or Finance can change the billing settings.");
}

export async function getBillingSettings(actor: Actor) {
  assertManageBillingSettings(actor);
  return readBillingSettings();
}

/** What the licence form needs from the settings: payment terms, renewal lead time and defaults. */
export async function licenceFormSettings(actor: Actor) {
  assertPlatform(actor, "platform.licences");
  const s = await readBillingSettings();
  return { paymentDays: s.paymentDays, renewalLeadDays: s.renewalLeadDays, autoRenewDefault: s.autoRenewDefault, keepDiscountOnRenewal: s.keepDiscountOnRenewal };
}

function whole(v: number, min: number, max: number, message: string) {
  if (!Number.isInteger(v) || v < min || v > max) throw new ValidationError(message);
  return v;
}

/** Checks the settings. Error messages say how to fix the field. */
export function validateBillingSettings(input: BillingSettings): BillingSettings {
  return {
    paymentDays: whole(input.paymentDays, 0, 180, "Payment terms are a whole number of days, from 0 to 180."),
    renewalLeadDays: whole(input.renewalLeadDays, 1, 90, "Renew between 1 and 90 days before a licence ends."),
    autoRenewDefault: !!input.autoRenewDefault,
    keepDiscountOnRenewal: !!input.keepDiscountOnRenewal,
    remindersOn: !!input.remindersOn,
    remindDaysBefore: whole(input.remindDaysBefore, 0, 30, "Remind between 0 and 30 days before the due date. Use 0 for no early reminder."),
    remindOnDueDate: !!input.remindOnDueDate,
    remindEveryDaysAfter: whole(input.remindEveryDaysAfter, 1, 60, "After the due date, remind every 1 to 60 days."),
    maxOverdueReminders: whole(input.maxOverdueReminders, 0, 10, "Send between 0 and 10 reminders after the due date."),
  };
}

/** Saves the settings and logs what changed. */
export async function saveBillingSettings(actor: Actor, input: BillingSettings) {
  assertManageBillingSettings(actor);
  const clean = validateBillingSettings(input);
  return db().transaction(async (tx) => {
    const before = await readBillingSettings(tx);
    const changedFrom: Record<string, unknown> = {};
    const changedTo: Record<string, unknown> = {};
    for (const k of FIELDS) {
      if (before[k] !== clean[k]) {
        changedFrom[k] = before[k];
        changedTo[k] = clean[k];
      }
    }
    if (Object.keys(changedTo).length === 0) throw new ValidationError("Nothing is different. Change a setting, then save.");
    const values = { ...clean, updatedAt: new Date(), updatedBy: actor.userId || null };
    await tx
      .insert(platBillingSettings)
      .values({ id: ROW_ID, ...values })
      .onConflictDoUpdate({ target: platBillingSettings.id, set: values });
    await logAction(tx, actor, {}, "plat.billing_settings.update", "plat_billing_settings", null, { before: changedFrom, after: changedTo });
    return clean;
  });
}
