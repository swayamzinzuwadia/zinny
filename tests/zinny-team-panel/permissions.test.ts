/**
 * Every section refuses people without its platform.* action (contracts.md section 9):
 * an allow and a deny case per action, plus the sidebar showing only allowed sections.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import type { Actor } from "@/server/authz/engine";
import { navFor } from "@/modules/zinny-team-panel/lib/access";
import { analytics } from "@/modules/zinny-team-panel/services/analytics";
import { listInvoices } from "@/modules/zinny-team-panel/services/billing";
import { flagCourse, listOpenFlags, markReviewed, reviewQueue } from "@/modules/zinny-team-panel/services/content";
import { listLicences, saveLicence } from "@/modules/zinny-team-panel/services/licences";
import { createPartner, listPartners } from "@/modules/zinny-team-panel/services/partners";
import { activeSessions, activityLog, startSupport } from "@/modules/zinny-team-panel/services/support";
import { inviteMember, listTeam } from "@/modules/zinny-team-panel/services/team";
import { listUniversities, setUniversityStatus } from "@/modules/zinny-team-panel/services/universities";
import { makeUniversity, person, setupCourse } from "../fixtures";
import { licence, team } from "./helpers";

afterAll(closeDb);

let sa: Actor, am: Actor, sup: Actor, qa: Actor, fin: Actor, par: Actor, student: Actor;
let uniId: string;
let courseId: string;

beforeAll(async () => {
  [sa, am, sup, qa, fin, par] = await Promise.all([
    team("Perm Super", "super_admin"),
    team("Perm Manager", "account_manager"),
    team("Perm Support", "support_agent"),
    team("Perm QA", "content_qa"),
    team("Perm Finance", "finance_admin"),
    team("Perm Partners", "partnerships"),
  ]);
  const c = await setupCourse({ name: "Perm U" });
  uniId = c.uni.id;
  courseId = c.course.id;
  student = await (await person("Perm Student", "student", { universityId: uniId })).actor();
});

const denied = /access|Super Admin/;

describe("each section allows its roles and refuses everyone else", () => {
  it("universities: Super Admin and Account Manager only", async () => {
    await expect(listUniversities(am)).resolves.toBeInstanceOf(Array);
    await expect(listUniversities(sa)).resolves.toBeInstanceOf(Array);
    for (const a of [sup, qa, fin, par, student]) await expect(listUniversities(a)).rejects.toThrow(denied);
    const other = await makeUniversity("Perm Suspend");
    await expect(setUniversityStatus(sup, other.id, "suspended", "Ticket 1: unpaid")).rejects.toThrow(denied);
  });

  it("licences: Super Admin, Account Manager and Finance Admin", async () => {
    for (const a of [sa, am, fin]) await expect(listLicences(a)).resolves.toBeInstanceOf(Array);
    for (const a of [sup, qa, par, student]) await expect(listLicences(a)).rejects.toThrow(denied);
    await expect(saveLicence(sup, uniId, licence())).rejects.toThrow(denied);
  });

  it("support mode: Super Admin and Support Agent; Content QA can't enter", async () => {
    await expect(activeSessions(sup)).resolves.toBeInstanceOf(Array);
    await expect(activityLog(sa, { scope: "support" })).resolves.toBeTruthy();
    await expect(startSupport(qa, uniId, "Ticket 2: look around")).rejects.toThrow(denied);
    for (const a of [am, fin, par, student]) await expect(activityLog(a, { scope: "all" })).rejects.toThrow(denied);
  });

  it("content review: Content QA reviews; Account Managers only read the flags", async () => {
    await expect(reviewQueue(qa, "to-review")).resolves.toBeTruthy();
    await expect(markReviewed(qa, courseId)).resolves.toBeTruthy();
    await expect(listOpenFlags(am)).resolves.toBeInstanceOf(Array);
    await expect(flagCourse(am, courseId, { category: "quality", note: "Account managers can't flag courses." })).rejects.toThrow(denied);
    for (const a of [sup, fin, par, student]) await expect(reviewQueue(a, "flagged")).rejects.toThrow(denied);
  });

  it("partners: Super Admin and Partnerships", async () => {
    await expect(listPartners(par)).resolves.toBeTruthy();
    await expect(createPartner(sa, { name: "Perm Sponsor", kind: "sponsor", status: "prospect" })).resolves.toBeTruthy();
    for (const a of [am, sup, qa, fin, student]) await expect(listPartners(a)).rejects.toThrow(denied);
  });

  it("Zinny billing: Super Admin and Finance Admin; Support Agent can't open it", async () => {
    for (const a of [sa, fin]) await expect(listInvoices(a)).resolves.toBeTruthy();
    for (const a of [sup, am, qa, par, student]) await expect(listInvoices(a)).rejects.toThrow(denied);
  });

  it("analytics: Super Admin, Account Manager and Support Agent", async () => {
    for (const a of [sa, am, sup]) await expect(analytics(a)).resolves.toBeTruthy();
    for (const a of [qa, fin, par, student]) await expect(analytics(a)).rejects.toThrow(denied);
  });

  it("team: Super Admin only", async () => {
    await expect(listTeam(sa)).resolves.toBeInstanceOf(Array);
    for (const a of [am, sup, qa, fin, par, student]) await expect(listTeam(a)).rejects.toThrow(denied);
    await expect(inviteMember(am, { name: "Nope", email: "nope@zinny.test", role: "support_agent" })).rejects.toThrow(denied);
  });
});

describe("the sidebar shows only the sections a person's roles allow", () => {
  const keys = (a: Actor) => navFor(a).map((s) => s.key);
  it("per role", () => {
    expect(keys(sa)).toEqual(["overview", "universities", "support", "content", "partners", "billing", "analytics", "team"]);
    expect(keys(sup)).toEqual(["overview", "support", "analytics"]);
    expect(keys(qa)).toEqual(["overview", "content"]);
    expect(keys(fin)).toEqual(["overview", "universities", "billing"]);
    expect(navFor(fin).find((s) => s.key === "universities")!.items.map((i) => i.label)).toEqual(["Licences"]);
    expect(keys(am)).toEqual(["overview", "universities", "content", "analytics"]);
    expect(navFor(am).find((s) => s.key === "content")!.access).toBe("View");
    expect(keys(par)).toEqual(["overview", "partners"]);
    expect(keys(student)).toEqual([]);
  });
});
