import { describe, expect, it } from "vitest";
import { roleSummaries } from "@/server/authz/capabilities";

const role = (key: string) => roleSummaries().find((r) => r.key === key)!;
const section = (roleKey: string, key: string) => role(roleKey).sections.find((s) => s.key === key)!;
const can = (roleKey: string, key: string) =>
  section(roleKey, key)
    .abilities.filter((a) => a.can)
    .map((a) => a.label);

describe("roles and permissions page data", () => {
  it("lists the six admin panel roles", () => {
    expect(roleSummaries().map((r) => r.key)).toEqual(["institute_admin", "board_owner", "accounts_fees", "hod", "permanent_faculty", "visiting_faculty"]);
  });

  it("shows an Institute Admin everything in every section", () => {
    const admin = role("institute_admin");
    expect(admin.readOnly).toBe(false);
    expect(admin.sections.every((s) => s.access === "full" && s.abilities.every((a) => a.can))).toBe(true);
  });

  it("marks Board / Owner as read only, because no grant changes anything", () => {
    expect(role("board_owner").readOnly).toBe(true);
    expect(can("board_owner", "finance")).toEqual(["View sales and reports"]);
  });

  it("keeps Accounts & Fees to money", () => {
    expect(can("accounts_fees", "finance")).toHaveLength(3);
    expect(section("accounts_fees", "products").access).toBeNull();
    expect(section("accounts_fees", "products").abilities).toEqual([]);
  });

  it("lets a Head of Department run their department's courses but not touch finance", () => {
    expect(section("hod", "products").access).toBe("dept");
    expect(can("hod", "products")).toContain("Delete courses");
    expect(can("hod", "users")).toContain("Add teachers in their department");
    expect(section("hod", "finance").access).toBeNull();
  });

  it("gives faculty teaching work but not course editing", () => {
    const abilities = can("visiting_faculty", "products");
    expect(abilities).toContain("Grade tests");
    expect(abilities).not.toContain("Create and edit courses");
    expect(section("visiting_faculty", "community").access).toBeNull();
    expect(can("permanent_faculty", "community")).toContain("Manage the community");
  });

  it("says where each ability sits in the permission grid", () => {
    const products = section("hod", "products").abilities;
    expect(products.find((a) => a.key === "courses.view")).toMatchObject({ rows: ["Courses", "Batches"], cols: ["view"], can: true });
    expect(products.find((a) => a.key === "tests.manage")).toMatchObject({ rows: ["Tests"], cols: ["edit", "delete"] });
    expect(section("hod", "users").abilities.find((a) => a.key === "people.roles")).toMatchObject({ rows: ["People"], cols: ["edit"], locked: true, can: true });
    expect(section("board_owner", "finance").abilities.find((a) => a.key === "finance.refund")).toMatchObject({ rows: ["Refunds"], cols: ["edit"], can: false });
  });

  it("never lists an open section with nothing the role can do in it", () => {
    for (const r of roleSummaries()) {
      for (const s of r.sections) if (s.access) expect(s.abilities.some((a) => a.can), `${r.key} / ${s.key}`).toBe(true);
    }
  });
});
