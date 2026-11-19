import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import type { Actor } from "@/server/authz/engine";
import { overview } from "@/modules/zinny-team-panel/services/analytics";
import { presetRange } from "@/components/date-range";
import { licencesEndingSoon, ownLicenceReminder, searchUniversities } from "@/modules/zinny-team-panel/services/universities";
import { saveLicence } from "@/modules/zinny-team-panel/services/licences";
import { person, setupCourse } from "../fixtures";
import { licence, team } from "../zinny-team-panel/helpers";

afterAll(closeDb);

let sa: Actor, am: Actor, sup: Actor, owner: Actor, student: Actor;
let uniId: string;
const TODAY = "2026-11-19";
const denied = /access|Super Admin|permission/i;

beforeAll(async () => {
  [sa, am, sup] = await Promise.all([team("PUI Super", "super_admin"), team("PUI Manager", "account_manager"), team("PUI Support", "support_agent")]);
  const c = await setupCourse({ name: "Zebra Ending Institute" });
  uniId = c.uni.id;
  owner = await (await person("PUI Owner", "institute_admin", { universityId: uniId })).actor();
  student = await (await person("PUI Student", "student", { universityId: uniId })).actor();
  await saveLicence(sa, uniId, licence({ startDate: "2026-01-01", endDate: "2026-11-24" }));
});

describe("search", () => {
  it("finds an institute by name for permitted roles", async () => {
    const hits = await searchUniversities(am, "zebra end");
    expect(hits.some((h) => h.id === uniId)).toBe(true);
    expect(await searchUniversities(sa, "   ")).toEqual([]);
  });
  it("refuses roles without manage_universities", async () => {
    await expect(searchUniversities(sup, "zebra")).rejects.toThrow(denied);
    await expect(searchUniversities(student, "zebra")).rejects.toThrow(denied);
  });
});

describe("licences ending soon", () => {
  it("lists the institute with days left for finance/super admin", async () => {
    const rows = await licencesEndingSoon(sa, 30, TODAY);
    const r = rows.find((x) => x.universityId === uniId);
    expect(r?.daysLeft).toBe(5);
    expect(r?.level.threshold).toBe(7);
  });
  it("is refused to support and students", async () => {
    await expect(licencesEndingSoon(sup)).rejects.toThrow(denied);
    await expect(licencesEndingSoon(student)).rejects.toThrow(denied);
  });
});

describe("own licence reminder", () => {
  it("shows to the owner", async () => {
    const r = await ownLicenceReminder(owner, uniId, TODAY);
    expect(r?.daysLeft).toBe(5);
  });
  it("is refused to a student", async () => {
    await expect(ownLicenceReminder(student, uniId)).rejects.toThrow(denied);
  });
});

describe("overview", () => {
  it("allows analytics viewers and refuses others", async () => {
    const o = await overview(sa, presetRange("this-year", "2026-11-19"));
    expect(o).toBeTruthy();
    await expect(overview(student, presetRange("today", "2026-11-19"))).rejects.toThrow(denied);
  });
});
