import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import * as coreSchema from "@/db/schema";
import { auditLog, roleAssignments, supportSessions, universities } from "@/db/schema";
import { loadActor } from "@/server/actor";
import type { Actor } from "@/server/authz/engine";
import { activeSessions, activityLog, activityLogCsv, forceEndSupport, leaveSupport, parseLogFilters, startSupport } from "@/modules/zinny-team-panel/services/support";
import { checkSlug, createUniversityWithLicence, getUniversity, setUniversityStatus, updateBasics } from "@/modules/zinny-team-panel/services/universities";
import { platLicences } from "@/modules/zinny-team-panel/schema";
import { eventsOfType } from "../helpers/events";
import { makeUniversity } from "../fixtures";
import { licence, team } from "./helpers";

afterAll(closeDb);

let sa: Actor, sid: Actor, sue: Actor;
beforeAll(async () => {
  sa = await team("Sup Super", "super_admin");
  sid = await team("Sup Sid", "support_agent");
  sue = await team("Sup Sue", "support_agent");
});

const logFor = (sessionId: string) => systemDb().select().from(auditLog).where(eq(auditLog.supportSessionId, sessionId));

describe("support mode", () => {
  it("entering and leaving are always logged, with the reason", async () => {
    const U = await makeUniversity("Support Log U");
    await expect(startSupport(sid, U.id, "hi")).rejects.toThrow(/short reason/);
    const { sessionId, slug } = await startSupport(sid, U.id, "Ticket 4512: batches");
    expect(slug).toBe(U.slug);
    // Inside, the team member is an Institute Admin for this university, as themselves.
    const inside = await loadActor(sid.userId, U.id);
    expect(inside.supportSessionId).toBe(sessionId);
    expect(inside.userId).toBe(sid.userId);
    expect((await activeSessions(sa)).map((s) => s.id)).toContain(sessionId);

    await leaveSupport(sid, sessionId);
    const log = await logFor(sessionId);
    expect(log.map((l) => l.action).sort()).toEqual(["support.enter", "support.exit"]);
    expect(log.every((l) => l.actorUserId === sid.userId && l.universityId === U.id)).toBe(true);
    expect(log.find((l) => l.action === "support.enter")!.data).toMatchObject({ reason: "Ticket 4512: batches" });
    expect((await activeSessions(sa)).map((s) => s.id)).not.toContain(sessionId);
    await expect(leaveSupport(sid, sessionId)).rejects.toThrow(/already left/);
  });

  it("someone else's session can be force-ended, which is logged with who and why", async () => {
    const U = await makeUniversity("Support Force U");
    const { sessionId } = await startSupport(sid, U.id, "Ticket 4513: invoices");
    await expect(forceEndSupport(sue, sessionId, "no")).rejects.toThrow(/why/);
    await expect(forceEndSupport(sue, sessionId, "Ticket closed by the customer")).resolves.toEqual({ forced: true });
    const [s] = await systemDb().select().from(supportSessions).where(eq(supportSessions.id, sessionId));
    expect(s.endedAt).not.toBeNull();
    expect((await loadActor(sid.userId, U.id)).supportSessionId).toBeNull();
    const exit = await logFor(sessionId);
    expect(exit.map((l) => l.action).sort()).toEqual(["support.enter", "support.exit"]);
    const [forced] = await systemDb().select().from(auditLog).where(and(eq(auditLog.action, "support.force_end"), eq(auditLog.entityId, sessionId)));
    expect(forced).toMatchObject({ actorUserId: sue.userId, universityId: U.id });
    expect(forced.data).toMatchObject({ staffUserId: sid.userId, reason: "Ticket closed by the customer" });
    await expect(forceEndSupport(sue, sessionId, "Ticket closed again")).rejects.toThrow(/already ended/);
  });

  it("the activity log filters by university, person, action and date, and exports CSV", async () => {
    const U = await makeUniversity("Support Filter U");
    const V = await makeUniversity("Support Other U");
    const a = await startSupport(sid, U.id, '=HYPERLINK("http://x") ticket 1');
    await leaveSupport(sid, a.sessionId);
    const b = await startSupport(sue, V.id, "Ticket 2: other place");
    await leaveSupport(sue, b.sessionId);

    const { entries } = await activityLog(sa, { scope: "support", universityId: U.id });
    expect(entries.length).toBe(2);
    expect(entries.every((e) => e.universityName === "Support Filter U")).toBe(true);
    const bySue = await activityLog(sa, { scope: "support", personId: sue.userId, action: "support.enter" });
    expect(bySue.entries.map((e) => e.sessionReason)).toContain("Ticket 2: other place");
    expect(bySue.entries.every((e) => e.action === "support.enter" && e.actorName === "Sup Sue")).toBe(true);
    const future = await activityLog(sa, { scope: "support", from: "2099-01-01" });
    expect(future.entries).toEqual([]);

    const parsed = parseLogFilters({ university: "nope", from: "2026-13-01", to: "2026-10-01", person: sid.userId, scope: "all" });
    expect(parsed.filters).toEqual({ scope: "all", personId: sid.userId, to: "2026-10-01" });
    expect(parsed.problems).toEqual(["university", "from date"]);

    const { csv, rows } = await activityLogCsv(sa, { scope: "support", universityId: U.id });
    expect(rows).toBe(2);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toContain("When (IST),Person,Email,University,Action");
    expect(lines).toHaveLength(3);
    // A reason that looks like a formula is never run by a spreadsheet.
    expect(csv).toContain(`"'=HYPERLINK(""http://x"") ticket 1"`);
    expect(csv).not.toMatch(/,=HYPERLINK/);
    const [exported] = await systemDb().select().from(auditLog).where(and(eq(auditLog.action, "plat.log.export"), eq(auditLog.actorUserId, sa.userId)));
    expect(exported.data).toMatchObject({ rows: 2 });
  });
});

describe("universities", () => {
  it("creates a university through core with its admin invited and its licence set", async () => {
    const am = await team("Uni Manager", "account_manager");
    const slug = `river-${Date.now().toString(36)}`;
    await expect(createUniversityWithLicence(am, { name: "R", slug, adminName: "Rahul Rao", adminEmail: "rahul@x.edu" })).rejects.toThrow(/name/);
    await expect(createUniversityWithLicence(am, { name: "Riverside", slug: "platform", adminName: "Rahul Rao", adminEmail: "rahul@x.edu" })).rejects.toThrow(/reserved/);
    await expect(createUniversityWithLicence(am, { name: "Riverside", slug, adminName: "Rahul Rao", adminEmail: "rahul@x.edu", licence: licence({ plan: "gold" }) })).rejects.toThrow(/plan/);
    expect(await systemDb().select().from(universities).where(eq(universities.slug, slug))).toEqual([]);

    const email = `${slug}@riverside.edu`;
    const u = await createUniversityWithLicence(am, { name: "Riverside College", slug, adminName: "Rahul Rao", adminEmail: email, licence: licence() });
    expect(u.invoicePrefix).toBe("RIVE");
    const [admin] = await systemDb().select().from(roleAssignments).where(and(eq(roleAssignments.universityId, u.id), eq(roleAssignments.role, "institute_admin")));
    expect(admin).toBeTruthy();
    const invites = await eventsOfType("user.invited", u.id);
    expect(invites.map((e) => e.payload.email)).toEqual([email]);
    expect(await systemDb().select().from(platLicences).where(eq(platLicences.universityId, u.id))).toHaveLength(1);
    const detail = await getUniversity(am, u.id);
    expect(detail.admin).toMatchObject({ email, invited: true });
    await expect(createUniversityWithLicence(am, { name: "Again", slug, adminName: "Rahul Rao", adminEmail: email })).rejects.toThrow(/already uses/);
    expect(checkSlug("  My-Uni ")).toBe("my-uni");
    expect(() => checkSlug("-bad")).toThrow(/hyphen/);
  });

  it("edits basics through core updateUniversity and logs suspensions with the reason", async () => {
    const am = await team("Uni Editor", "account_manager");
    const U = await makeUniversity("Basics U");
    const base = { name: "Basics University", slug: U.slug, timezone: "Asia/Kolkata", gstin: "29aabcd1234e1z5", legalName: "Basics Trust", address: "Bengaluru", stateCode: "29", invoicePrefix: "bas" };
    await expect(updateBasics(am, U.id, { ...base, gstin: "123" })).rejects.toThrow(/GSTIN/);
    await expect(updateBasics(am, U.id, { ...base, timezone: "Moon/Base" })).rejects.toThrow(/time zone/);
    const after = await updateBasics(am, U.id, base);
    expect(after).toMatchObject({ name: "Basics University", gstin: "29AABCD1234E1Z5", stateCode: "29", invoicePrefix: "BAS", legalName: "Basics Trust" });
    const [logged] = await systemDb().select().from(auditLog).where(and(eq(auditLog.universityId, U.id), eq(auditLog.action, "university.update")));
    expect(logged.actorUserId).toBe(am.userId);

    await expect(setUniversityStatus(am, U.id, "suspended", "no")).rejects.toThrow(/why/);
    await setUniversityStatus(am, U.id, "suspended", "Licence unpaid since 1 October");
    await expect(setUniversityStatus(am, U.id, "suspended", "Licence unpaid again")).rejects.toThrow(/already suspended/);
    const [row] = await systemDb().select().from(universities).where(eq(universities.id, U.id));
    expect(row.status).toBe("suspended");
    const [why] = await systemDb().select().from(auditLog).where(and(eq(auditLog.universityId, U.id), eq(auditLog.action, "plat.university.suspend")));
    expect(why).toMatchObject({ actorUserId: am.userId, data: expect.objectContaining({ reason: "Licence unpaid since 1 October" }) });
    await setUniversityStatus(am, U.id, "active", "");
  });
});

/** Every file in the module, as text. */
function moduleSources(dir = join(process.cwd(), "src/modules/zinny-team-panel")): { path: string; text: string }[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return moduleSources(p);
    return /\.(ts|tsx)$/.test(name) ? [{ path: p, text: readFileSync(p, "utf8") }] : [];
  });
}

describe("no platform action writes into university tables except through the core API", () => {
  it("the module never inserts, updates or deletes a core table itself", () => {
    const coreTables = Object.entries(coreSchema)
      .filter(([, v]) => v && typeof v === "object" && Symbol.for("drizzle:IsDrizzleTable") in (v as object))
      .map(([k]) => k);
    expect(coreTables).toContain("universities");
    const offences: string[] = [];
    for (const { path, text } of moduleSources()) {
      for (const t of coreTables) {
        if (new RegExp(`\\.(insert|update|delete)\\(\\s*${t}\\b`).test(text)) offences.push(`${path}: ${t}`);
      }
      if (/\binsert into|\bupdate\s+(?!plat_)\w+\s+set|\bdelete from\s+(?!plat_)/i.test(text)) offences.push(`${path}: raw SQL write`);
    }
    expect(offences).toEqual([]);
  });

  it("a licence change leaves the university row untouched and logs through core audit", async () => {
    const am = await team("Uni Untouched", "account_manager");
    const U = await makeUniversity("Untouched U");
    const [before] = await systemDb().select().from(universities).where(eq(universities.id, U.id));
    await (await import("@/modules/zinny-team-panel/services/licences")).saveLicence(am, U.id, licence());
    const [after] = await systemDb().select().from(universities).where(eq(universities.id, U.id));
    expect(after).toEqual(before);
  });
});
