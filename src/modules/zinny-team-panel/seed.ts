/**
 * Demo data for the Zinny team panel: licences for the Demo University and Riverside
 * College, Zinny invoices, partners, a content-review flag, Zinny team members for every
 * platform role, and one finished support session.
 *
 * Writes only plat_ tables, and goes through the core API for everything else
 * (createUniversity, grantPlatformRole, support mode). Safe to run again: the Demo
 * University is recreated by the core seed; Riverside, the team and partners are reused.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { users, universities } from "@/db/schema";
import { enterSupportMode, exitSupportMode, grantPlatformRole, type Actor } from "@/server/core";
import { platInvoiceCounters, platInvoices, platPartners } from "./schema";
import { LICENSABLE_MODULES, type PlatformRole } from "./lib/constants";
import { addDays, financialYear } from "./lib/format";
import { createInvoice, markInvoicePaid } from "./services/billing";
import { flagCourse, markReviewed } from "./services/content";
import { saveLicence } from "./services/licences";
import { addContact, addNote, createPartner } from "./services/partners";
import { createUniversityWithLicence } from "./services/universities";
import { db } from "./services/shared";

/** A Zinny team member as they act on /platform (no university). */
async function teamActor(email: string, role: PlatformRole): Promise<Actor> {
  const [u] = await db().select().from(users).where(eq(users.email, email));
  if (!u) throw new Error(`Seed: ${email} is missing.`);
  return {
    userId: u.id,
    name: u.name,
    email: u.email,
    universityId: null,
    supportSessionId: null,
    assignments: [{ role, scopeType: "platform", universityId: null, departmentId: null, batchId: null, startsAt: new Date(0), endsAt: null }],
  };
}

const TEAM: { email: string; name: string; role: PlatformRole }[] = [
  { email: "maya@zinny.demo", name: "Maya Manager", role: "account_manager" },
  { email: "qasim@zinny.demo", name: "Qasim QA", role: "content_qa" },
  { email: "farida@zinny.demo", name: "Farida Finance", role: "finance_admin" },
  { email: "parth@zinny.demo", name: "Parth Partnerships", role: "partnerships" },
];

export async function seed(ctx: SeedContext) {
  const { today } = ctx;
  const zara = await teamActor("zara@zinny.demo", "super_admin");
  const sid = await teamActor("sid@zinny.demo", "support_agent");

  // The rest of the Zinny team, one per role (they get an invite to set a password).
  for (const m of TEAM) await grantPlatformRole(zara, m);
  const qasim = await teamActor("qasim@zinny.demo", "content_qa");
  const farida = await teamActor("farida@zinny.demo", "finance_admin");
  const parth = await teamActor("parth@zinny.demo", "partnerships");

  // Demo University: a Pilot ending in 20 days, at 12 of 13 students (92%), so both warnings show.
  const allModules = LICENSABLE_MODULES.map((m) => m.id);
  const demoStart = addDays(today, -70);
  await saveLicence(zara, ctx.universityId, {
    plan: "pilot",
    studentCap: 13,
    staffCap: 25,
    modules: allModules.filter((m) => m !== "website-builder" && m !== "gamification"),
    startDate: demoStart,
    endDate: addDays(today, 20),
    notes: "Pilot for the Computer Science and Marketing departments. Renewal call booked with Asha.",
  });

  // A second university, created through core, on a Standard licence.
  let [riverside] = await db().select().from(universities).where(eq(universities.slug, "riverside"));
  const riversideStart = addDays(today, -120);
  const riversideLicence = {
    plan: "standard",
    studentCap: 500,
    staffCap: 40,
    modules: allModules,
    startDate: riversideStart,
    endDate: addDays(riversideStart, 364),
    notes: "Annual licence, paid in two halves.",
  };
  if (!riverside) {
    const created = await createUniversityWithLicence(zara, {
      name: "Riverside College of Commerce",
      slug: "riverside",
      adminName: "Rahul Rao",
      adminEmail: "rahul@riverside.edu",
      invoicePrefix: "RCC",
      licence: riversideLicence,
    });
    [riverside] = await db().select().from(universities).where(eq(universities.id, created.id));
  } else {
    await saveLicence(zara, riverside.id, riversideLicence);
  }

  // Zinny invoices. Number them straight after the ones that survive a re-seed.
  const fy = financialYear(today);
  await db()
    .update(platInvoiceCounters)
    // Only numbers shaped <prefix>/<year>/<seq> count (other rows, e.g. test fixtures, are skipped).
    .set({ lastSeq: sql`coalesce((select max(split_part(${platInvoices.number}, '/', 3)::int) from ${platInvoices} where ${platInvoices.financialYear} = ${fy} and split_part(${platInvoices.number}, '/', 3) ~ '^[0-9]+$'), 0)` })
    .where(eq(platInvoiceCounters.financialYear, fy));
  const pilot = await createInvoice(farida, {
    universityId: ctx.universityId,
    periodStart: demoStart,
    periodEnd: addDays(today, 20),
    description: "Zinny Pilot licence, up to 13 students and 25 staff",
    basePaise: 45_000_00,
    gstRateBp: 1800,
    issueDate: demoStart,
    dueDate: addDays(demoStart, 15),
  });
  await markInvoicePaid(farida, pilot.id, { paidOn: addDays(demoStart, 9), reference: "UTR HDFC0042871193" });
  await createInvoice(farida, {
    universityId: ctx.universityId,
    periodStart: addDays(today, -40),
    periodEnd: addDays(today, 20),
    description: "Extra onboarding for the Marketing department",
    basePaise: 12_000_00,
    gstRateBp: 1800,
    issueDate: addDays(today, -40),
    dueDate: addDays(today, -25),
  });
  const existing = await db().select({ id: platInvoices.id }).from(platInvoices).where(eq(platInvoices.universityId, riverside.id));
  if (existing.length === 0) {
    const first = await createInvoice(farida, {
      universityId: riverside.id,
      periodStart: riversideStart,
      periodEnd: addDays(riversideStart, 181),
      description: "Zinny Standard licence, first half",
      basePaise: 3_60_000_00,
      gstRateBp: 1800,
      issueDate: riversideStart,
      dueDate: addDays(riversideStart, 15),
    });
    await markInvoicePaid(farida, first.id, { paidOn: addDays(riversideStart, 12), reference: "UTR ICIC0019920451" });
    await createInvoice(farida, {
      universityId: riverside.id,
      periodStart: addDays(riversideStart, 182),
      periodEnd: addDays(riversideStart, 364),
      description: "Zinny Standard licence, second half",
      basePaise: 3_60_000_00,
      gstRateBp: 1800,
      issueDate: today,
      dueDate: addDays(today, 15),
    });
  }

  // Content review: one course cleared, one flagged. The rest wait in the queue.
  await markReviewed(qasim, ctx.ids.courses["Python Basics"], "Clear outline, realistic outcomes.");
  await flagCourse(qasim, ctx.ids.courses["Digital Marketing"], {
    category: "claims",
    note: "The description promises \"guaranteed placement with top brands\". Ask the university to remove the guarantee or link to its placement terms.",
  });

  // Partners for the marketplace.
  const names = ["BrightPath Skills Foundation", "Kalpana Infotech", "Northwind Analytics"];
  const have = new Set((await db().select({ name: platPartners.name }).from(platPartners).where(inArray(platPartners.name, names))).map((p) => p.name));
  if (!have.has(names[0])) {
    const p = await createPartner(parth, { name: names[0], kind: "sponsor", status: "active", website: "brightpath.org.in", industry: "Education non-profit", city: "Pune", summary: "Sponsors 50 scholarships a year for first-generation learners." });
    await addContact(parth, p.id, { name: "Ananya Kulkarni", title: "Programme Director", email: "ananya@brightpath.org.in", phone: "+91 98220 41567" });
    await addNote(parth, p.id, "Agreed to fund the Data Analytics weekend batch at Demo University from January.");
  }
  if (!have.has(names[1])) {
    const p = await createPartner(parth, { name: names[1], kind: "corporate_partner", status: "in_talks", website: "kalpanainfotech.com", industry: "IT services", city: "Bengaluru", summary: "Wants to hire Python and SQL graduates through the marketplace." });
    await addContact(parth, p.id, { name: "Vivek Menon", title: "Head of Campus Hiring", email: "vivek.menon@kalpanainfotech.com" });
    await addNote(parth, p.id, "Second call done. They want a shortlist of 20 learners by March.");
  }
  if (!have.has(names[2])) {
    await createPartner(parth, { name: names[2], kind: "sponsor", status: "prospect", website: "northwind.in", industry: "Analytics", city: "Mumbai" });
  }

  // One finished support session, so the activity log has a real entry.
  const session = await enterSupportMode(sid, ctx.universityId, "Ticket 4498: weekend batch timings not showing");
  await exitSupportMode(sid, session.id);
}
