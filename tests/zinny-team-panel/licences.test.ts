import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, roleAssignments } from "@/db/schema";
import type { Actor } from "@/server/authz/engine";
import { setTestModules } from "@/server/registry";
import { runJobs } from "@/server/jobs-runner";
import zinnyTeamPanel from "@/modules/zinny-team-panel";
import { platAlerts, platLicences } from "@/modules/zinny-team-panel/schema";
import { addDays, todayIST } from "@/modules/zinny-team-panel/lib/format";
import { acknowledgeAlert, licenceConditions, listAlerts, listLicences, saveLicence } from "@/modules/zinny-team-panel/services/licences";
import { usageFor } from "@/modules/zinny-team-panel/services/shared";
import { listUniversities, setUniversityStatus } from "@/modules/zinny-team-panel/services/universities";
import { grant, makeDepartment, makeUniversity, makeUser } from "../fixtures";
import { licence, team } from "./helpers";

afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

let am: Actor;
beforeAll(async () => {
  am = await team("Lic Manager", "account_manager");
});

async function people(universityId: string, students: number, staff: { role: "institute_admin" | "hod" | "permanent_faculty" | "visiting_faculty"; departmentId?: string }[]) {
  const ids: string[] = [];
  for (let i = 0; i < students; i++) {
    const u = await makeUser(`Student ${i}`);
    await grant(u.id, "student", { universityId });
    ids.push(u.id);
  }
  for (const s of staff) {
    const u = await makeUser(`Staff ${s.role}`);
    await grant(u.id, s.role, { universityId, departmentId: s.departmentId });
    ids.push(u.id);
  }
  return ids;
}

describe("usage counts across two universities", () => {
  it("counts each university's own people once, ignoring revoked and expired roles", async () => {
    const A = await makeUniversity("Usage A");
    const B = await makeUniversity("Usage B");
    const deptA = await makeDepartment(A.id, "CS", "CS");
    await people(A.id, 3, [{ role: "institute_admin" }, { role: "hod", departmentId: deptA.id }]);
    await people(B.id, 5, [{ role: "institute_admin" }]);

    // A person in both universities counts in each.
    const both = await makeUser("Both Places");
    await grant(both.id, "student", { universityId: A.id });
    await grant(both.id, "student", { universityId: B.id });
    // Someone who is both admin and faculty in A counts once as staff.
    const dual = await makeUser("Dual Role");
    await grant(dual.id, "institute_admin", { universityId: A.id });
    await grant(dual.id, "permanent_faculty", { universityId: A.id, departmentId: deptA.id });
    // A revoked student and an expired visiting faculty member don't count.
    const gone = await makeUser("Revoked");
    await grant(gone.id, "student", { universityId: A.id });
    await systemDb().update(roleAssignments).set({ revokedAt: new Date() }).where(eq(roleAssignments.userId, gone.id));
    const expired = await makeUser("Expired");
    await grant(expired.id, "visiting_faculty", { universityId: A.id, departmentId: deptA.id }, new Date(Date.now() - 60_000));
    // A parent counts towards neither.
    const parent = await makeUser("Parent");
    await grant(parent.id, "parent", { universityId: A.id });

    const usage = await usageFor(systemDb(), [A.id, B.id]);
    expect(usage.get(A.id)).toEqual({ students: 4, staff: 3 });
    expect(usage.get(B.id)).toEqual({ students: 6, staff: 1 });

    await saveLicence(am, A.id, licence({ studentCap: 4, staffCap: 30 }));
    const rows = (await listLicences(am)).filter((r) => r.universityId === A.id || r.universityId === B.id);
    expect(rows.find((r) => r.universityId === A.id)).toMatchObject({ usage: { students: 4, staff: 3 }, studentPct: 100, staffPct: 10 });
    expect(rows.find((r) => r.universityId === B.id)).toMatchObject({ usage: { students: 6, staff: 1 }, licence: null, studentPct: null });
    const list = (await listUniversities(am)).filter((u) => u.id === A.id || u.id === B.id);
    expect(list.map((u) => [u.students, u.staff])).toEqual(expect.arrayContaining([[4, 3], [6, 1]]));
  });
});

describe("licence rules", () => {
  it("validates plan, caps, modules and dates", async () => {
    const U = await makeUniversity("Lic Validate");
    await expect(saveLicence(am, U.id, licence({ plan: "gold" }))).rejects.toThrow(/Pick a plan/);
    await expect(saveLicence(am, U.id, licence({ studentCap: 0 }))).rejects.toThrow(/Student cap/);
    await expect(saveLicence(am, U.id, licence({ staffCap: 1.5 }))).rejects.toThrow(/Staff cap/);
    await expect(saveLicence(am, U.id, licence({ modules: ["teleport"] }))).rejects.toThrow(/Unknown module/);
    await expect(saveLicence(am, U.id, licence({ endDate: "2026-02-30" }))).rejects.toThrow(/end date/);
    await expect(saveLicence(am, U.id, licence({ startDate: "2027-01-01", endDate: "2026-12-31" }))).rejects.toThrow(/on or after/);
  });

  it("one licence per university; changes are logged in the university's audit log", async () => {
    const U = await makeUniversity("Lic Upsert");
    await saveLicence(am, U.id, licence());
    await saveLicence(am, U.id, licence({ plan: "enterprise", studentCap: 5000 }));
    const rows = await systemDb().select().from(platLicences).where(eq(platLicences.universityId, U.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ plan: "enterprise", studentCap: 5000, updatedBy: am.userId });
    const log = await systemDb().select().from(auditLog).where(eq(auditLog.universityId, U.id));
    expect(log.map((l) => l.action).sort()).toEqual(["plat.licence.create", "plat.licence.update"]);
    expect(log.find((l) => l.action === "plat.licence.update")!.data).toMatchObject({ plan: "enterprise", before: { plan: "standard" } });
  });

  it("warns from 90% of a cap and 30 days before the end; critical at 100% and after the end", () => {
    const today = "2026-10-29";
    const lic = { plan: "standard", studentCap: 100, staffCap: 10, endDate: "2027-03-31" };
    expect(licenceConditions(lic, { students: 89, staff: 8 }, today, "U")).toEqual([]);
    expect(licenceConditions(lic, { students: 90, staff: 8 }, today, "U")).toMatchObject([{ kind: "student_cap", level: "warning", title: "U is at 90% of its student cap" }]);
    expect(licenceConditions(lic, { students: 100, staff: 11 }, today, "U").map((c) => [c.kind, c.level])).toEqual([
      ["student_cap", "critical"],
      ["staff_cap", "critical"],
    ]);
    expect(licenceConditions({ ...lic, endDate: "2026-11-28" }, { students: 1, staff: 1 }, today, "U")).toMatchObject([{ kind: "licence_end", level: "warning" }]);
    expect(licenceConditions({ ...lic, endDate: "2026-11-29" }, { students: 1, staff: 1 }, today, "U")).toEqual([]);
    expect(licenceConditions({ ...lic, endDate: "2026-10-28" }, { students: 1, staff: 1 }, today, "U")).toMatchObject([{ kind: "licence_end", level: "critical" }]);
  });

  it("raises, updates, acknowledges and resolves alerts; suspended universities have none", async () => {
    const U = await makeUniversity("Lic Alerts");
    await people(U.id, 9, [{ role: "institute_admin" }]);
    const today = todayIST();
    const open = () => systemDb().select().from(platAlerts).where(and(eq(platAlerts.universityId, U.id), isNull(platAlerts.resolvedAt)));

    await saveLicence(am, U.id, licence({ studentCap: 10, startDate: addDays(today, -300), endDate: addDays(today, 10) }));
    expect((await open()).map((a) => a.kind).sort()).toEqual(["licence_end", "student_cap"]);
    const capAlert = (await open()).find((a) => a.kind === "student_cap")!;
    expect(capAlert.level).toBe("warning");

    // Marked as handled: off the home page until it gets worse.
    await acknowledgeAlert(am, capAlert.id);
    expect((await listAlerts(am, { handled: false })).some((a) => a.id === capAlert.id)).toBe(false);
    await people(U.id, 2, []); // 11 of 10: critical
    await saveLicence(am, U.id, licence({ studentCap: 10, startDate: addDays(today, -300), endDate: addDays(today, 10) }));
    const worse = (await open()).find((a) => a.kind === "student_cap")!;
    expect(worse).toMatchObject({ id: capAlert.id, level: "critical", acknowledgedAt: null });

    // Raising the cap and extending the term clears both.
    await saveLicence(am, U.id, licence({ studentCap: 100, startDate: addDays(today, -300), endDate: addDays(today, 200) }));
    expect(await open()).toEqual([]);

    // Suspended: no warnings even when over the cap.
    await saveLicence(am, U.id, licence({ studentCap: 5, startDate: addDays(today, -300), endDate: addDays(today, 200) }));
    expect(await open()).toHaveLength(1);
    await setUniversityStatus(am, U.id, "suspended", "Licence unpaid since September");
    expect(await open()).toEqual([]);
    await setUniversityStatus(am, U.id, "active", "");
    expect(await open()).toHaveLength(1);
  });

  it("the hourly job raises warnings for each university under row-level security", async () => {
    setTestModules([zinnyTeamPanel], { only: true });
    const U = await makeUniversity("Lic Job");
    await saveLicence(am, U.id, licence({ studentCap: 10, startDate: "2026-01-01", endDate: addDays(todayIST(), 200) }));
    await people(U.id, 10, []);
    expect(await systemDb().select().from(platAlerts).where(eq(platAlerts.universityId, U.id))).toEqual([]);
    const report = await runJobs("hour", { universityId: U.id });
    expect(report).toEqual([expect.objectContaining({ jobId: "zinny-team-panel.licence-alerts", ok: true })]);
    const [alert] = await systemDb().select().from(platAlerts).where(eq(platAlerts.universityId, U.id));
    expect(alert).toMatchObject({ kind: "student_cap", level: "critical" });
    const [log] = await systemDb().select().from(auditLog).where(and(eq(auditLog.universityId, U.id), eq(auditLog.action, "plat.alert.raise")));
    expect(log).toBeTruthy();
    // Running again changes nothing.
    await runJobs("hour", { universityId: U.id });
    expect(await systemDb().select().from(platAlerts).where(eq(platAlerts.universityId, U.id))).toHaveLength(1);
  });
});
