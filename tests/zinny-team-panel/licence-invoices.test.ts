/** A licence charges the institute, and an unpaid invoice can be revised. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, universities } from "@/db/schema";
import type { Actor } from "@/server/authz/engine";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { chargeFor } from "@/modules/zinny-team-panel/lib/charge";
import { addDays, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { licenceDefaults } from "@/modules/zinny-team-panel/lib/licence";
import { platInvoices, platLicences } from "@/modules/zinny-team-panel/schema";
import {
  createInvoice,
  getInvoice,
  invoiceHistory,
  invoicesForLicence,
  markInvoicePaid,
  markInvoiceUnpaid,
  reviseInvoice,
  type InvoiceRevision,
} from "@/modules/zinny-team-panel/services/billing";
import { licenceFor, saveLicence } from "@/modules/zinny-team-panel/services/licences";
import { ensureDefaultPlans, planOptions } from "@/modules/zinny-team-panel/services/plans";
import { describeChanges, describeDetails } from "@/modules/zinny-team-panel/services/support";
import { createUniversityWithLicence } from "@/modules/zinny-team-panel/services/universities";
import { makeUniversity, uniqueCode } from "../fixtures";
import { licence, team } from "./helpers";

afterAll(closeDb);

const STANDARD = 7_20_000_00;

let sa: Actor, am: Actor, fin: Actor, sup: Actor;
beforeAll(async () => {
  [sa, am, fin, sup] = await Promise.all([team("Charge Super", "super_admin"), team("Charge Manager", "account_manager"), team("Charge Finance", "finance_admin"), team("Charge Support", "support_agent")]);
  await ensureDefaultPlans();
});

const invoicesOf = (universityId: string) => systemDb().select().from(platInvoices).where(eq(platInvoices.universityId, universityId));

describe("the sum", () => {
  it("is list price less discount, plus GST, split by state", () => {
    expect(chargeFor(7_20_000_00, 0, 1800, true)).toEqual({
      listPricePaise: 7_20_000_00,
      discountPaise: 0,
      basePaise: 7_20_000_00,
      gstPaise: 1_29_600_00,
      cgstPaise: 64_800_00,
      sgstPaise: 64_800_00,
      igstPaise: 0,
      totalPaise: 8_49_600_00,
    });
    expect(chargeFor(7_20_000_00, 72_000_00, 1800, false)).toMatchObject({ basePaise: 6_48_000_00, gstPaise: 1_16_640_00, cgstPaise: 0, igstPaise: 1_16_640_00, totalPaise: 7_64_640_00 });
    // An odd paisa goes to SGST, so the halves always add up.
    expect(chargeFor(1_01, 0, 1800, true)).toMatchObject({ gstPaise: 18, cgstPaise: 9, sgstPaise: 9 });
    expect(chargeFor(1_05, 0, 500, true)).toMatchObject({ gstPaise: 5, cgstPaise: 2, sgstPaise: 3 });
  });
});

describe("a new licence charges the institute", () => {
  it("copies the plan's price onto the licence and raises its invoice in the same step", async () => {
    const U = await makeUniversity("Charged U");
    const today = todayIST();
    const saved = await saveLicence(am, U.id, licence({ plan: "standard", startDate: "2026-04-01", endDate: "2027-03-31" }));

    expect(saved).toMatchObject({ plan: "standard", pricePaise: STANDARD, discountPaise: 0, discountNote: null });
    const [inv] = await invoicesOf(U.id);
    expect(saved.invoice!.id).toBe(inv.id);
    expect(inv).toMatchObject({
      licenceId: saved.id,
      listPricePaise: STANDARD,
      discountPaise: 0,
      basePaise: STANDARD,
      gstRateBp: 1800,
      // The test institute is in Maharashtra, Zinny's own state: CGST + SGST.
      cgstPaise: 64_800_00,
      sgstPaise: 64_800_00,
      igstPaise: 0,
      totalPaise: 8_49_600_00,
      description: "Zinny Standard licence, 1 Apr 2026 to 31 Mar 2027",
      periodStart: "2026-04-01",
      periodEnd: "2027-03-31",
      issueDate: today,
      dueDate: addDays(today, 15),
      status: "unpaid",
      createdBy: am.userId,
    });
    expect(inv.number).toMatch(/^ZNY\/\d\d-\d\d\/\d{4}$/);

    const log = await systemDb().select().from(auditLog).where(eq(auditLog.universityId, U.id));
    expect(log.find((l) => l.action === "plat.licence.create")!.data).toMatchObject({ pricePaise: STANDARD, number: inv.number, totalPaise: 8_49_600_00 });
    expect(log.find((l) => l.action === "plat.invoice.create")!.data).toMatchObject({ number: inv.number, listPricePaise: STANDARD, forLicence: true });
  });

  it("charges IGST to an institute in another state", async () => {
    const U = await makeUniversity("Karnataka U");
    await systemDb().update(universities).set({ stateCode: "29" }).where(eq(universities.id, U.id));
    const { invoice } = await saveLicence(am, U.id, licence({ plan: "pilot" }));
    expect(invoice).toMatchObject({ basePaise: 45_000_00, cgstPaise: 0, sgstPaise: 0, igstPaise: 8_100_00, totalPaise: 53_100_00 });
  });

  it("takes a discount off before GST, and needs a note saying why", async () => {
    const U = await makeUniversity("Discount U");
    await expect(saveLicence(am, U.id, licence({ discountPaise: 72_000_00 }))).rejects.toThrow(/why the discount/);
    await expect(saveLicence(am, U.id, licence({ discountPaise: STANDARD + 1, discountNote: "Too much" }))).rejects.toThrow(/can't be more than the price/);
    await expect(saveLicence(am, U.id, licence({ discountPaise: -5, discountNote: "Negative" }))).rejects.toBeInstanceOf(ValidationError);
    // Nothing was saved by the refused attempts.
    expect(await systemDb().select().from(platLicences).where(eq(platLicences.universityId, U.id))).toHaveLength(0);
    expect(await invoicesOf(U.id)).toHaveLength(0);

    const saved = await saveLicence(am, U.id, licence({ discountPaise: 72_000_00, discountNote: "  Founding institute offer  " }));
    expect(saved).toMatchObject({ pricePaise: STANDARD, discountPaise: 72_000_00, discountNote: "Founding institute offer" });
    expect(saved.invoice).toMatchObject({
      listPricePaise: STANDARD,
      discountPaise: 72_000_00,
      discountNote: "Founding institute offer",
      basePaise: 6_48_000_00,
      cgstPaise: 58_320_00,
      sgstPaise: 58_320_00,
      totalPaise: 7_64_640_00,
    });
  });

  it("uses the invoice date and due date it is given, and refuses a due date before the invoice date", async () => {
    const U = await makeUniversity("Dated U");
    await expect(saveLicence(am, U.id, licence({ invoice: { issueDate: "2026-05-10", dueDate: "2026-05-01" } }))).rejects.toThrow(/due date can't be before/);
    await expect(saveLicence(am, U.id, licence({ invoice: { issueDate: "10/05/2026" } }))).rejects.toThrow(/invoice date/);
    expect(await systemDb().select().from(platLicences).where(eq(platLicences.universityId, U.id))).toHaveLength(0);

    const a = await saveLicence(am, U.id, licence({ invoice: { issueDate: "2026-05-10", dueDate: "2026-06-30" } }));
    expect(a.invoice).toMatchObject({ issueDate: "2026-05-10", dueDate: "2026-06-30", financialYear: "26-27" });
    // Only the invoice date given: due 15 days later.
    const V = await makeUniversity("Dated V");
    expect((await saveLicence(am, V.id, licence({ invoice: { issueDate: "2026-05-10" } }))).invoice).toMatchObject({ issueDate: "2026-05-10", dueDate: "2026-05-25" });
  });

  it("the price can be set by hand for what was agreed", async () => {
    const U = await makeUniversity("Agreed Price U");
    const saved = await saveLicence(am, U.id, licence({ plan: "enterprise", pricePaise: 18_00_000_00 }));
    expect(saved.pricePaise).toBe(18_00_000_00);
    expect(saved.invoice!.basePaise).toBe(18_00_000_00);
    await expect(saveLicence(am, U.id, licence({ pricePaise: 12.5 }))).rejects.toThrow(/price/);
  });

  it("\"Don't create an invoice\" saves the licence and its price with no invoice", async () => {
    const U = await makeUniversity("Free Pilot U");
    const saved = await saveLicence(am, U.id, licence({ plan: "pilot", invoice: false }));
    expect(saved.invoice).toBeNull();
    expect(saved.pricePaise).toBe(45_000_00);
    expect(await invoicesOf(U.id)).toHaveLength(0);
    const [log] = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, U.id), eq(auditLog.action, "plat.licence.create")));
    expect(log.data).toMatchObject({ invoiced: false });
  });

  it("a price of 0, or a discount of the whole price, creates no invoice", async () => {
    const U = await makeUniversity("Zero Price U");
    expect((await saveLicence(am, U.id, licence({ pricePaise: 0 }))).invoice).toBeNull();
    const V = await makeUniversity("Fully Discounted U");
    const saved = await saveLicence(am, V.id, licence({ plan: "pilot", discountPaise: 45_000_00, discountNote: "Free pilot for the trust's second college", invoice: {} }));
    expect(saved.invoice).toBeNull();
    expect(saved.discountPaise).toBe(45_000_00);
    expect(await invoicesOf(V.id)).toHaveLength(0);
  });

  it("a failed invoice leaves no licence behind", async () => {
    const U = await makeUniversity("Rolled Back U");
    // The licence itself is fine; the invoice isn't (a GST rate nobody offers), so neither is saved.
    await expect(saveLicence(am, U.id, licence({ invoice: { gstRateBp: 1234 } }))).rejects.toThrow(/GST rate/);
    expect(await systemDb().select().from(platLicences).where(eq(platLicences.universityId, U.id))).toHaveLength(0);
  });

  it("needs the Licences permission; finance alone can do it, support can't", async () => {
    const U = await makeUniversity("Permission U");
    await expect(saveLicence(sup, U.id, licence())).rejects.toBeInstanceOf(ForbiddenError);
    expect((await saveLicence(fin, U.id, licence())).invoice).toBeTruthy();
  });
});

describe("renewing and changing a licence", () => {
  it("editing a cap, the modules or the notes bills nothing", async () => {
    const U = await makeUniversity("Edit Only U");
    await saveLicence(am, U.id, licence());
    const edited = await saveLicence(am, U.id, licence({ studentCap: 150, modules: ["assessments"], notes: "Cap raised for the new batch" }));
    expect(edited.invoice).toBeNull();
    expect(await invoicesOf(U.id)).toHaveLength(1);
    // Unless an invoice is asked for.
    expect((await saveLicence(am, U.id, licence({ studentCap: 150, invoice: {} }))).invoice).toBeTruthy();
  });

  it("a renewal (a new term) and a change of plan each raise an invoice for the same licence", async () => {
    const U = await makeUniversity("Renewal U");
    const first = await saveLicence(am, U.id, licence({ plan: "pilot", startDate: "2026-01-01", endDate: "2026-03-31" }));
    const renewed = await saveLicence(am, U.id, licence({ plan: "pilot", startDate: "2026-04-01", endDate: "2026-06-30" }));
    expect(renewed.id).toBe(first.id);
    expect(renewed.invoice).toMatchObject({ basePaise: 45_000_00, periodStart: "2026-04-01", periodEnd: "2026-06-30", description: "Zinny Pilot licence, 1 Apr 2026 to 30 Jun 2026" });

    const upgraded = await saveLicence(am, U.id, licence({ plan: "standard", startDate: "2026-04-01", endDate: "2026-06-30" }));
    expect(upgraded).toMatchObject({ plan: "standard", pricePaise: STANDARD });
    expect(upgraded.invoice!.basePaise).toBe(STANDARD);

    const raised = await invoicesForLicence(am, first.id);
    expect(raised).toHaveLength(3);
    expect(new Set(raised.map((i) => i.number)).size).toBe(3);
    // A discount from last term isn't carried into the next one.
    await saveLicence(am, U.id, licence({ plan: "standard", startDate: "2026-04-01", endDate: "2026-06-30", discountPaise: 10_000_00, discountNote: "Goodwill", invoice: false }));
    const next = await saveLicence(am, U.id, licence({ plan: "standard", startDate: "2026-07-01", endDate: "2027-06-30" }));
    expect(next).toMatchObject({ discountPaise: 0, discountNote: null });
    expect(next.invoice!.basePaise).toBe(STANDARD);
  });

  it("the licence page lists the invoices raised for it with their status", async () => {
    const U = await makeUniversity("Licence Page U");
    const saved = await saveLicence(am, U.id, licence({ invoice: { issueDate: "2026-04-01", dueDate: "2026-04-16" } }));
    // An invoice issued by hand for something else isn't the licence's.
    await createInvoice(fin, { universityId: U.id, periodStart: "2026-04-01", periodEnd: "2026-04-30", description: "Onboarding", listPricePaise: 10_000_00, gstRateBp: 1800, issueDate: "2026-04-02", dueDate: "2026-04-17" });

    const page = await licenceFor(am, U.id, "2026-05-01");
    expect(page.invoices.map((i) => i.id)).toEqual([saved.invoice!.id]);
    expect(page.invoices[0]).toMatchObject({ status: "unpaid", overdue: true, listPricePaise: STANDARD });
    expect(page.plans.map((p) => p.key)).toEqual(expect.arrayContaining(["pilot", "standard", "enterprise"]));

    await markInvoicePaid(fin, saved.invoice!.id, { paidOn: "2026-04-20", reference: "UTR 998877" });
    expect((await licenceFor(am, U.id, "2026-05-01")).invoices[0]).toMatchObject({ status: "paid", overdue: false, paidOn: "2026-04-20" });
    await expect(invoicesForLicence(sup, saved.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the form's defaults for a plan are its caps, modules, term and price", async () => {
    const [pilot] = (await planOptions(am)).filter((p) => p.key === "pilot");
    expect(licenceDefaults(pilot, "2026-04-01")).toEqual({
      plan: "pilot",
      studentCap: 100,
      staffCap: 10,
      modules: pilot.modules,
      startDate: "2026-04-01",
      endDate: "2026-06-30",
      notes: "",
      pricePaise: 45_000_00,
      discountPaise: 0,
      discountNote: "",
    });
  });
});

describe("creating an institute with a licence", () => {
  it("creates the institute, its licence and the invoice for the plan", async () => {
    const slug = `inv-${uniqueCode("s").toLowerCase()}`;
    const uni = await createUniversityWithLicence(sa, {
      name: "Invoiced Institute",
      slug,
      adminName: "Ira Admin",
      adminEmail: `ira.${slug}@test.zinny`,
      licence: licence({ plan: "pilot", discountPaise: 5_000_00, discountNote: "Referral", invoice: { issueDate: "2026-06-01", dueDate: "2026-06-20" } }),
    });
    const [inv] = await invoicesOf(uni.id);
    expect(inv).toMatchObject({ listPricePaise: 45_000_00, discountPaise: 5_000_00, basePaise: 40_000_00, totalPaise: 47_200_00, issueDate: "2026-06-01", dueDate: "2026-06-20" });
    expect(inv.licenceId).toBeTruthy();
  });

  it("a mistake in the licence stops the institute being created at all", async () => {
    const slug = `bad-${uniqueCode("s").toLowerCase()}`;
    const input = { name: "Half Made", slug, adminName: "Hari Admin", adminEmail: `hari.${slug}@test.zinny` };
    await expect(createUniversityWithLicence(sa, { ...input, licence: licence({ plan: "no-such-plan" }) })).rejects.toThrow(/Pick a plan/);
    await expect(createUniversityWithLicence(sa, { ...input, licence: licence({ discountPaise: 99_99_99_999_00, discountNote: "Too big" }) })).rejects.toThrow(/more than the price/);
    await expect(createUniversityWithLicence(sa, { ...input, licence: licence({ discountPaise: 100_00 }) })).rejects.toThrow(/why the discount/);
    expect(await systemDb().select().from(universities).where(eq(universities.slug, slug))).toHaveLength(0);
  });
});

describe("revising an invoice", () => {
  async function unpaid(name: string) {
    const U = await makeUniversity(name);
    const saved = await saveLicence(am, U.id, licence({ plan: "pilot", startDate: "2026-04-01", endDate: "2026-06-30", invoice: { issueDate: "2026-04-01", dueDate: "2026-04-16" } }));
    return { U, inv: saved.invoice! };
  }
  const same = (inv: typeof platInvoices.$inferSelect, over: Partial<InvoiceRevision> = {}): InvoiceRevision => ({
    description: inv.description,
    periodStart: inv.periodStart,
    periodEnd: inv.periodEnd,
    listPricePaise: inv.listPricePaise ?? inv.basePaise,
    discountPaise: inv.discountPaise,
    discountNote: inv.discountNote,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    ...over,
  });

  it("changes the amount, discount, description, period and dates; GST and total follow; the number stays", async () => {
    const { inv } = await unpaid("Revise U");
    const revised = await reviseInvoice(fin, inv.id, {
      description: "Zinny Pilot licence, one term",
      periodStart: "2026-04-15",
      periodEnd: "2026-07-14",
      listPricePaise: 50_000_00,
      discountPaise: 10_000_00,
      discountNote: "Late start, agreed by phone",
      issueDate: "2026-04-10",
      dueDate: "2026-05-10",
    });
    expect(revised).toMatchObject({
      number: inv.number,
      financialYear: inv.financialYear,
      description: "Zinny Pilot licence, one term",
      periodStart: "2026-04-15",
      periodEnd: "2026-07-14",
      listPricePaise: 50_000_00,
      discountPaise: 10_000_00,
      discountNote: "Late start, agreed by phone",
      basePaise: 40_000_00,
      cgstPaise: 3_600_00,
      sgstPaise: 3_600_00,
      igstPaise: 0,
      totalPaise: 47_200_00,
      issueDate: "2026-04-10",
      dueDate: "2026-05-10",
      status: "unpaid",
      revisedBy: fin.userId,
    });
    expect(revised.revisedAt).toBeInstanceOf(Date);
    expect((await getInvoice(fin, inv.id)).listPricePaise).toBe(50_000_00);
  });

  it("keeps the invoice's own GST rate and state split", async () => {
    const U = await makeUniversity("Revise IGST U");
    await systemDb().update(universities).set({ stateCode: "29" }).where(eq(universities.id, U.id));
    const { invoice } = await saveLicence(am, U.id, licence({ plan: "pilot" }));
    // The institute moves state afterwards; the invoice was issued as IGST and stays IGST.
    await systemDb().update(universities).set({ stateCode: "27" }).where(eq(universities.id, U.id));
    const revised = await reviseInvoice(fin, invoice!.id, same(invoice!, { listPricePaise: 40_000_00 }));
    expect(revised).toMatchObject({ basePaise: 40_000_00, cgstPaise: 0, sgstPaise: 0, igstPaise: 7_200_00, totalPaise: 47_200_00, gstRateBp: 1800 });
  });

  it("refuses a due date before the invoice date, a discount without a note, and no change at all", async () => {
    const { inv } = await unpaid("Revise Rules U");
    await expect(reviseInvoice(fin, inv.id, same(inv, { dueDate: "2026-03-31" }))).rejects.toThrow(/due date can't be before the invoice date/);
    await expect(reviseInvoice(fin, inv.id, same(inv, { issueDate: "2026-05-01" }))).rejects.toThrow(/due date can't be before/);
    await expect(reviseInvoice(fin, inv.id, same(inv, { discountPaise: 1_000_00, discountNote: "" }))).rejects.toThrow(/why the discount/);
    await expect(reviseInvoice(fin, inv.id, same(inv, { discountPaise: 45_000_00, discountNote: "All of it" }))).rejects.toThrow(/less than the amount/);
    await expect(reviseInvoice(fin, inv.id, same(inv, { listPricePaise: 0 }))).rejects.toThrow(/amount/);
    await expect(reviseInvoice(fin, inv.id, same(inv, { periodEnd: "2026-03-01" }))).rejects.toThrow(/period/);
    await expect(reviseInvoice(fin, inv.id, same(inv))).rejects.toThrow(/Nothing is different/);
    const [after] = await systemDb().select().from(platInvoices).where(eq(platInvoices.id, inv.id));
    expect(after).toEqual(inv);
  });

  it("a paid invoice is locked until it is marked unpaid", async () => {
    const { inv } = await unpaid("Revise Paid U");
    await markInvoicePaid(fin, inv.id, { paidOn: "2026-04-10", reference: "UTR 445566" });
    await expect(reviseInvoice(fin, inv.id, same(inv, { dueDate: "2026-04-30" }))).rejects.toBeInstanceOf(ConflictError);
    await expect(reviseInvoice(fin, inv.id, same(inv, { dueDate: "2026-04-30" }))).rejects.toThrow(/locked/);

    await markInvoiceUnpaid(fin, inv.id, "Payment bounced");
    expect((await reviseInvoice(fin, inv.id, same(inv, { dueDate: "2026-04-30" }))).dueDate).toBe("2026-04-30");
  });

  it("needs the finance permission", async () => {
    const { inv } = await unpaid("Revise Permission U");
    for (const a of [am, sup]) await expect(reviseInvoice(a, inv.id, same(inv, { dueDate: "2026-04-30" }))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await reviseInvoice(sa, inv.id, same(inv, { dueDate: "2026-04-30" }))).dueDate).toBe("2026-04-30");
  });

  it("logs every revision with the values before and after, in the institute's log, and shows them as a history", async () => {
    const { U, inv } = await unpaid("Revise Log U");
    await reviseInvoice(fin, inv.id, same(inv, { dueDate: "2026-05-15" }));
    await reviseInvoice(sa, inv.id, same(inv, { dueDate: "2026-05-15", listPricePaise: 45_000_00, discountPaise: 5_000_00, discountNote: "Goodwill" }));

    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, U.id), eq(auditLog.action, "plat.invoice.revise")));
    expect(log).toHaveLength(2);
    const first = log.find((l) => l.actorUserId === fin.userId)!;
    // Only what changed is recorded.
    expect(first.data).toMatchObject({ number: inv.number, before: { dueDate: "2026-04-16" }, after: { dueDate: "2026-05-15" } });
    expect(Object.keys((first.data as { after: object }).after)).toEqual(["dueDate"]);
    const second = log.find((l) => l.actorUserId === sa.userId)!;
    expect(second.data).toMatchObject({
      before: { discountPaise: 0, discountNote: null, basePaise: 45_000_00, totalPaise: 53_100_00 },
      after: { discountPaise: 5_000_00, discountNote: "Goodwill", basePaise: 40_000_00, totalPaise: 47_200_00 },
    });

    const history = await invoiceHistory(fin, inv.id);
    expect(history.map((h) => h.action)).toEqual(["plat.invoice.revise", "plat.invoice.revise", "plat.invoice.create"]);
    expect(history.map((h) => h.byName)).toEqual(["Charge Super", "Charge Finance", "Charge Manager"]);
    expect(describeChanges(history[1].data.before, history[1].data.after)).toEqual(["Due date: 16 Apr 2026 → 15 May 2026"]);
    expect(describeDetails(second.data as Record<string, unknown>, { action: "plat.invoice.revise" })).toContain("Total: ₹53,100 → ₹47,200");
    await expect(invoiceHistory(am, inv.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an invoice issued by hand takes a discount too, and one from before discounts shows its amount as the list price", async () => {
    const U = await makeUniversity("Manual Discount U");
    const inv = await createInvoice(fin, {
      universityId: U.id,
      periodStart: "2026-04-01",
      periodEnd: "2026-04-30",
      description: "Onboarding workshop",
      listPricePaise: 20_000_00,
      discountPaise: 2_000_00,
      discountNote: "Second workshop",
      gstRateBp: 1800,
      issueDate: "2026-04-01",
      dueDate: "2026-04-16",
    });
    expect(inv).toMatchObject({ listPricePaise: 20_000_00, discountPaise: 2_000_00, basePaise: 18_000_00, totalPaise: 21_240_00, licenceId: null });
    // The older `basePaise` input still means the amount before GST.
    const old = await createInvoice(fin, { universityId: U.id, periodStart: "2026-04-01", periodEnd: "2026-04-30", description: "Old style", basePaise: 1_000_00, gstRateBp: 1800, issueDate: "2026-04-01", dueDate: "2026-04-16" });
    expect(old).toMatchObject({ listPricePaise: 1_000_00, discountPaise: 0, basePaise: 1_000_00 });
    await systemDb().update(platInvoices).set({ listPricePaise: null }).where(eq(platInvoices.id, old.id));
    expect((await getInvoice(fin, old.id)).listPricePaise).toBe(1_000_00);
  });
});
