/**
 * Demo data: consents for the Demo University's students (some with news switched on, one
 * withdrawn), Zinny-level consents for the marketplace learner, an open erasure request and a
 * correction request, a learner under 18 waiting for her guardian, retention settings, and one
 * closed breach in the register. Runs after the marketplace seed (alphabetical order).
 */
import { eq } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { users } from "@/db/schema";
import { loadActor, withTenant } from "@/server/core";
import { dpdpConsents, dpdpRequests, dpdpSettings } from "./schema";
import { NOTICE_VERSION, addDays, type Purpose } from "./lib/rules";
import { ipHash } from "./lib/hash";
import { fileRequest } from "./services/requests";
import { checkAgeInput, startGuardianConsent } from "./services/children";
import { logBreach, markBreachStep } from "./services/breaches";
import { zinny } from "./services/system";

const STUDENTS = ["riya", "kabir", "aditi", "ishaan", "meera", "rohan", "sneha", "arjun", "zoya", "tara", "neil", "diya"];
const NEWS = new Set(["riya", "aditi", "meera", "arjun", "diya"]);

const DAY = 86_400_000;
const istLocal = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16);

export async function seed(ctx: SeedContext) {
  const db = zinny();
  const already = await db.select({ id: dpdpConsents.id }).from(dpdpConsents).where(eq(dpdpConsents.universityId, ctx.universityId)).limit(1);
  if (already.length) return;

  const now = Date.now();
  const rows: (typeof dpdpConsents.$inferInsert)[] = [];
  STUDENTS.forEach((first, i) => {
    const userId = ctx.ids.users[`${first}@demo.edu`];
    if (!userId) return;
    const grantedAt = new Date(now - (90 - i * 3) * DAY);
    const base = { userId, noticeVersion: NOTICE_VERSION, grantedAt, source: "student_signup", ipHash: ipHash(`103.21.58.${10 + i}`) };
    const purposes: Purpose[] = ["account", "service"];
    for (const purpose of purposes) {
      rows.push({ ...base, universityId: ctx.universityId, purpose });
      rows.push({ ...base, universityId: null, purpose });
    }
    if (NEWS.has(first)) rows.push({ ...base, universityId: ctx.universityId, purpose: "marketing" });
    if (first === "kabir") rows.push({ ...base, universityId: ctx.universityId, purpose: "marketing", withdrawnAt: new Date(now - 12 * DAY), source: "student_signup" });
    if (first === "riya" || first === "aditi") rows.push({ ...base, universityId: ctx.universityId, purpose: "kyc", source: "kyc", grantedAt: new Date(now - 20 * DAY) });
  });
  const [neha] = await db.select({ id: users.id }).from(users).where(eq(users.email, "neha@zinny.demo"));
  if (neha) {
    for (const purpose of ["account", "service", "marketing"] as const) {
      rows.push({ userId: neha.id, universityId: null, purpose, noticeVersion: NOTICE_VERSION, grantedAt: new Date(now - 30 * DAY), source: "student_signup", ipHash: ipHash("49.36.12.7") });
    }
  }
  if (rows.length) await db.insert(dpdpConsents).values(rows).onConflictDoNothing();

  // Retention: the default three years, flag only.
  await db.insert(dpdpSettings).values({ universityId: ctx.universityId }).onConflictDoNothing();

  // An open erasure request, and a correction request that is being worked on.
  const rohan = await ctx.actorFor("rohan@demo.edu");
  await fileRequest(rohan, { kind: "erasure", details: "I've finished my course and moved abroad. Please erase my account and my KYC details." });
  const meera = await ctx.actorFor("meera@demo.edu");
  const correction = await fileRequest(meera, { kind: "correction", details: "My surname is spelt “Nair” on my certificate but “Naiyar” on my invoice. Please correct the invoice name." });
  await withTenant(ctx.systemActor, (tx) => tx.update(dpdpRequests).set({ status: "in_progress" }).where(eq(dpdpRequests.id, correction.id)));
  if (neha) {
    const nehaActor = await loadActor(neha.id, null);
    await fileRequest(nehaActor, { kind: "nomination", details: "", data: { nomineeName: "Suresh Kulkarni", nomineeContact: "suresh.k@example.com", nomineeRelation: "Father" } });
  }

  // A learner under 18 whose guardian hasn't confirmed yet.
  const tara = await ctx.actorFor("tara@demo.edu");
  const details = checkAgeInput({ age: "minor", birthDate: addDays(ctx.today, -16 * 365 - 30), guardianName: "Lakshmi Iyer", guardianContact: "lakshmi.iyer@example.com" }, ctx.today);
  if (details) await startGuardianConsent(tara, details, { ip: "103.21.58.40", linkBase: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? "3000"}` });

  // One closed breach, handled inside the 72 hours.
  const [zara] = await db.select({ id: users.id }).from(users).where(eq(users.email, "zara@zinny.demo"));
  const zaraId = zara?.id ?? ctx.ids.users["zara@zinny.demo"];
  if (zaraId) {
    const team = await loadActor(zaraId, null);
    const detected = new Date(now - 41 * DAY);
    const b = await logBreach(
      team,
      {
        title: "Attendance export emailed to the wrong address",
        description:
          "A support agent emailed a CSV of one batch's attendance (names, emails and attendance marks for 18 students) to a mistyped address. The recipient's mail server bounced it after 40 minutes; the mailbox provider confirmed it was not delivered.",
        detectedAt: istLocal(detected),
        occurredAt: istLocal(new Date(detected.getTime() - 50 * 60_000)),
        dataCategories: "Names, email addresses, attendance marks",
        principalsAffected: "18",
        instituteIds: [ctx.universityId],
        measures: "Exports now go only to verified addresses on the institute's account. The agent's team was retrained.",
      },
      new Date(detected.getTime() + 5 * 60_000),
    );
    await markBreachStep(team, b.id, "board_intimated", { now: new Date(detected.getTime() + 3 * 3_600_000) });
    await markBreachStep(team, b.id, "contained", { now: new Date(detected.getTime() + 4 * 3_600_000) });
    await markBreachStep(team, b.id, "principals_notified", { now: new Date(detected.getTime() + 20 * 3_600_000) });
    await markBreachStep(team, b.id, "board_report", { now: new Date(detected.getTime() + 52 * 3_600_000) });
    await markBreachStep(team, b.id, "closed", { now: new Date(detected.getTime() + 9 * DAY) });
  }
}
