/** Who may handle requests: privacy.manage in the institute, platform.manage_universities on Zinny. Allow and deny for each. */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { can } from "@/server/authz/engine";
import { loadActor } from "@/server/actor";
import { ForbiddenError } from "@/server/errors";
import { consentSummary } from "@/modules/privacy/services/consents";
import { decidePlatformRequest, decideRequest, fileRequest, listRequests, platformRequests } from "@/modules/privacy/services/requests";
import { getRetentionSettings, retentionSweep, saveRetentionSettings } from "@/modules/privacy/services/retention";
import { listBreaches, logBreach, markBreachStep } from "@/modules/privacy/services/breaches";
import { makeDepartment, person } from "../fixtures";
import { instituteWithStudent, marketplaceLearner, teamMember } from "./helpers";

afterAll(closeDb);

const istNow = () => new Date(Date.now() + 5.5 * 3_600_000 - 60_000).toISOString().slice(0, 16);

describe("institute: privacy.manage", () => {
  it("the Institute Admin holds it; HOD, faculty, board and students don't", async () => {
    const { uni, admin, student } = await instituteWithStudent();
    const dept = await makeDepartment(uni.id, "PRV", "Privacy dept");
    const hod = await (await person("Hod Privacy", "hod", { universityId: uni.id, departmentId: dept.id })).actor();
    const board = await (await person("Board Privacy", "board_owner", { universityId: uni.id })).actor();
    const target = { universityId: uni.id };
    expect(can(admin, "privacy.manage", target)).toBe(true);
    for (const a of [hod, board, student]) expect(can(a, "privacy.manage", target)).toBe(false);
  });

  it("allows the admin to list and answer requests, and denies a student", async () => {
    const { admin, student } = await instituteWithStudent();
    const req = await fileRequest(student, { kind: "grievance", details: "I was emailed someone else's marks." });
    const list = await listRequests(admin);
    expect(list.map((r) => r.id)).toContain(req.id);
    expect(list.find((r) => r.id === req.id)?.person?.name).toBe("Privacy Student");
    await expect(listRequests(student)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideRequest(student, { requestId: req.id, status: "completed", response: "Fixed it myself." })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(consentSummary(student)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await decideRequest(admin, { requestId: req.id, status: "in_progress", response: "Looking into it." })).request.status).toBe("in_progress");
  });

  it("one institute's admin can't see or answer another's requests", async () => {
    const a = await instituteWithStudent("Privacy A");
    const b = await instituteWithStudent("Privacy B");
    const req = await fileRequest(a.student, { kind: "correction", details: "Fix my surname please." });
    expect((await listRequests(b.admin)).map((r) => r.id)).not.toContain(req.id);
    await expect(decideRequest(b.admin, { requestId: req.id, status: "completed", response: "Done." })).rejects.toThrow(/not found/i);
  });

  it("retention settings: admin allowed, student denied; the period is bounded", async () => {
    const { admin, student } = await instituteWithStudent();
    await expect(getRetentionSettings(student)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveRetentionSettings(student, { inactiveDays: 400, retentionAction: "flag", grievanceName: "", grievanceEmail: "" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveRetentionSettings(admin, { inactiveDays: 30, retentionAction: "flag", grievanceName: "", grievanceEmail: "" })).rejects.toThrow(/180 days/);
    await saveRetentionSettings(admin, { inactiveDays: 730, retentionAction: "anonymise", grievanceName: "Asha Rao", grievanceEmail: "Privacy@Demo.edu" });
    expect(await getRetentionSettings(admin)).toEqual({ inactiveDays: 730, retentionAction: "anonymise", grievanceName: "Asha Rao", grievanceEmail: "privacy@demo.edu" });
  });

  it("the retention job flags learners inactive past the period, and leaves active ones", async () => {
    const { admin, uni } = await instituteWithStudent();
    const { systemActorFor } = await import("@/server/actor");
    const later = new Date(Date.now() + 1200 * 86_400_000);
    const first = await retentionSweep(systemActorFor(uni.id), later);
    expect(first.flagged).toBe(1);
    expect((await retentionSweep(systemActorFor(uni.id), later)).flagged).toBe(0);
    expect((await retentionSweep(systemActorFor(uni.id))).cleared).toBe(1);
    await expect(retentionSweep(await loadActor(admin.userId, null, { session: null }))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Zinny team: platform.manage_universities", () => {
  it("Super Admin and Account Manager see every request and answer Zinny's own; Support and Content QA are denied", async () => {
    const learner = await marketplaceLearner();
    const req = await fileRequest(learner.actor, { kind: "erasure", details: "Please delete my marketplace account." });
    expect(req.universityId).toBeNull();
    const superAdmin = await teamMember("super_admin");
    const manager = await teamMember("account_manager");
    expect((await platformRequests(superAdmin)).map((r) => r.id)).toContain(req.id);
    expect((await platformRequests(manager)).map((r) => r.id)).toContain(req.id);
    for (const denied of [await teamMember("support_agent"), await teamMember("content_qa"), learner.actor]) {
      await expect(platformRequests(denied)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(decidePlatformRequest(denied, { requestId: req.id, status: "completed", response: "" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listBreaches(denied)).rejects.toBeInstanceOf(ForbiddenError);
    }
    const { erased } = await decidePlatformRequest(superAdmin, { requestId: req.id, status: "completed", response: "" });
    expect(erased?.anonymised).toBe(true);
  });

  it("the team can't close an institute's request from the panel: the institute answers it", async () => {
    const { student } = await instituteWithStudent();
    const req = await fileRequest(student, { kind: "erasure", details: "" });
    const superAdmin = await teamMember("super_admin");
    await expect(decidePlatformRequest(superAdmin, { requestId: req.id, status: "completed", response: "" })).rejects.toThrow(/not found/i);
  });

  it("logs a breach and walks it to closed; closing needs the Board report and the notices", async () => {
    const superAdmin = await teamMember("super_admin");
    const b = await logBreach(superAdmin, { title: "Test breach", description: "A test incident for the register.", detectedAt: istNow(), dataCategories: "Names" });
    expect(b.status).toBe("open");
    await expect(markBreachStep(superAdmin, b.id, "closed")).rejects.toThrow(/Board/);
    const r = await markBreachStep(superAdmin, b.id, "board_report");
    expect(r.boardIntimatedAt).toBeInstanceOf(Date);
    await markBreachStep(superAdmin, b.id, "principals_notified");
    expect((await markBreachStep(superAdmin, b.id, "closed")).status).toBe("closed");
    await expect(logBreach(superAdmin, { title: "Future", description: "Detected in the future?", detectedAt: "2099-01-01T10:00", dataCategories: "" })).rejects.toThrow(/future/);
  });
});
