import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, universities } from "@/db/schema";
import { setTestModules } from "@/server/registry";
import { seedDemo } from "@/db/seed";
import zinnyTeamPanel from "@/modules/zinny-team-panel";
import { platAlerts, platContentFlags, platInvoices, platLicences, platPartners, platSeatPacks } from "@/modules/zinny-team-panel/schema";

afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

async function quietSeed() {
  const log = console.log;
  console.log = () => {};
  try {
    return await seedDemo();
  } finally {
    console.log = log;
  }
}

describe("seed", () => {
  it("adds licences for two universities, invoices, partners, a flag and a support session, and can run again", async () => {
    setTestModules([zinnyTeamPanel], { only: true });
    await quietSeed();
    const ctx = await quietSeed();
    const [riverside] = await systemDb().select().from(universities).where(eq(universities.slug, "riverside"));
    expect(riverside).toBeTruthy();
    const lics = await systemDb().select().from(platLicences);
    expect(lics.filter((l) => l.universityId === ctx.universityId || l.universityId === riverside.id)).toHaveLength(2);
    const alerts = await systemDb().select().from(platAlerts).where(and(eq(platAlerts.universityId, ctx.universityId), isNull(platAlerts.resolvedAt)));
    expect(alerts.map((a) => a.kind).sort()).toEqual(["licence_end", "student_cap"]);
    // The licence, an extra charge, and the staff pack the institute bought (paid).
    const demoInvoices = await systemDb().select().from(platInvoices).where(eq(platInvoices.universityId, ctx.universityId));
    expect(demoInvoices).toHaveLength(3);
    const packs = await systemDb().select().from(platSeatPacks).where(eq(platSeatPacks.universityId, ctx.universityId));
    expect(packs).toEqual([expect.objectContaining({ kind: "staff", packs: 1, seatsPerPack: 5, source: "institute" })]);
    expect(demoInvoices.find((i) => i.id === packs[0].invoiceId)).toMatchObject({ status: "paid" });
    expect(lics.find((l) => l.universityId === ctx.universityId)).toMatchObject({ staffCap: 25 });
    expect(await systemDb().select().from(platInvoices).where(eq(platInvoices.universityId, riverside.id))).toHaveLength(2);
    const partners = (await systemDb().select().from(platPartners)).map((p) => p.name);
    for (const n of ["BrightPath Skills Foundation", "Kalpana Infotech", "Northwind Analytics"]) expect(partners.filter((x) => x === n)).toHaveLength(1);
    expect(await systemDb().select().from(platContentFlags).where(eq(platContentFlags.universityId, ctx.universityId))).toHaveLength(1);
    const support = await systemDb().select().from(auditLog).where(eq(auditLog.universityId, ctx.universityId));
    expect(support.map((l) => l.action)).toEqual(expect.arrayContaining(["support.enter", "support.exit"]));
  });
});
