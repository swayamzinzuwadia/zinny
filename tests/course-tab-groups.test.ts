/**
 * A course's nine tabs are shown as five. Every registered tab must still be reachable, a
 * group with one page left is named for that page, and a tab no group knows keeps its place.
 */
import { describe, expect, it } from "vitest";
import { groupCourseTabs, groupOf, type CourseTab } from "@/app/[uni]/admin/products/courses/[id]/tab-groups";

const t = (key: string, label: string, order: number): CourseTab => ({ key, label, order });
const ALL = [
  t("curriculum", "Curriculum", 100),
  t("batches", "Batches", 150),
  t("marketplace", "Marketplace", 150),
  t("live", "Live classes", 200),
  t("assignments", "Assignments", 300),
  t("polls", "Polls", 310),
  t("tests", "Tests", 400),
  t("certificates", "Certificates", 500),
  t("settings", "Settings", 10_000),
];
const shape = (tabs: CourseTab[]) => groupCourseTabs(tabs).map((g) => `${g.label}: ${g.tabs.map((x) => x.label).join(", ")}`);
const pick = (...keys: string[]) => ALL.filter((x) => keys.includes(x.key));

describe("course tabs, grouped", () => {
  it("someone who can change the course sees five tabs holding all nine pages", () => {
    expect(shape(ALL)).toEqual([
      "Curriculum: Curriculum",
      "Batches: Batches, Live classes",
      "Coursework: Tests, Assignments, Polls",
      "Selling: Marketplace",
      "Settings: Course settings, Certificates",
    ]);
  });
  it("every tab is in exactly one group, whatever a person can open", () => {
    for (const tabs of [ALL, pick("curriculum", "batches", "tests"), pick("batches"), pick("batches", "live", "certificates")]) {
      const keys = groupCourseTabs(tabs).flatMap((g) => g.tabs.map((x) => x.key));
      expect([...keys].sort()).toEqual(tabs.map((x) => x.key).sort());
    }
  });
  it("a group with one page left is named for that page, not for more than is there", () => {
    // Faculty: no Settings tab, but they see certificates; no polls or marketplace.
    expect(shape(pick("curriculum", "batches", "live", "assignments", "certificates"))).toEqual([
      "Curriculum: Curriculum",
      "Batches: Batches, Live classes",
      "Assignments: Assignments",
      "Certificates: Certificates",
    ]);
    // Settings alone keeps its own name; Selling is the name for the marketplace page.
    expect(shape(pick("batches", "settings", "marketplace"))).toEqual(["Batches: Batches", "Selling: Marketplace", "Settings: Course settings"]);
  });
  it("a tab no group knows keeps a tab of its own, before Settings", () => {
    const withNew = [...ALL, t("forum", "Forum", 600), t("notes", "Notes", 550)];
    expect(groupCourseTabs(withNew).map((g) => g.label)).toEqual(["Curriculum", "Batches", "Coursework", "Selling", "Notes", "Forum", "Settings"]);
    expect(groupCourseTabs([...pick("batches"), t("forum", "Forum", 600)]).map((g) => g.label)).toEqual(["Batches", "Forum"]);
  });
  it("finds the group a tab sits in, so old links to ?tab=tests still land", () => {
    const groups = groupCourseTabs(ALL);
    expect(groupOf(groups, "tests")?.key).toBe("coursework");
    expect(groupOf(groups, "live")?.key).toBe("batches");
    expect(groupOf(groups, "certificates")?.key).toBe("settings");
    expect(groupOf(groups, "nowhere")).toBeUndefined();
  });
});
