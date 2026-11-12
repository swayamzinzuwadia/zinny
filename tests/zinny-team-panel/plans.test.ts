/** Plans are data: the defaults, who can change them, archive rules, and what a price change touches. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog } from "@/db/schema";
import type { Actor } from "@/server/authz/engine";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { platInvoices, platLicences, platPlans } from "@/modules/zinny-team-panel/schema";
import { licenceFor, listLicences, saveLicence } from "@/modules/zinny-team-panel/services/licences";
import {
  archivePlan,
  createPlan,
  DEFAULT_PLANS,
  ensureDefaultPlans,
  getPlan,
  listPlans,
  planKeyFrom,
  planOptions,
  restorePlan,
  updatePlan,
  type PlanInput,
} from "@/modules/zinny-team-panel/services/plans";
import { listUniversities } from "@/modules/zinny-team-panel/services/universities";
import { makeUniversity, uniqueCode } from "../fixtures";
import { licence, team } from "./helpers";

afterAll(closeDb);

let sa: Actor, am: Actor, fin: Actor, sup: Actor;
beforeAll(async () => {
  [sa, am, fin, sup] = await Promise.all([team("Plan Super", "super_admin"), team("Plan Manager", "account_manager"), team("Plan Finance", "finance_admin"), team("Plan Support", "support_agent")]);
});

const draft = (over: Partial<PlanInput> = {}): PlanInput => ({
  name: `Campus ${uniqueCode("P")}`,
  description: "For mid-sized colleges.",
  pricePaise: 3_60_000_00,
  billingMonths: 12,
  studentCap: 400,
  staffCap: 30,
  modules: ["assessments", "live-classes"],
  ...over,
});

describe("default plans", () => {
  it("Pilot, Standard and Enterprise appear the first time an empty table is read, without a seed", async () => {
    await systemDb().delete(platPlans);
    expect(await systemDb().select().from(platPlans)).toHaveLength(0);

    const plans = await listPlans(sa);
    expect(plans.map((p) => p.key)).toEqual(["pilot", "standard", "enterprise"]);
    expect(plans.map((p) => p.name)).toEqual(["Pilot", "Standard", "Enterprise"]);
    // The caps and terms the hard-coded list used to have.
    expect(plans.map((p) => [p.studentCap, p.staffCap, p.billingMonths])).toEqual([
      [100, 10, 3],
      [1000, 60, 12],
      [10000, 500, 12],
    ]);
    expect(plans.every((p) => p.pricePaise > 0 && p.gstRateBp === 1800 && !p.archivedAt)).toBe(true);
    expect(DEFAULT_PLANS.map((p) => p.key)).toEqual(["pilot", "standard", "enterprise"]);
  });

  it("are only added to an empty table: running again, or with a custom plan there, adds nothing", async () => {
    await ensureDefaultPlans();
    await ensureDefaultPlans();
    expect((await systemDb().select().from(platPlans)).filter((p) => p.key === "pilot")).toHaveLength(1);

    await systemDb().delete(platPlans);
    await systemDb().insert(platPlans).values({ key: "only-one", name: "Only one", pricePaise: 100_00, billingMonths: 1, studentCap: 5, staffCap: 2 });
    await ensureDefaultPlans();
    expect((await systemDb().select().from(platPlans)).map((p) => p.key)).toEqual(["only-one"]);

    // Put the defaults back for the tests that follow.
    await systemDb().delete(platPlans);
    await ensureDefaultPlans();
  });

  it("a licence form can use them straight away", async () => {
    const U = await makeUniversity("Default Plan U");
    const saved = await saveLicence(am, U.id, licence({ plan: "pilot", invoice: false }));
    expect(saved.plan).toBe("pilot");
    expect(saved.pricePaise).toBe(45_000_00);
  });
});

describe("who can see and change plans", () => {
  it("anyone with Licences can see them; others can't", async () => {
    for (const a of [sa, am, fin]) expect((await listPlans(a)).length).toBeGreaterThanOrEqual(3);
    await expect(listPlans(sup)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(planOptions(sup)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only a Super Admin creates, edits, archives and restores", async () => {
    const plan = await createPlan(sa, draft());
    for (const a of [am, fin, sup]) {
      await expect(createPlan(a, draft())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updatePlan(a, plan.id, draft())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(archivePlan(a, plan.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(restorePlan(a, plan.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await getPlan(am, plan.id)).archivedAt).toBeNull();
  });
});

describe("creating and editing a plan", () => {
  it("makes the key from the name, keeps modules in catalogue order and logs it", async () => {
    const name = `Campus Plus ${uniqueCode("K")}`;
    const plan = await createPlan(sa, draft({ name, modules: ["live-classes", "assessments"], sortOrder: 15 }));
    expect(plan.key).toBe(planKeyFrom(name));
    expect(plan.key).toMatch(/^campus-plus-k[a-z0-9]+$/);
    expect(plan.modules).toEqual(["live-classes", "assessments"]);
    expect(plan).toMatchObject({ pricePaise: 3_60_000_00, billingMonths: 12, studentCap: 400, staffCap: 30, gstRateBp: 1800, sortOrder: 15, updatedBy: sa.userId });

    const [log] = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "plat.plan.create"), eq(auditLog.entityId, plan.id)));
    expect(log).toMatchObject({ universityId: null, actorUserId: sa.userId, entity: "plat_plan" });
    expect(log.data).toMatchObject({ key: plan.key, pricePaise: 3_60_000_00 });
  });

  it("refuses a key that is taken, a badly shaped key and values that make no sense", async () => {
    const key = `dup-${uniqueCode("x").toLowerCase()}`;
    await createPlan(sa, draft({ key }));
    await expect(createPlan(sa, draft({ key }))).rejects.toBeInstanceOf(ConflictError);
    await expect(createPlan(sa, draft({ key: "Not A Key!" }))).rejects.toThrow(/key can use/);
    await expect(createPlan(sa, draft({ name: "x" }))).rejects.toThrow(/name/);
    await expect(createPlan(sa, draft({ pricePaise: -1 }))).rejects.toThrow(/price/);
    await expect(createPlan(sa, draft({ pricePaise: Number.NaN }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createPlan(sa, draft({ billingMonths: 0 }))).rejects.toThrow(/months/);
    await expect(createPlan(sa, draft({ studentCap: 0 }))).rejects.toThrow(/Student cap/);
    await expect(createPlan(sa, draft({ modules: ["teleport"] }))).rejects.toThrow(/Unknown module/);
    await expect(createPlan(sa, draft({ gstRateBp: 1234 }))).rejects.toThrow(/GST/);
    await expect(updatePlan(sa, "not-an-id", draft())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a free plan (price 0) is allowed", async () => {
    const plan = await createPlan(sa, draft({ pricePaise: 0 }));
    expect(plan.pricePaise).toBe(0);
  });

  it("an edit never changes the key, and logs the values before and after", async () => {
    const plan = await createPlan(sa, draft({ key: `fixed-${uniqueCode("k").toLowerCase()}` }));
    const after = await updatePlan(sa, plan.id, draft({ key: "something-else", name: "Renamed plan", pricePaise: 4_00_000_00, studentCap: 450 }));
    expect(after.key).toBe(plan.key);
    expect(after).toMatchObject({ name: "Renamed plan", pricePaise: 4_00_000_00, studentCap: 450 });

    const [log] = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "plat.plan.update"), eq(auditLog.entityId, plan.id)));
    expect(log.data).toMatchObject({ pricePaise: 4_00_000_00, before: { pricePaise: 3_60_000_00, studentCap: 400 } });
  });

  it("a new price affects future licences and invoices only", async () => {
    const plan = await createPlan(sa, draft({ pricePaise: 2_00_000_00 }));
    const first = await makeUniversity("Before Price Change");
    const saved = await saveLicence(am, first.id, licence({ plan: plan.key }));
    expect(saved.pricePaise).toBe(2_00_000_00);
    expect(saved.invoice!.basePaise).toBe(2_00_000_00);

    await updatePlan(sa, plan.id, draft({ name: plan.name, pricePaise: 2_50_000_00 }));

    // The licence and the invoice already made keep the old price.
    const [lic] = await systemDb().select().from(platLicences).where(eq(platLicences.universityId, first.id));
    expect(lic.pricePaise).toBe(2_00_000_00);
    const [inv] = await systemDb().select().from(platInvoices).where(eq(platInvoices.id, saved.invoice!.id));
    expect(inv).toMatchObject({ basePaise: 2_00_000_00, totalPaise: 2_36_000_00 });
    // A change that isn't billed (a cap) leaves the price alone.
    const edited = await saveLicence(am, first.id, licence({ plan: plan.key, studentCap: 120 }));
    expect(edited.pricePaise).toBe(2_00_000_00);
    expect(edited.invoice).toBeNull();

    // The next institute, and this one's renewal, pay the new price.
    const second = await makeUniversity("After Price Change");
    expect((await saveLicence(am, second.id, licence({ plan: plan.key }))).invoice!.basePaise).toBe(2_50_000_00);
    const renewed = await saveLicence(am, first.id, licence({ plan: plan.key, studentCap: 120, startDate: "2027-04-01", endDate: "2028-03-31" }));
    expect(renewed.pricePaise).toBe(2_50_000_00);
    expect(renewed.invoice!.basePaise).toBe(2_50_000_00);
  });
});

describe("archiving", () => {
  it("an archived plan can't be chosen for a new licence, stays on existing ones, and can be restored", async () => {
    const plan = await createPlan(sa, draft());
    const onIt = await makeUniversity("On Archived Plan");
    await saveLicence(am, onIt.id, licence({ plan: plan.key, invoice: false }));

    const archived = await archivePlan(sa, plan.id);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    await expect(archivePlan(sa, plan.id)).rejects.toBeInstanceOf(ConflictError);

    // Not offered, and refused, for a new licence and for moving another institute onto it.
    expect((await planOptions(am)).map((p) => p.key)).not.toContain(plan.key);
    const fresh = await makeUniversity("Wants Archived Plan");
    await expect(saveLicence(am, fresh.id, licence({ plan: plan.key }))).rejects.toThrow(/archived/);
    const other = await makeUniversity("Moves To Archived Plan");
    await saveLicence(am, other.id, licence({ plan: "standard", invoice: false }));
    await expect(saveLicence(am, other.id, licence({ plan: plan.key }))).rejects.toThrow(/archived/);

    // The institute already on it keeps it: it is offered on its form, edits and renewals save.
    expect((await licenceFor(am, onIt.id)).plans.map((p) => p.key)).toContain(plan.key);
    expect((await planOptions(am, { keep: plan.key })).find((p) => p.key === plan.key)).toMatchObject({ archived: true });
    expect((await saveLicence(am, onIt.id, licence({ plan: plan.key, studentCap: 77 }))).studentCap).toBe(77);
    expect((await saveLicence(am, onIt.id, licence({ plan: plan.key, studentCap: 77, startDate: "2027-04-01", endDate: "2028-03-31", invoice: false }))).plan).toBe(plan.key);

    await restorePlan(sa, plan.id);
    await expect(restorePlan(sa, plan.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await saveLicence(am, fresh.id, licence({ plan: plan.key, invoice: false }))).plan).toBe(plan.key);

    const actions = (await systemDb().select().from(auditLog).where(eq(auditLog.entityId, plan.id))).map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["plat.plan.create", "plat.plan.archive", "plat.plan.restore"]));
  });
});

describe("plans across the panel", () => {
  it("counts the institutes on each plan and shows a licence's plan by its name", async () => {
    const plan = await createPlan(sa, draft({ name: `Counted ${uniqueCode("C")}` }));
    const a = await makeUniversity("Counted A");
    const b = await makeUniversity("Counted B");
    await saveLicence(am, a.id, licence({ plan: plan.key, invoice: false }));
    await saveLicence(am, b.id, licence({ plan: plan.key, invoice: false }));

    expect((await listPlans(am)).find((p) => p.id === plan.id)!.institutes).toBe(2);
    expect((await getPlan(am, plan.id)).institutes).toBe(2);
    expect((await listLicences(am)).find((r) => r.universityId === a.id)!.planName).toBe(plan.name);
    expect((await listUniversities(sa)).find((u) => u.id === a.id)).toMatchObject({ plan: plan.key, planName: plan.name });
    // Archived plans go last in the list.
    await archivePlan(sa, plan.id);
    expect((await listPlans(am)).at(-1)!.archivedAt).toBeTruthy();
  });

  it("a licence can't be saved on a plan that doesn't exist", async () => {
    const U = await makeUniversity("No Such Plan");
    await expect(saveLicence(am, U.id, licence({ plan: "gold" }))).rejects.toThrow(/Pick a plan/);
    await expect(saveLicence(am, U.id, licence({ plan: "" }))).rejects.toThrow(/Pick a plan/);
  });
});
