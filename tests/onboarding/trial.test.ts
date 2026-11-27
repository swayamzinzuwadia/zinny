/** The free trial: the freeze job, the frozen redirects, and paying for a plan. */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, universities } from "@/db/schema";
import { systemActorFor } from "@/server/actor";
import { frozenRedirect } from "@/server/context";
import { addDays, todayIn } from "@/server/lib/dates";
import { platInvoices, platLicences } from "@/modules/zinny-team-panel/schema";
import { modules } from "@/server/registry";
import { freezeIfTrialOver, trialInfo } from "@/modules/onboarding/services/trial";
import { choosePlanView, payPlanTestMode, startPlanOrder } from "@/modules/onboarding/services/plans";
import { onbPlanOrders } from "@/modules/onboarding/schema";
import { trialLine } from "@/modules/onboarding/components/trial-banner";
import { grant, makeUser } from "../fixtures";
import { loadActor } from "@/server/actor";
import { trialInstitute, upload } from "./helpers";

afterAll(closeDb);

const statusOf = async (id: string) => (await systemDb().select().from(universities).where(eq(universities.id, id)))[0];
/** A moment `days` after the trial's start, at noon in India. */
const at = (day: string) => new Date(`${day}T12:00:00+05:30`);

describe("the trial", () => {
  it("counts the days left for the admin", async () => {
    const t = await trialInstitute();
    const info = await trialInfo(t.admin);
    expect(info).toMatchObject({ inTrial: true, daysLeft: 3, hasPlan: false, status: "active" });
    expect(trialLine(3, info.trialEndsAt!)).toMatch(/^3 days left in your free trial/);
    expect(trialLine(0, info.trialEndsAt!)).toBe("Your free trial ends today.");
  });

  it("is only shown to people who run the institute", async () => {
    const t = await trialInstitute();
    const s = await makeUser("Trial Student");
    await grant(s.id, "student", { universityId: t.universityId });
    const student = await loadActor(s.id, t.universityId, { session: null });
    await expect(trialInfo(student)).rejects.toThrow();
  });
});

describe("the freeze job", () => {
  it("leaves the institute open until the trial ends", async () => {
    const t = await trialInstitute();
    const tz = (await statusOf(t.universityId)).timezone;
    const before = at(addDays(t.trialEndsAt, -1));
    expect(await freezeIfTrialOver(systemActorFor(t.universityId), before)).toBe("unchanged");
    expect((await statusOf(t.universityId)).status).toBe("active");
    expect(todayIn(tz, before)).toBe(addDays(t.trialEndsAt, -1));
  });

  it("freezes it when the trial ends with no paid plan, logs it, and deletes nothing", async () => {
    const t = await trialInstitute();
    await upload(t.admin, "pan");
    expect(await freezeIfTrialOver(systemActorFor(t.universityId), at(t.trialEndsAt))).toBe("frozen");
    expect((await statusOf(t.universityId)).status).toBe("frozen");
    expect(await freezeIfTrialOver(systemActorFor(t.universityId), at(t.trialEndsAt))).toBe("unchanged");
    const log = await systemDb().select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.universityId, t.universityId));
    expect(log.map((l) => l.action)).toContain("university.freeze");
  });

  it("is registered as an hourly job", () => {
    expect(modules().find((m) => (m.id as string) === "onboarding")?.jobs?.map((j) => j.id)).toContain("onboarding.trial-freeze");
  });

  it("leaves institutes the Zinny team set up alone", async () => {
    const [u] = await systemDb().insert(universities).values({ name: "Set up by Zinny", slug: `onb-team-${Date.now()}`, invoicePrefix: "SZ" }).returning();
    expect(await freezeIfTrialOver(systemActorFor(u.id))).toBe("unchanged");
  });

  it("doesn't freeze an institute that has paid", async () => {
    const t = await trialInstitute();
    await upload(t.admin, "pan");
    await payPlanTestMode(t.admin, "standard");
    expect(await freezeIfTrialOver(systemActorFor(t.universityId), at(addDays(t.trialEndsAt, 1)))).toBe("unchanged");
    expect((await statusOf(t.universityId)).status).toBe("active");
  });
});

describe("where a frozen institute sends people", () => {
  const base = { slug: "sunrise", zinnyTeam: false };
  it("sends admins to choose a plan", () => {
    expect(frozenRedirect({ ...base, route: "/[uni]/admin", canChoosePlan: true })).toBe("/sunrise/admin/choose-plan");
    expect(frozenRedirect({ ...base, route: "/[uni]/learn", canChoosePlan: true })).toBe("/sunrise/admin/choose-plan");
  });
  it("lets admins open choose-plan and its documents", () => {
    expect(frozenRedirect({ ...base, route: "/[uni]/admin/choose-plan", canChoosePlan: true })).toBeNull();
    expect(frozenRedirect({ ...base, route: "/[uni]/admin/choose-plan/documents", canChoosePlan: true })).toBeNull();
  });
  it("sends everyone else to the frozen page", () => {
    expect(frozenRedirect({ ...base, route: "/[uni]/learn", canChoosePlan: false })).toBe("/frozen?uni=sunrise");
    expect(frozenRedirect({ ...base, route: "/[uni]/admin/choose-plan", canChoosePlan: false })).toBe("/frozen?uni=sunrise");
  });
  it("lets the Zinny team in, as with a suspended institute", () => {
    expect(frozenRedirect({ ...base, route: "/[uni]/admin", canChoosePlan: false, zinnyTeam: true })).toBeNull();
  });
});

describe("paying for a plan", () => {
  it("needs the PAN card first", async () => {
    const t = await trialInstitute();
    await expect(startPlanOrder(t.admin, "standard")).rejects.toMatchObject({ code: "pan_required" });
  });

  it("makes the licence and Zinny's invoice, and reactivates a frozen institute", async () => {
    const t = await trialInstitute({ gstApplies: "yes", gstin: "27AAPFS1234K1Z3" });
    await upload(t.admin, "pan");
    await freezeIfTrialOver(systemActorFor(t.universityId), at(t.trialEndsAt));
    expect((await statusOf(t.universityId)).status).toBe("frozen");

    const view = await choosePlanView(t.admin);
    expect(view.plans.length).toBeGreaterThan(0);
    expect(view.panOnFile).toBe(true);
    expect(view.payment).toBe("test");
    const plan = view.plans.find((p) => p.key === "standard")!;

    const order = await payPlanTestMode(t.admin, "standard");
    expect(order).toMatchObject({ status: "paid", totalPaise: plan.totalPaise });
    expect((await statusOf(t.universityId)).status).toBe("active");

    const [lic] = await systemDb().select().from(platLicences).where(eq(platLicences.universityId, t.universityId));
    expect(lic.plan).toBe("standard");
    expect(order.licenceId).toBe(lic.id);
    const invoices = await systemDb().select().from(platInvoices).where(eq(platInvoices.universityId, t.universityId));
    expect(invoices).toHaveLength(1);
    expect(invoices[0].number).toBe(order.invoiceNumber);
    expect(invoices[0].status).toBe("paid");

    const [row] = await systemDb().select().from(onbPlanOrders).where(eq(onbPlanOrders.id, order.id));
    expect(row.gatewayPaymentId).toMatch(/^mock_pay_/);
    const info = await trialInfo(t.admin);
    expect(info).toMatchObject({ hasPlan: true, inTrial: false });
  });

  it("refuses a second plan while one covers today", async () => {
    const t = await trialInstitute();
    await upload(t.admin, "pan");
    await payPlanTestMode(t.admin, "standard");
    await expect(startPlanOrder(t.admin, "standard")).rejects.toMatchObject({ code: "has_plan" });
  });

  it("is only for people who run the institute", async () => {
    const t = await trialInstitute();
    const s = await makeUser("Plan Student");
    await grant(s.id, "student", { universityId: t.universityId });
    const student = await loadActor(s.id, t.universityId, { session: null });
    await expect(startPlanOrder(student, "standard")).rejects.toThrow();
  });
});
