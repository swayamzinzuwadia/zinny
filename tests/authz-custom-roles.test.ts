import { describe, expect, it } from "vitest";
import type { RoleName } from "@/db/schema";
import { INSTITUTE_ABILITIES, PLATFORM_ABILITIES, abilitiesFor, actionsForAbilities, effectiveGrants, isEditableRole, sectionAccess } from "@/server/authz/abilities";
import { abilityOptions, roleSummaries } from "@/server/authz/capabilities";
import { can, canPlatform, reach, type Actor, type Assignment } from "@/server/authz/engine";
import { menuFor } from "@/server/authz/menu";
import { ACTIONS, ROLE_GRANTS } from "@/server/authz/roles";

const UNI = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const DEPT = "33333333-3333-3333-3333-333333333333";

function assignment(role: RoleName, stored: readonly string[] | null, scope: Partial<Assignment> = {}): Assignment {
  const grants = effectiveGrants(role, stored);
  return { role, scopeType: "university", universityId: UNI, departmentId: null, batchId: null, startsAt: new Date(0), endsAt: null, ...(grants ? { grants } : {}), ...scope };
}

const actor = (...assignments: Assignment[]): Actor => ({ userId: "u", name: "N", email: "e", universityId: UNI, assignments, supportSessionId: null });

/** Everything a tampered row might ask for. */
const EVERYTHING = [...ACTIONS];

describe("what can never be given", () => {
  it.each(["custom_institute", "custom_department", "board_owner", "accounts_fees", "hod", "permanent_faculty", "visiting_faculty"] as RoleName[])(
    "%s can't pick up role control, even from a tampered row",
    (role) => {
      const grants = effectiveGrants(role, EVERYTHING)!;
      expect(grants).not.toContain("role.manage");
      expect(grants.filter((a) => a.startsWith("platform."))).toEqual([]);
      if (role !== "hod") expect(grants).not.toContain("user.manage_roles");
    },
  );

  it("offers nothing locked to any role", () => {
    for (const role of ["custom_institute", "custom_department", "hod", "board_owner"] as RoleName[]) {
      expect(abilitiesFor(role).map((a) => a.key)).not.toContain("people.roles");
    }
  });

  it("gives a Head of Department their locked right to add teachers, whatever was saved", () => {
    expect(effectiveGrants("hod", ["course.view"])).toContain("user.manage_roles");
  });

  it("gives institute roles nothing from the Zinny team, and the reverse", () => {
    expect(effectiveGrants("custom_platform", EVERYTHING)!.filter((a) => !a.startsWith("platform."))).toEqual([]);
    expect(effectiveGrants("custom_institute", EVERYTHING)!.filter((a) => a.startsWith("platform."))).toEqual([]);
  });

  it("leaves Institute Admin and Super Admin untouched, whatever a row says", () => {
    for (const role of ["institute_admin", "super_admin", "student", "parent"] as RoleName[]) {
      expect(isEditableRole(role)).toBe(false);
      expect(effectiveGrants(role, [])).toBeUndefined();
    }
    expect(ROLE_GRANTS.institute_admin).toContain("role.manage");
  });

  it("drops actions that don't exist", () => {
    expect(effectiveGrants("custom_institute", ["made.up", "course.view"])).toEqual([...ROLE_GRANTS.custom_institute, "course.view"]);
  });
});

describe("reach", () => {
  it("doesn't offer a department role what only works across the whole institute", () => {
    const keys = abilitiesFor("custom_department").map((a) => a.key);
    expect(keys).toContain("courses.edit");
    for (const k of ["finance.view", "finance.refund", "website.manage", "settings.manage", "people.import", "activity.view"]) expect(keys).not.toContain(k);
    expect(effectiveGrants("custom_department", ["finance.view", "website.manage"])).toEqual(ROLE_GRANTS.custom_department);
  });

  it("doesn't offer a batch role what needs a department", () => {
    const keys = abilitiesFor("visiting_faculty").map((a) => a.key);
    expect(keys).toContain("tests.grade");
    expect(keys).not.toContain("courses.edit");
    expect(keys).not.toContain("batches.delete");
  });
});

describe("a role with nothing saved", () => {
  it("gives a custom role only its basics, so a missing row can never mean more access", () => {
    expect(effectiveGrants("custom_institute", null)).toEqual(ROLE_GRANTS.custom_institute);
    expect(effectiveGrants("custom_platform", null)).toEqual([]);
    expect(ROLE_GRANTS.custom_institute.filter((a) => !a.startsWith("self.") && !a.endsWith(".view"))).toEqual([]);
  });

  it("leaves a built-in role on Zinny's default", () => {
    expect(effectiveGrants("hod", null)).toBeUndefined();
  });
});

describe("the editor", () => {
  const builtIn: RoleName[] = ["board_owner", "accounts_fees", "hod", "permanent_faculty", "visiting_faculty", "account_manager", "content_qa", "finance_admin", "partnerships", "support_agent"];
  const team = new Set<RoleName>(["account_manager", "content_qa", "finance_admin", "partnerships", "support_agent"]);

  it.each(builtIn)("saving %s without changing anything keeps it exactly as it was", (role) => {
    const list = team.has(role) ? PLATFORM_ABILITIES : INSTITUTE_ABILITIES;
    const on = list.filter((a) => !a.locked && a.actions.every((x) => ROLE_GRANTS[role].includes(x))).map((a) => a.key);
    const saved = effectiveGrants(role, actionsForAbilities(role, on))!;
    expect([...saved].sort()).toEqual([...ROLE_GRANTS[role]].sort());
  });

  it("adds what an ability depends on", () => {
    expect(actionsForAbilities("custom_institute", ["finance.refund"]).sort()).toEqual(["finance.refund", "finance.view"]);
    expect(actionsForAbilities("custom_department", ["courses.edit"])).toContain("course.view");
  });

  it("places every option in the permission grid, and offers nothing locked", () => {
    for (const platform of [false, true]) {
      for (const o of abilityOptions(platform)) {
        expect(o.rows.length, o.key).toBeGreaterThan(0);
        expect(o.cols.length, o.key).toBeGreaterThan(0);
      }
      expect(abilityOptions(platform).map((o) => o.key)).not.toContain("people.roles");
    }
  });

  it("posts the same actions whether a joined tick is sent once or twice", () => {
    expect(actionsForAbilities("custom_institute", ["tests.manage", "tests.manage", "courses.view", "courses.view"]).sort()).toEqual(
      actionsForAbilities("custom_institute", ["tests.manage", "courses.view"]).sort(),
    );
  });

  it("ignores abilities it doesn't know or can't offer", () => {
    expect(actionsForAbilities("custom_department", ["finance.view", "nonsense", "people.roles"])).toEqual([]);
  });
});

describe("the engine", () => {
  const custom = (stored: string[]) => assignment("custom_institute", stored);

  it("grants what the role grants, and nothing else", () => {
    const a = actor(custom(["finance.view"]));
    expect(can(a, "finance.view", { universityId: UNI })).toBe(true);
    expect(can(a, "finance.refund", { universityId: UNI })).toBe(false);
    expect(can(a, "user.manage_roles", { universityId: UNI })).toBe(false);
    expect(can(a, "role.manage", { universityId: UNI })).toBe(false);
  });

  it("stays inside the institute", () => {
    expect(can(actor(custom(["finance.view"])), "finance.view", { universityId: OTHER })).toBe(false);
  });

  it("keeps a department role inside its department", () => {
    const a = actor(assignment("custom_department", ["course.update"], { scopeType: "department", departmentId: DEPT }));
    expect(can(a, "course.update", { universityId: UNI, departmentIds: [DEPT] })).toBe(true);
    expect(can(a, "course.update", { universityId: UNI, departmentIds: ["other"] })).toBe(false);
    expect(can(a, "course.update", { universityId: UNI })).toBe(false);
    expect(reach(a, "course.update", UNI)).toMatchObject({ all: false, departmentIds: new Set([DEPT]) });
  });

  it("applies an edit to a built-in role, taking away as well as adding", () => {
    const hod = actor(assignment("hod", actionsForAbilities("hod", ["courses.view"]), { scopeType: "department", departmentId: DEPT }));
    const target = { universityId: UNI, departmentIds: [DEPT] };
    expect(can(hod, "course.view", target)).toBe(true);
    expect(can(hod, "course.delete", target)).toBe(false);
    expect(can(hod, "batch.delete", target)).toBe(false);
  });

  it("keeps a built-in role's default for parts of the panel that aren't built yet", () => {
    // Nobody can tick Marketing or Community today, so saving an edit mustn't take them away.
    const hod = actor(assignment("hod", actionsForAbilities("hod", ["courses.view"]), { scopeType: "department", departmentId: DEPT }));
    expect(can(hod, "marketing.manage", { universityId: UNI, departmentIds: [DEPT] })).toBe(true);
    expect(actionsForAbilities("custom_institute", ["finance.view"])).not.toContain("marketing.manage");
    expect(abilitiesFor("hod").map((a) => a.key)).not.toContain("marketing.manage");
  });

  it("still gives everyone their own profile", () => {
    expect(can(actor(custom(["finance.view"])), "self.profile", { universityId: UNI, ownerUserId: "u" })).toBe(true);
  });

  it("applies a Zinny team role's grants", () => {
    const team = { ...actor(assignment("custom_platform", ["platform.partners"], { scopeType: "platform", universityId: null })), universityId: null };
    expect(canPlatform(team, "platform.partners")).toBe(true);
    expect(canPlatform(team, "platform.finance")).toBe(false);
  });
});

describe("the menu", () => {
  const sections = (a: Actor) => menuFor(a, UNI).map((s) => s.key);

  it("opens only what a custom role grants", () => {
    expect(sections(actor(assignment("custom_institute", ["finance.view"])))).toEqual(["dashboard", "finance"]);
  });

  it("closes a section when an edit takes it away", () => {
    const hod = assignment("hod", actionsForAbilities("hod", ["courses.view"]), { scopeType: "department", departmentId: DEPT });
    expect(sections(actor(hod))).not.toContain("leaderboards");
    expect(sections(actor(hod))).toContain("products");
  });

  it("marks access from what a role can do", () => {
    expect(sectionAccess(actionsForAbilities("custom_institute", ["finance.view"]), "university").finance).toBe("view");
    expect(sectionAccess(actionsForAbilities("custom_institute", ["finance.refund"]), "university").finance).toBe("full");
    expect(sectionAccess(actionsForAbilities("custom_department", ["courses.edit"]), "department").products).toBe("dept");
  });

  it("shows Roles & permissions only to those who can change roles", () => {
    const hrefs = (a: Actor) => menuFor(a, UNI).find((s) => s.key === "users")?.items.map((i) => i.href) ?? [];
    expect(hrefs(actor(assignment("institute_admin", null)))).toContain("/users/roles");
    expect(hrefs(actor(assignment("custom_institute", actionsForAbilities("custom_institute", ["people.import"]))))).not.toContain("/users/roles");
  });
});

describe("the roles page", () => {
  it("shows an institute's edit", () => {
    const rows = [{ id: "e", kind: "hod" as const, name: null, description: "", actions: actionsForAbilities("hod", ["courses.view"]) }];
    const hod = roleSummaries(rows).find((r) => r.key === "hod")!;
    expect(hod.edited).toBe(true);
    expect(hod.on).toEqual(["courses.view"]);
    expect(hod.sections.find((s) => s.key === "leaderboards")?.access).toBeNull();
  });

  it("lists custom roles after the built-in ones, with who holds them", () => {
    const rows = [{ id: "c", kind: "custom_institute" as const, name: "Admissions officer", description: "Handles applications", actions: actionsForAbilities("custom_institute", ["finance.view"]) }];
    const made = roleSummaries(rows, new Map([["c", 4]])).at(-1)!;
    expect(made).toMatchObject({ key: "c", label: "Admissions officer", group: "Custom roles", custom: true, editable: true, holders: 4, readOnly: true, reach: "Whole institute" });
  });

  it("can't offer to edit Institute Admin", () => {
    expect(roleSummaries().find((r) => r.key === "institute_admin")?.editable).toBe(false);
  });
});
