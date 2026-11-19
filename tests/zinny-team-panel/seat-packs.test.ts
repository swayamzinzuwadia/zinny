/**
 * Seat packs: the pro-rating sums, packs moving the caps, the invoice and its GST,
 * platform.seat_pricing (allow and deny), renewal at the then-current price, the
 * institute buying only for itself, and plat_seat_packs' tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, customRoles, roleAssignments, universities } from "@/db/schema";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { canPlatform } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { chargeFor } from "@/modules/zinny-team-panel/lib/charge";
import { zinnySeller } from "@/modules/zinny-team-panel/lib/constants";
import { daysLeftIn, monthsInTerm, packPricingFor, quotePacks, renewalPackAmount, roundToRupee } from "@/modules/zinny-team-panel/lib/seat-packs";
import { platInvoices, platLicences, platSeatPacks } from "@/modules/zinny-team-panel/schema";
import { DEFAULT_SEAT_PACK_SETTINGS, readSeatPackSettings, saveSeatPackSettings } from "@/modules/zinny-team-panel/services/billing-settings";
import { renewLicenceNow, saveLicence } from "@/modules/zinny-team-panel/services/licences";
import { createPlan, ensureDefaultPlans, savePlanPacks } from "@/modules/zinny-team-panel/services/plans";
import { addSeatPacks, buySeatPacks, instituteSeats, payZinnyInvoice, removeSeatPacks, seatPacksFor, setUserCaps } from "@/modules/zinny-team-panel/services/seat-packs";
import { expectTenantIsolated } from "../helpers/isolation";
import { grant, makeUniversity, makeUser, person, uniqueCode } from "../fixtures";
import { licence, team } from "./helpers";

afterAll(closeDb);

const TERM = { startDate: "2026-04-01", endDate: "2027-03-31" };
const STUDENT = { size: 25, yearPricePaise: 2_500_00 };

let sa: Actor, am: Actor, fin: Actor, custom: Actor, customNo: Actor;
beforeAll(async () => {
  [sa, am, fin] = await Promise.all([team("Seats Super", "super_admin"), team("Seats Manager", "account_manager"), team("Seats Finance", "finance_admin")]);
  await ensureDefaultPlans();
  // Custom Zinny team roles: one given "Edit seat packs and user caps", one not.
  const role = async (name: string, actions: string[]) => {
    const [r] = await systemDb().insert(customRoles).values({ universityId: null, kind: "custom_platform", name: `${name} ${uniqueCode("R")}`, actions }).returning();
    const u = await makeUser(name);
    await systemDb().insert(roleAssignments).values({ userId: u.id, role: "custom_platform", customRoleId: r.id, scopeType: "platform" });
    return loadActor(u.id, null);
  };
  custom = await role("Seats Pricing Lead", ["platform.licences", "platform.seat_pricing"]);
  customNo = await role("Seats Licence Clerk", ["platform.licences"]);
});

/** A university with a Standard licence for TERM, and its admin. */
async function institute(name: string, opts: { stateCode?: string } = {}) {
  const uni = await makeUniversity(name);
  if (opts.stateCode) await systemDb().update(universities).set({ stateCode: opts.stateCode }).where(eq(universities.id, uni.id));
  await saveLicence(sa, uni.id, licence({ ...TERM, studentCap: 100, staffCap: 10, invoice: false }));
  const admin = await (await person(`${name} Admin`, "institute_admin", { universityId: uni.id })).actor();
  return { uni, admin };
}

const licenceOf = async (universityId: string) => (await systemDb().select().from(platLicences).where(eq(platLicences.universityId, universityId)))[0];
/** The parts of a charge an invoice row stores (it keeps GST as its CGST, SGST and IGST). */
const stored = (c: ReturnType<typeof chargeFor>) => ({ listPricePaise: c.listPricePaise, discountPaise: c.discountPaise, basePaise: c.basePaise, cgstPaise: c.cgstPaise, sgstPaise: c.sgstPaise, igstPaise: c.igstPaise, totalPaise: c.totalPaise });
const invoice = async (id: string) => (await systemDb().select().from(platInvoices).where(eq(platInvoices.id, id)))[0];

describe("the pro-rating sums", () => {
  it("charges the year price for the days left, rounded once to the rupee", () => {
    // 1 Oct to 31 Mar is 182 of 365 days: 2 × ₹2,500 × 182 ÷ 365 = ₹2,493.15, so ₹2,493.
    const q = quotePacks({ packs: 2, terms: STUDENT, ...TERM, today: "2026-10-01" });
    expect(q).toMatchObject({ seats: 50, termMonths: 12, termDays: 365, daysLeft: 182, amountPaise: 2_493_00, periodStart: "2026-10-01", periodEnd: "2027-03-31" });
    // Bought before the term starts: the whole term.
    expect(quotePacks({ packs: 2, terms: STUDENT, ...TERM, today: "2026-03-15" })).toMatchObject({ daysLeft: 365, amountPaise: 5_000_00, periodStart: "2026-04-01" });
    // On the last day: one day, ₹13.70 rounds to ₹14.
    expect(quotePacks({ packs: 2, terms: STUDENT, ...TERM, today: "2027-03-31" })).toMatchObject({ daysLeft: 1, amountPaise: 14_00 });
    // After the end: nothing.
    expect(daysLeftIn("2027-04-01", TERM.startDate, TERM.endDate)).toBe(0);
  });

  it("charges a term shorter than a year its share of the year price", () => {
    expect(monthsInTerm("2026-04-01", "2026-06-30")).toBe(3);
    expect(quotePacks({ packs: 1, terms: STUDENT, startDate: "2026-04-01", endDate: "2026-06-30", today: "2026-04-01" })).toMatchObject({ termPricePaise: 625_00, amountPaise: 625_00 });
  });

  it("rounds halves up and keeps every amount in whole rupees", () => {
    expect(roundToRupee(12_350)).toBe(12_400);
    expect(roundToRupee(12_349)).toBe(12_300);
    for (const today of ["2026-04-02", "2026-07-19", "2026-12-31", "2027-02-28"]) {
      expect(quotePacks({ packs: 3, terms: STUDENT, ...TERM, today }).amountPaise % 100).toBe(0);
    }
  });

  it("renews packs at today's price, by their people when the pack size has changed", () => {
    expect(renewalPackAmount([{ packs: 2, seatsPerPack: 25 }], { size: 25, yearPricePaise: 3_000_00 }, TERM.startDate, TERM.endDate)).toMatchObject({ packs: 2, seats: 50, amountPaise: 6_000_00 });
    expect(renewalPackAmount([{ packs: 2, seatsPerPack: 25 }], { size: 30, yearPricePaise: 3_000_00 }, TERM.startDate, TERM.endDate)).toMatchObject({ seats: 50, amountPaise: 5_000_00 });
  });

  it("takes a plan's own pack terms over the defaults, field by field", () => {
    const p = packPricingFor(DEFAULT_SEAT_PACK_SETTINGS, { studentPackSize: 50, studentPackPricePaise: null, staffPackSize: null, staffPackPricePaise: null });
    expect(p.student).toEqual({ size: 50, yearPricePaise: 2_500_00, fromPlan: true });
    expect(p.staff).toEqual({ size: 5, yearPricePaise: 3_000_00, fromPlan: false });
  });
});

describe("packs on a licence", () => {
  it("raise and lower the cap, invoice the days left with GST, and are logged", async () => {
    const { uni } = await institute("Packs Cap U", { stateCode: zinnySeller().stateCode === "29" ? "27" : "29" });
    const pricing = packPricingFor(await readSeatPackSettings(), null);
    const added = await addSeatPacks(am, uni.id, { kind: "student", packs: 2 }, "2026-10-01");
    expect(added.capAfter).toBe(100 + 2 * pricing.student.size);
    expect((await licenceOf(uni.id)).studentCap).toBe(100 + 2 * pricing.student.size);

    const amount = quotePacks({ packs: 2, terms: pricing.student, ...TERM, today: "2026-10-01" }).amountPaise;
    const inv = await invoice(added.invoice!.id);
    // A university in another state than Zinny: IGST at the plan's 18%.
    const sum = stored(chargeFor(amount, 0, 1800, false));
    expect(inv).toMatchObject({ ...sum, gstRateBp: 1800, status: "unpaid", periodStart: "2026-10-01", periodEnd: "2027-03-31", issueDate: "2026-10-01" });
    expect(inv.igstPaise).toBeGreaterThan(0);
    expect(inv.description).toContain("2 student packs");
    expect(added.pack).toMatchObject({ packsBought: 2, packs: 2, chargedPaise: amount, source: "zinny", invoiceId: inv.id });

    // Staff packs move the staff cap only.
    await addSeatPacks(am, uni.id, { kind: "staff", packs: 1, invoice: false, note: "Free staff pack agreed at signing" }, "2026-10-01");
    expect(await licenceOf(uni.id)).toMatchObject({ studentCap: 100 + 2 * pricing.student.size, staffCap: 10 + pricing.staff.size });

    // Removing one student pack takes its seats off; the invoice stays.
    await removeSeatPacks(am, uni.id, { kind: "student", packs: 1, note: "Second batch cancelled" }, "2026-11-01");
    expect((await licenceOf(uni.id)).studentCap).toBe(100 + pricing.student.size);
    expect((await invoice(inv.id)).status).toBe("unpaid");
    await expect(removeSeatPacks(am, uni.id, { kind: "student", packs: 5, note: "Too many" })).rejects.toBeInstanceOf(ValidationError);

    const view = await seatPacksFor(am, uni.id, "2026-11-01");
    expect(view.held).toEqual({ student: { packs: 1, seats: pricing.student.size }, staff: { packs: 1, seats: pricing.staff.size } });
    expect(view.history.map((h) => h.action).sort()).toEqual(["plat.seats.add", "plat.seats.add", "plat.seats.remove"]);
    // In the institute's own log too.
    const logged = await systemDb().select().from(auditLog).where(and(eq(auditLog.universityId, uni.id), eq(auditLog.action, "plat.seats.add")));
    expect(logged).toHaveLength(2);
  });

  it("splits GST into CGST and SGST for an institute in Zinny's state", async () => {
    const { uni } = await institute("Packs Local U", { stateCode: zinnySeller().stateCode });
    const added = await addSeatPacks(am, uni.id, { kind: "student", packs: 1 }, "2026-04-01");
    const inv = await invoice(added.invoice!.id);
    expect(inv.igstPaise).toBe(0);
    const sum = stored(chargeFor(inv.basePaise, 0, 1800, true));
    expect(inv).toMatchObject(sum);
    expect(inv.cgstPaise).toBeGreaterThan(0);
  });

  it("can't be added after the licence has ended", async () => {
    const { uni } = await institute("Packs Ended U");
    await expect(addSeatPacks(am, uni.id, { kind: "student", packs: 1 }, "2027-04-02")).rejects.toThrow(/ended/);
  });

  it("carry over on renewal at the price then", async () => {
    const plan = await createPlan(sa, { name: `Packs Plan ${uniqueCode("P")}`, description: "", pricePaise: 1_00_000_00, billingMonths: 12, studentCap: 100, staffCap: 10, modules: ["assessments"] });
    const uni = await makeUniversity("Packs Renew U");
    await saveLicence(sa, uni.id, licence({ plan: plan.key, ...TERM, studentCap: 100, staffCap: 10, invoice: false }));
    await savePlanPacks(sa, plan.id, { studentPackSize: 25, studentPackPricePaise: 2_000_00, staffPackSize: null, staffPackPricePaise: null });
    await addSeatPacks(am, uni.id, { kind: "student", packs: 2 }, "2026-04-01");
    // The price goes up before the renewal.
    await savePlanPacks(sa, plan.id, { studentPackSize: 25, studentPackPricePaise: 3_000_00, staffPackSize: null, staffPackPricePaise: null });
    const renewed = await renewLicenceNow(am, uni.id, "2027-03-20");
    expect(renewed).toMatchObject({ startDate: "2027-04-01", endDate: "2028-03-31", studentCap: 150 });
    expect(renewed.packInvoices).toHaveLength(1);
    expect(renewed.packInvoices![0]).toMatchObject({ basePaise: 6_000_00, periodStart: "2027-04-01", periodEnd: "2028-03-31" });
  });
});

describe("platform.seat_pricing", () => {
  it("Super Admins and custom roles given it can edit pack prices and caps", async () => {
    expect(canPlatform(sa, "platform.seat_pricing")).toBe(true);
    expect(canPlatform(custom, "platform.seat_pricing")).toBe(true);
    const plan = await createPlan(sa, { name: `Packs Price ${uniqueCode("P")}`, description: "", pricePaise: 1_00_000_00, billingMonths: 12, studentCap: 100, staffCap: 10, modules: ["assessments"] });
    expect(await savePlanPacks(custom, plan.id, { studentPackSize: 30, studentPackPricePaise: 2_800_00, staffPackSize: null, staffPackPricePaise: null })).toMatchObject({ studentPackSize: 30 });

    const { uni } = await institute("Packs Caps U");
    const set = await setUserCaps(custom, uni.id, { studentCap: 140, staffCap: 12, note: "Agreed on the renewal call" }, "2026-06-01");
    expect(set).toMatchObject({ studentCap: 140, staffCap: 12, invoice: null });
    // With a charge: invoiced for the rest of the term.
    const charged = await setUserCaps(sa, uni.id, { studentCap: 160, staffCap: 12, note: "20 more students", chargePaise: 1_500_00 }, "2026-06-01");
    expect(charged.invoice).toMatchObject({ basePaise: 1_500_00, periodStart: "2026-06-01", periodEnd: "2027-03-31" });
    // A cap typed on the licence form, too.
    expect((await saveLicence(custom, uni.id, licence({ ...TERM, studentCap: 170, staffCap: 12, invoice: false }))).studentCap).toBe(170);

    const { studentPackSize, studentPackPricePaise, staffPackSize, staffPackPricePaise } = await readSeatPackSettings();
    const current = { studentPackSize, studentPackPricePaise, staffPackSize, staffPackPricePaise };
    try {
      await saveSeatPackSettings(sa, { ...current, staffPackPricePaise: current.staffPackPricePaise + 100_00 });
      expect((await readSeatPackSettings()).staffPackPricePaise).toBe(current.staffPackPricePaise + 100_00);
    } finally {
      await saveSeatPackSettings(sa, current);
    }
  });

  it("everyone else is refused, even with Manage licences", async () => {
    for (const a of [am, fin, customNo]) expect(canPlatform(a, "platform.seat_pricing")).toBe(false);
    const plan = await createPlan(sa, { name: `Packs Deny ${uniqueCode("P")}`, description: "", pricePaise: 1_00_000_00, billingMonths: 12, studentCap: 100, staffCap: 10, modules: ["assessments"] });
    const { uni } = await institute("Packs Deny U");
    const current = await readSeatPackSettings();
    for (const a of [am, fin, customNo]) {
      await expect(saveSeatPackSettings(a, { ...current, studentPackSize: 30 })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(savePlanPacks(a, plan.id, { studentPackSize: 30, studentPackPricePaise: null, staffPackSize: null, staffPackPricePaise: null })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setUserCaps(a, uni.id, { studentCap: 500, staffCap: 10, note: "More students" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Caps on the licence form need it too; packs only need Manage licences.
    await expect(saveLicence(am, uni.id, licence({ ...TERM, studentCap: 500, staffCap: 10, invoice: false }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addSeatPacks(customNo, uni.id, { kind: "student", packs: 1 }, "2026-06-01")).resolves.toBeTruthy();
    const sup = await team("Seats Support", "support_agent");
    await expect(addSeatPacks(sup, uni.id, { kind: "student", packs: 1 }, "2026-06-01")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await licenceOf(uni.id)).studentCap).toBe(125);
  });
});

describe("the institute's Seats page", () => {
  it("an admin buys packs for its own university only, at the price shown", async () => {
    const a = await institute("Packs Buyer A");
    const b = await institute("Packs Buyer B");
    const seats = await instituteSeats(a.admin, "2026-10-01");
    expect(seats.licence).toMatchObject({ studentCap: 100 });
    const quote = quotePacks({ packs: 2, terms: seats.pricing.student, ...TERM, today: "2026-10-01" });
    const total = chargeFor(quote.amountPaise, 0, seats.quote!.gstRateBp, seats.quote!.intraState).totalPaise;

    // A price that has changed since the page was shown buys nothing.
    await expect(buySeatPacks(a.admin, { kind: "student", packs: 2, expectedTotalPaise: total + 100 }, "2026-10-01")).rejects.toBeInstanceOf(ConflictError);
    const bought = await buySeatPacks(a.admin, { kind: "student", packs: 2, expectedTotalPaise: total }, "2026-10-01");
    expect(bought.invoice).toMatchObject({ universityId: a.uni.id, totalPaise: total, status: "unpaid" });
    expect(bought.pack).toMatchObject({ universityId: a.uni.id, source: "institute" });
    expect((await licenceOf(a.uni.id)).studentCap).toBe(100 + quote.seats);
    expect((await licenceOf(b.uni.id)).studentCap).toBe(100);

    // Each sees only its own packs and invoices.
    expect((await instituteSeats(a.admin, "2026-10-01")).purchases).toHaveLength(1);
    expect((await instituteSeats(b.admin, "2026-10-01")).purchases).toHaveLength(0);
    expect((await instituteSeats(b.admin, "2026-10-01")).invoices.map((i) => i.id)).not.toContain(bought.invoice!.id);

    // B can't pay A's invoice; A can pay its own (test gateway).
    await expect(payZinnyInvoice(b.admin, bought.invoice!.id, "2026-10-02")).rejects.toBeInstanceOf(NotFoundError);
    const paid = await payZinnyInvoice(a.admin, bought.invoice!.id, "2026-10-02");
    expect(paid).toMatchObject({ status: "paid", paidOn: "2026-10-02" });
    await expect(payZinnyInvoice(a.admin, bought.invoice!.id, "2026-10-02")).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses people without settings.manage and the Zinny team's own connection", async () => {
    const a = await institute("Packs Refuse U");
    const student = await (await person("Packs Student", "student", { universityId: a.uni.id })).actor();
    await expect(buySeatPacks(student, { kind: "student", packs: 1 }, "2026-10-01")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(instituteSeats(student)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(buySeatPacks(sa, { kind: "student", packs: 1 }, "2026-10-01")).rejects.toBeInstanceOf(ForbiddenError);
    // An admin of another institute acts only on their own.
    const other = await makeUser("Packs Other Admin");
    await grant(other.id, "institute_admin", { universityId: (await makeUniversity("Packs Other U")).id });
    const otherInA = await loadActor(other.id, a.uni.id);
    await expect(buySeatPacks(otherInA, { kind: "student", packs: 1 }, "2026-10-01")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await licenceOf(a.uni.id)).studentCap).toBe(100);
  });
});

describe("isolation", () => {
  it("plat_seat_packs", () =>
    expectTenantIsolated(platSeatPacks, async (uni) => {
      const [lic] = await systemDb()
        .insert(platLicences)
        .values({ universityId: uni.id, plan: "standard", studentCap: 100, staffCap: 10, startDate: "2026-04-01", endDate: "2027-03-31" })
        .onConflictDoUpdate({ target: platLicences.universityId, set: { studentCap: 100 } })
        .returning();
      return { universityId: uni.id, licenceId: lic.id, kind: "student", packsBought: 1, packs: 1, seatsPerPack: 25, unitPricePaise: 2_500_00, periodStart: "2026-04-01", periodEnd: "2027-03-31", source: "zinny" };
    }));
});
