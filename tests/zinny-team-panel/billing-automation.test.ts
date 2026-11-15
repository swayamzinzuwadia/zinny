/**
 * Plans and billing automation: billing settings, automatic renewals at the plan's current
 * price, payment reminders on a schedule, "Run billing now", and the "Plans and billing" menu.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, notifications } from "@/db/schema";
import { systemActorFor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { notifDeliveries } from "@/modules/notifications-delivery/schema";
import { navFor } from "@/modules/zinny-team-panel/lib/access";
import { addDays, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { termEnd } from "@/modules/zinny-team-panel/lib/licence";
import { platAlerts, platBillingSettings, platInvoices, platLicences } from "@/modules/zinny-team-panel/schema";
import { describeRun, reminderDue, reminderSteps, runBillingFor, runBillingNow, upcomingRenewals } from "@/modules/zinny-team-panel/services/automation";
import { createInvoice, getInvoice, invoiceHistory, reviseInvoice } from "@/modules/zinny-team-panel/services/billing";
import { DEFAULT_BILLING_SETTINGS, getBillingSettings, readBillingSettings, saveBillingSettings } from "@/modules/zinny-team-panel/services/billing-settings";
import { renewLicenceNow, saveLicence, setAutoRenew, syncAlertsFor } from "@/modules/zinny-team-panel/services/licences";
import { archivePlan, createPlan, restorePlan, updatePlan, type Plan } from "@/modules/zinny-team-panel/services/plans";
import { makeUniversity, person, uniqueCode } from "../fixtures";
import { team } from "./helpers";

const db = () => systemDb();
const resetSettings = () => db().delete(platBillingSettings);

let sa: Actor, am: Actor, fin: Actor, sup: Actor, qa: Actor;
let planA: Plan, planB: Plan;
const today = todayIST();

beforeAll(async () => {
  await resetSettings();
  [sa, am, fin, sup, qa] = await Promise.all([
    team("Auto Super", "super_admin"),
    team("Auto Manager", "account_manager"),
    team("Auto Finance", "finance_admin"),
    team("Auto Support", "support_agent"),
    team("Auto QA", "content_qa"),
  ]);
  const plan = (name: string, pricePaise: number) =>
    createPlan(sa, { key: `auto-${uniqueCode("p").toLowerCase()}`, name, pricePaise, billingMonths: 12, studentCap: 200, staffCap: 20, modules: ["assessments"] });
  [planA, planB] = [await plan("Auto Annual", 1_00_000_00), await plan("Auto Legacy", 50_000_00)];
});

afterAll(async () => {
  await resetSettings();
  await closeDb();
});

/** A licence on `plan` that ends `daysLeft` days from today, with a discount when given. */
async function licensed(name: string, plan: Plan, daysLeft: number, extra: { discountPaise?: number; autoRenew?: boolean } = {}) {
  const uni = await makeUniversity(name);
  const endDate = addDays(today, daysLeft);
  const saved = await saveLicence(sa, uni.id, {
    plan: plan.key,
    studentCap: 50,
    staffCap: 5,
    modules: ["assessments"],
    startDate: addDays(endDate, -364),
    endDate,
    pricePaise: plan.pricePaise,
    discountPaise: extra.discountPaise ?? 0,
    discountNote: extra.discountPaise ? "Founding institute offer" : null,
    autoRenew: extra.autoRenew,
    invoice: false,
  });
  return { uni, licence: saved };
}

const invoicesOf = (universityId: string) => db().select().from(platInvoices).where(eq(platInvoices.universityId, universityId));
const licenceOf = async (universityId: string) => (await db().select().from(platLicences).where(eq(platLicences.universityId, universityId)))[0];

describe("billing settings", () => {
  it("start at the defaults, and Super Admins and Finance can read and change them", async () => {
    expect(await getBillingSettings(fin)).toMatchObject({ ...DEFAULT_BILLING_SETTINGS, updatedAt: null });
    expect(DEFAULT_BILLING_SETTINGS).toMatchObject({ paymentDays: 15, renewalLeadDays: 15, autoRenewDefault: true, keepDiscountOnRenewal: true, remindDaysBefore: 3, remindEveryDaysAfter: 7, maxOverdueReminders: 3 });
    await saveBillingSettings(fin, { ...DEFAULT_BILLING_SETTINGS, paymentDays: 30 });
    expect((await readBillingSettings()).paymentDays).toBe(30);
    await saveBillingSettings(sa, { ...DEFAULT_BILLING_SETTINGS, paymentDays: 21 });
    const [log] = await db().select().from(auditLog).where(and(eq(auditLog.action, "plat.billing_settings.update"), eq(auditLog.actorUserId, fin.userId)));
    expect(log.data).toMatchObject({ before: { paymentDays: 15 }, after: { paymentDays: 30 } });
  });

  it("are refused to everyone else", async () => {
    for (const a of [am, sup, qa]) {
      await expect(getBillingSettings(a)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(saveBillingSettings(a, DEFAULT_BILLING_SETTINGS)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("check their values", async () => {
    await expect(saveBillingSettings(fin, { ...DEFAULT_BILLING_SETTINGS, renewalLeadDays: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveBillingSettings(fin, { ...DEFAULT_BILLING_SETTINGS, maxOverdueReminders: 11 })).rejects.toBeInstanceOf(ValidationError);
  });

  it("set the due date of a licence's invoice", async () => {
    await saveBillingSettings(fin, { ...DEFAULT_BILLING_SETTINGS, paymentDays: 21 }).catch(() => undefined);
    const uni = await makeUniversity("Terms U");
    const saved = await saveLicence(sa, uni.id, { plan: planA.key, studentCap: 10, staffCap: 2, modules: [], startDate: today, endDate: addDays(today, 364) });
    expect(saved.invoice).toMatchObject({ issueDate: today, dueDate: addDays(today, 21) });
    expect(saved.autoRenew).toBe(true);
    await resetSettings();
  });
});

describe("automatic renewal", () => {
  it("renews once, at the plan's current price, with the discount carried over", async () => {
    const { uni, licence } = await licensed("Renew U", planA, 10, { discountPaise: 10_000_00 });
    // The plan's price goes up after the licence was sold: the licence keeps its price…
    planA = await updatePlan(sa, planA.id, { ...planA, pricePaise: 1_20_000_00 });
    expect((await licenceOf(uni.id)).pricePaise).toBe(1_00_000_00);

    // …until it renews, which uses the new price.
    const r = await runBillingFor(systemActorFor(uni.id), today);
    expect(r).toEqual({ renewed: 1, blocked: 0, reminders: 0 });
    const nextStart = addDays(licence.endDate, 1);
    expect(await licenceOf(uni.id)).toMatchObject({ startDate: nextStart, endDate: termEnd(nextStart, 12), pricePaise: 1_20_000_00, discountPaise: 10_000_00, discountNote: "Founding institute offer", autoRenew: true });
    const invoices = await invoicesOf(uni.id);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ periodStart: nextStart, listPricePaise: 1_20_000_00, discountPaise: 10_000_00, basePaise: 1_10_000_00, issueDate: today, dueDate: addDays(today, 15), createdBy: null });
    const [renewLog] = await db().select().from(auditLog).where(and(eq(auditLog.action, "plat.licence.renew"), eq(auditLog.universityId, uni.id)));
    expect(renewLog.data).toMatchObject({ automatic: true, pricePaise: 1_20_000_00 });
    expect(renewLog.actorUserId).toBeNull();

    // Idempotent: a second run (or the same day's cron after "Run billing now") does nothing.
    expect(await runBillingFor(systemActorFor(uni.id), today)).toEqual({ renewed: 0, blocked: 0, reminders: 0 });
    expect(await invoicesOf(uni.id)).toHaveLength(1);
  });

  it("drops the discount when the settings say so", async () => {
    await saveBillingSettings(fin, { ...DEFAULT_BILLING_SETTINGS, keepDiscountOnRenewal: false });
    const { uni } = await licensed("No Discount U", planA, 5, { discountPaise: 10_000_00 });
    await runBillingFor(systemActorFor(uni.id), today);
    const [inv] = await invoicesOf(uni.id);
    expect(inv).toMatchObject({ listPricePaise: 1_20_000_00, discountPaise: 0 });
    await resetSettings();
  });

  it("waits until the licence is within the lead time", async () => {
    const { uni } = await licensed("Early U", planA, 40);
    expect((await runBillingFor(systemActorFor(uni.id), today)).renewed).toBe(0);
    expect((await runBillingFor(systemActorFor(uni.id), addDays(today, 25))).renewed).toBe(1);
  });

  it("does nothing when auto-renew is off", async () => {
    const { uni } = await licensed("Manual U", planA, 3, { autoRenew: false });
    expect(await runBillingFor(systemActorFor(uni.id), today)).toEqual({ renewed: 0, blocked: 0, reminders: 0 });
    expect(await invoicesOf(uni.id)).toHaveLength(0);
    expect((await licenceOf(uni.id)).endDate).toBe(addDays(today, 3));
  });

  it("raises a warning instead of renewing a licence on an archived plan", async () => {
    const { uni, licence } = await licensed("Archived Plan U", planB, 7);
    await archivePlan(sa, planB.id);
    expect(await runBillingFor(systemActorFor(uni.id), today)).toEqual({ renewed: 0, blocked: 1, reminders: 0 });
    expect(await runBillingFor(systemActorFor(uni.id), today)).toEqual({ renewed: 0, blocked: 1, reminders: 0 });
    expect(await invoicesOf(uni.id)).toHaveLength(0);
    const open = () => db().select().from(platAlerts).where(and(eq(platAlerts.universityId, uni.id), eq(platAlerts.kind, "renewal_blocked"), isNull(platAlerts.resolvedAt)));
    const alerts = await open();
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain("Plan Auto Legacy is archived; pick a plan to renew");
    // The hourly licence check leaves it alone.
    await db().transaction((tx) => syncAlertsFor(tx, sa, uni.id, today));
    expect(await open()).toHaveLength(1);
    // "Renew now" refuses too, with the same reason.
    await expect(renewLicenceNow(sa, uni.id)).rejects.toThrow(/archived; pick a plan/);

    // Restored, it renews and the warning clears.
    await restorePlan(sa, planB.id);
    expect((await runBillingFor(systemActorFor(uni.id), today)).renewed).toBe(1);
    expect(await open()).toHaveLength(0);
    expect((await licenceOf(uni.id)).startDate).toBe(addDays(licence.endDate, 1));
  });

  it("only runs as an institute's system actor", async () => {
    await expect(runBillingFor(sa, today)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("renew now and auto-renew by hand", () => {
  it("need platform.licences", async () => {
    const { uni } = await licensed("By Hand U", planA, 20);
    await expect(setAutoRenew(sup, uni.id, false)).rejects.toThrow();
    await expect(renewLicenceNow(qa, uni.id)).rejects.toThrow();
    expect((await setAutoRenew(fin, uni.id, false)).autoRenew).toBe(false);
    const renewed = await renewLicenceNow(am, uni.id);
    expect(renewed.invoice).toMatchObject({ listPricePaise: 1_20_000_00, createdBy: am.userId });
    expect(renewed.autoRenew).toBe(false);
  });

  it("show in Coming up with the amount the renewal will be invoiced for", async () => {
    const { uni } = await licensed("Coming Up U", planA, 30, { discountPaise: 20_000_00 });
    const row = (await upcomingRenewals(fin, 60)).find((r) => r.universityId === uni.id);
    // ₹1,20,000 less ₹20,000, plus 18% GST.
    expect(row).toMatchObject({ planName: "Auto Annual", autoRenew: true, totalPaise: 1_18_000_00, discountPaise: 20_000_00, invoiceOn: addDays(today, 15) });
    await expect(upcomingRenewals(sup)).rejects.toThrow();
  });
});

describe("payment reminders", () => {
  const s = DEFAULT_BILLING_SETTINGS;

  it("follow the schedule: 3 days before, on the due date, then every 7 days up to 3", () => {
    expect(reminderSteps("2026-12-10", s).map((x) => [x.stage, x.kind, x.on])).toEqual([
      [1, "before", "2026-12-07"],
      [2, "due", "2026-12-10"],
      [3, "overdue", "2026-12-17"],
      [4, "overdue", "2026-12-24"],
      [5, "overdue", "2026-12-31"],
    ]);
    const inv = { issueDate: "2026-11-20", dueDate: "2026-12-10", reminderStage: 0, status: "unpaid" };
    expect(reminderDue(inv, "2026-12-06", s)).toBeNull();
    expect(reminderDue(inv, "2026-12-07", s)?.kind).toBe("before");
    expect(reminderDue({ ...inv, reminderStage: 1 }, "2026-12-09", s)).toBeNull();
    expect(reminderDue({ ...inv, reminderStage: 1 }, "2026-12-10", s)?.kind).toBe("due");
    // Missed steps aren't sent in a pile: only the latest one.
    expect(reminderDue(inv, "2026-12-20", s)).toMatchObject({ stage: 3, kind: "overdue" });
    expect(reminderDue({ ...inv, reminderStage: 5 }, "2027-03-01", s)).toBeNull();
    expect(reminderDue({ ...inv, status: "paid" }, "2026-12-10", s)).toBeNull();
    expect(reminderDue(inv, "2026-12-10", { ...s, remindersOn: false })).toBeNull();
    // Nothing on the day it is issued, and no "due soon" once it is due.
    expect(reminderDue({ ...inv, issueDate: "2026-12-08" }, "2026-12-08", s)).toBeNull();
    expect(reminderDue(inv, "2026-12-12", { ...s, remindOnDueDate: false })).toBeNull();
  });

  it("go to the institute's admins, show in the invoice's history and never repeat", async () => {
    const uni = await makeUniversity("Reminder U");
    const admin = await person("Reminder Admin", "institute_admin", { universityId: uni.id });
    await person("Reminder Student", "student", { universityId: uni.id });
    const inv = await createInvoice(fin, {
      universityId: uni.id,
      periodStart: addDays(today, -10),
      periodEnd: addDays(today, 355),
      description: "Zinny licence",
      listPricePaise: 10_000_00,
      gstRateBp: 1800,
      issueDate: addDays(today, -10),
      dueDate: addDays(today, 3),
    });
    const run = (day: string) => runBillingFor(systemActorFor(uni.id), day);

    expect((await run(today)).reminders).toBe(1);
    expect((await run(today)).reminders).toBe(0);
    expect((await run(addDays(today, 3))).reminders).toBe(1);
    expect((await run(addDays(today, 3))).reminders).toBe(0);
    expect((await run(addDays(today, 10))).reminders).toBe(1);
    expect((await run(addDays(today, 11))).reminders).toBe(0);
    expect((await run(addDays(today, 40))).reminders).toBe(1);
    expect((await run(addDays(today, 60))).reminders).toBe(0);

    const got = await db().select().from(notifications).where(and(eq(notifications.universityId, uni.id), eq(notifications.kind, "zinny.invoice_reminder")));
    expect(got).toHaveLength(4);
    expect(new Set(got.map((n) => n.userId))).toEqual(new Set([admin.user.id]));
    // And by email, through the notifications transport (recorded with the institute's deliveries).
    const emails = await db().select().from(notifDeliveries).where(and(eq(notifDeliveries.universityId, uni.id), eq(notifDeliveries.kind, "zinny.invoice_reminder")));
    expect(emails).toHaveLength(4);
    expect(emails.every((e) => e.recipient === admin.user.email.toLowerCase() && e.status === "sent")).toBe(true);
    expect(got.map((n) => n.title)).toContain(`Zinny invoice ${inv.number} is due in 3 days`);
    expect(got.map((n) => n.title)).toContain(`Zinny invoice ${inv.number} is overdue`);

    const history = await invoiceHistory(fin, inv.id);
    expect(history.filter((e) => e.action === "plat.invoice.reminder")).toHaveLength(4);
    expect(await getInvoice(fin, inv.id, addDays(today, 60))).toMatchObject({ reminderStage: 5, lastReminderOn: addDays(today, 40), status: "unpaid", overdue: true });

    // A new due date starts the schedule again.
    await reviseInvoice(fin, inv.id, {
      description: inv.description,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      listPricePaise: 10_000_00,
      discountPaise: 0,
      issueDate: inv.issueDate,
      dueDate: addDays(today, 70),
    });
    expect((await getInvoice(fin, inv.id)).reminderStage).toBe(0);
    expect((await run(addDays(today, 67))).reminders).toBe(1);
  });
});

describe("run billing now", () => {
  it("is for Super Admins only", async () => {
    for (const a of [fin, am, sup, qa]) await expect(runBillingNow(a)).rejects.toBeInstanceOf(ForbiddenError);
    // A day long past: nothing is due, so the run changes nothing elsewhere in the test database.
    const r = await runBillingNow(sa, "2000-01-01");
    expect(r).toMatchObject({ renewed: 0, reminders: 0 });
    expect(r.institutes).toBeGreaterThan(0);
    expect(describeRun(r)).toBe("Billing is up to date. Nothing to renew and no reminders due today.");
    expect(describeRun({ renewed: 1, reminders: 2, blocked: 0 })).toBe("Renewed 1 licence, sent 2 reminders.");
  });
});

describe("the menu", () => {
  it("shows Plans and billing to licence and finance roles, not to support or content QA", () => {
    const billing = (a: Actor) => navFor(a).find((s) => s.key === "billing");
    expect(billing(sa)?.label).toBe("Plans and billing");
    expect(billing(sa)?.items.map((i) => i.href)).toEqual(["/plans", "/licences", "/billing", "/billing/settings"]);
    expect(billing(fin)?.items.map((i) => i.label)).toEqual(["Plans and prices", "Licences", "Invoices", "Billing settings"]);
    expect(billing(am)?.items.map((i) => i.label)).toEqual(["Plans and prices", "Licences"]);
    expect(billing(sup)).toBeUndefined();
    expect(billing(qa)).toBeUndefined();
    // Invoices are no longer a separate item.
    expect(navFor(sa).flatMap((s) => s.items.map((i) => i.label))).not.toContain("Zinny invoices");
  });
});
