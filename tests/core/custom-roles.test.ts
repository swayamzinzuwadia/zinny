import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, customRoles, roleAssignments } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { can, type Actor } from "@/server/authz/engine";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { grantPlatformRole } from "@/server/services/core-api";
import { customRoleChoices, deleteRole, listRoles, resetRole, saveRole } from "@/server/services/roles";
import { addPerson, assignRole, revokeRole } from "@/server/services/users";
import { makeDepartment, makeUniversity, makeUser, person, uniqueCode } from "../fixtures";
import { expectTenantIsolated } from "../helpers/isolation";

let uniId: string;
let otherId: string;
let deptId: string;
let admin: Actor;
let otherAdmin: Actor;
let hod: Actor;
let hodUserId: string;
let superAdmin: Actor;

beforeAll(async () => {
  uniId = (await makeUniversity("Roles Institute")).id;
  otherId = (await makeUniversity("Other Institute")).id;
  deptId = (await makeDepartment(uniId, uniqueCode(), "Computer Science")).id;
  admin = await (await person("Asha Admin", "institute_admin", { universityId: uniId })).actor();
  otherAdmin = await (await person("Omar Admin", "institute_admin", { universityId: otherId })).actor();
  const h = await person("Hema Head", "hod", { universityId: uniId, departmentId: deptId });
  hod = await h.actor();
  hodUserId = h.user.id;
  superAdmin = await (await person("Zara Zinny", "super_admin", {})).actor();
});
afterAll(closeDb);

async function makeRole(actor: Actor, university: string, name: string, abilities: string[], kind = "custom_institute") {
  await saveRole(actor, university, { name, kind, abilities });
  const [row] = await systemDb().select().from(customRoles).where(and(eq(customRoles.universityId, university), eq(customRoles.name, name)));
  return row;
}

async function holder(role: { id: string }) {
  const u = await makeUser(`Holder ${uniqueCode()}`);
  await assignRole(admin, { userId: u.id, role: "custom_institute", customRoleId: role.id });
  return u;
}

describe("making roles", () => {
  it("gives holders exactly what was ticked, and shows the role's name", async () => {
    const role = await makeRole(admin, uniId, "Fees clerk", ["finance.view"]);
    const u = await holder(role);
    const a = await loadActor(u.id, uniId);
    expect(can(a, "finance.view", { universityId: uniId })).toBe(true);
    expect(can(a, "finance.refund", { universityId: uniId })).toBe(false);
    expect(a.assignments[0].label).toBe("Fees clerk");
  });

  it("logs every change", async () => {
    const role = await makeRole(admin, uniId, "Logged role", ["finance.view"]);
    const rows = await systemDb().select().from(auditLog).where(and(eq(auditLog.entityId, role.id), eq(auditLog.action, "role.create")));
    expect(rows).toHaveLength(1);
  });

  it("refuses a name another role uses, however it is typed", async () => {
    await makeRole(admin, uniId, "Dean", ["finance.view"]);
    await expect(saveRole(admin, uniId, { name: "dean", kind: "custom_institute", abilities: ["finance.view"] })).rejects.toThrow(ConflictError);
    await expect(saveRole(admin, uniId, { name: "Head of Department", kind: "custom_institute", abilities: ["finance.view"] })).rejects.toThrow(ConflictError);
  });

  it("refuses a role that can do nothing", async () => {
    await expect(saveRole(admin, uniId, { name: "Empty", kind: "custom_institute", abilities: [] })).rejects.toThrow(ValidationError);
    await expect(saveRole(admin, uniId, { name: "Empty", kind: "custom_institute", abilities: ["people.roles"] })).rejects.toThrow(ValidationError);
  });

  it("won't let a form pick a real role's kind", async () => {
    await expect(saveRole(admin, uniId, { name: "Sneaky", kind: "institute_admin", abilities: ["finance.view"] })).rejects.toThrow(ValidationError);
    await expect(saveRole(admin, uniId, { name: "Sneaky", kind: "custom_platform", abilities: ["finance.view"] })).rejects.toThrow(ValidationError);
  });
});

describe("who can change roles", () => {
  it("is only the Institute Admin", async () => {
    await expect(saveRole(hod, uniId, { name: "Mine", kind: "custom_institute", abilities: ["finance.view"] })).rejects.toThrow(ForbiddenError);
    await expect(listRoles(hod, uniId)).rejects.toThrow(ForbiddenError);
    await expect(resetRole(hod, uniId, "hod")).rejects.toThrow(ForbiddenError);
  });

  it("isn't an admin of another institute", async () => {
    await expect(saveRole(otherAdmin, uniId, { name: "Theirs", kind: "custom_institute", abilities: ["finance.view"] })).rejects.toThrow(ForbiddenError);
  });

  it("isn't reachable by a custom role, even one with everything ticked", async () => {
    const all = (await listRoles(admin, uniId)).find((r) => r.key === "board_owner")!.on;
    const role = await makeRole(admin, uniId, "Almost admin", [...all, "finance.manage", "finance.refund", "settings.manage", "people.import"]);
    const u = await holder(role);
    const a = await loadActor(u.id, uniId);
    expect(can(a, "role.manage", { universityId: uniId })).toBe(false);
    expect(can(a, "user.manage_roles", { universityId: uniId })).toBe(false);
    await expect(saveRole(a, uniId, { name: "Escalate", kind: "custom_institute", abilities: ["finance.view"] })).rejects.toThrow(ForbiddenError);
    await expect(assignRole(a, { userId: a.userId, role: "institute_admin" })).rejects.toThrow(ForbiddenError);
  });

  it("isn't a Head of Department giving a custom role, even inside their department", async () => {
    const role = await makeRole(admin, uniId, "Dept helper", ["courses.view"], "custom_department");
    await expect(assignRole(hod, { userId: hodUserId, role: "custom_department", customRoleId: role.id, departmentId: deptId })).rejects.toThrow(ForbiddenError);
    expect(await customRoleChoices(hod, uniId)).toEqual([]);
  });
});

describe("editing built-in roles", () => {
  it("takes effect on the holder's next load, and can be reset", async () => {
    const editedHod = await (await person("Harish Head", "hod", { universityId: uniId, departmentId: deptId })).actor();
    const target = { universityId: uniId, departmentIds: [deptId] };
    expect(can(editedHod, "course.delete", target)).toBe(true);

    await saveRole(admin, uniId, { role: "hod", abilities: ["courses.view"] });
    const after = await loadActor(editedHod.userId, uniId);
    expect(can(after, "course.view", target)).toBe(true);
    expect(can(after, "course.delete", target)).toBe(false);
    expect(can(after, "user.manage_roles", target)).toBe(true);

    await resetRole(admin, uniId, "hod");
    expect(can(await loadActor(editedHod.userId, uniId), "course.delete", target)).toBe(true);
  });

  it("only changes this institute's copy of the role", async () => {
    const otherDept = await makeDepartment(otherId, uniqueCode(), "Maths");
    const theirs = await person("Tara Head", "hod", { universityId: otherId, departmentId: otherDept.id });
    await saveRole(admin, uniId, { role: "hod", abilities: ["courses.view"] });
    expect(can(await theirs.actor(), "course.delete", { universityId: otherId, departmentIds: [otherDept.id] })).toBe(true);
    await resetRole(admin, uniId, "hod");
  });

  it("refuses to change Institute Admin, learners or the Zinny team's roles", async () => {
    await expect(saveRole(admin, uniId, { role: "institute_admin", abilities: ["finance.view"] })).rejects.toThrow(ValidationError);
    await expect(saveRole(admin, uniId, { role: "student", abilities: ["finance.view"] })).rejects.toThrow(ValidationError);
    await expect(saveRole(admin, uniId, { role: "support_agent", abilities: ["platform.finance"] })).rejects.toThrow(ValidationError);
  });
});

describe("giving custom roles", () => {
  it("adds a person with one, in the department it is given for", async () => {
    const role = await makeRole(admin, uniId, "Dept coordinator", ["courses.edit"], "custom_department");
    const id = await addPerson(admin, { name: "New Person", email: `${uniqueCode().toLowerCase()}@test.zinny`, role: "custom_department", customRoleId: role.id, departmentId: deptId });
    const a = await loadActor(id, uniId);
    expect(can(a, "course.update", { universityId: uniId, departmentIds: [deptId] })).toBe(true);
    expect(can(a, "course.update", { universityId: uniId, departmentIds: ["00000000-0000-4000-8000-000000000000"] })).toBe(false);
  });

  it("requires a department for a department role", async () => {
    const role = await makeRole(admin, uniId, "Needs dept", ["courses.view"], "custom_department");
    const u = await makeUser("No Dept");
    await expect(assignRole(admin, { userId: u.id, role: "custom_department", customRoleId: role.id })).rejects.toThrow(ValidationError);
  });

  it("won't give a custom kind with no role named", async () => {
    const u = await makeUser("No Role");
    await expect(assignRole(admin, { userId: u.id, role: "custom_institute" })).rejects.toThrow(ValidationError);
  });

  it("can't give another institute's role", async () => {
    const theirs = await makeRole(otherAdmin, otherId, "Their role", ["finance.view"]);
    const u = await makeUser("Cross Tenant");
    await expect(assignRole(admin, { userId: u.id, role: "custom_institute", customRoleId: theirs.id })).rejects.toThrow(NotFoundError);
  });

  it("never lets a row pick up another institute's role", async () => {
    const theirs = await makeRole(otherAdmin, otherId, "Foreign", ["finance.view", "finance.refund"]);
    const u = await makeUser("Forged Row");
    await systemDb().insert(roleAssignments).values({ userId: u.id, role: "custom_institute", customRoleId: theirs.id, scopeType: "university", universityId: uniId });
    const a = await loadActor(u.id, uniId);
    expect(can(a, "finance.view", { universityId: uniId })).toBe(false);
    expect(a.assignments[0].grants).not.toContain("finance.view");
  });
});

describe("deleting custom roles", () => {
  it("refuses while someone holds the role, then works once they don't", async () => {
    const role = await makeRole(admin, uniId, "Short lived", ["finance.view"]);
    const u = await holder(role);
    await expect(deleteRole(admin, uniId, role.id)).rejects.toThrow(ConflictError);

    const [assignment] = await systemDb().select().from(roleAssignments).where(eq(roleAssignments.userId, u.id));
    await revokeRole(admin, assignment.id);
    await deleteRole(admin, uniId, role.id);
    expect((await listRoles(admin, uniId)).some((r) => r.key === role.id)).toBe(false);
  });

  it("frees the name, and a gone role can't be given", async () => {
    const role = await makeRole(admin, uniId, "Reused name", ["finance.view"]);
    await deleteRole(admin, uniId, role.id);
    const u = await makeUser("Too Late");
    await expect(assignRole(admin, { userId: u.id, role: "custom_institute", customRoleId: role.id })).rejects.toThrow(NotFoundError);
    await expect(makeRole(admin, uniId, "Reused name", ["finance.view"])).resolves.toBeTruthy();
  });

  it("leaves anyone still pointing at a gone role with only the basics", async () => {
    const role = await makeRole(admin, uniId, "Vanished", ["finance.view"]);
    await deleteRole(admin, uniId, role.id);
    const u = await makeUser("Left Behind");
    await systemDb().insert(roleAssignments).values({ userId: u.id, role: "custom_institute", customRoleId: role.id, scopeType: "university", universityId: uniId });
    expect(can(await loadActor(u.id, uniId), "finance.view", { universityId: uniId })).toBe(false);
  });
});

describe("the Zinny team", () => {
  it("lets only a Super Admin manage team roles", async () => {
    await expect(saveRole(admin, null, { name: "Nope", kind: "custom_platform", abilities: ["platform.licences"] })).rejects.toThrow(ForbiddenError);
  });

  it("gives a custom team role what was ticked", async () => {
    await saveRole(superAdmin, null, { name: "Licence lead", kind: "custom_platform", abilities: ["platform.licences"] });
    const [role] = await systemDb().select().from(customRoles).where(eq(customRoles.name, "Licence lead"));
    const u = await makeUser("Team Member");
    await grantPlatformRole(superAdmin, { email: u.email, name: u.name, role: "custom_platform", customRoleId: role.id });
    const a = await loadActor(u.id, null);
    expect(a.assignments.some((x) => x.grants?.includes("platform.licences"))).toBe(true);
    expect(a.assignments.some((x) => x.grants?.includes("platform.finance"))).toBe(false);
  });

  it("keeps team roles out of institutes' lists", async () => {
    expect((await customRoleChoices(admin, uniId)).some((c) => c.name === "Licence lead")).toBe(false);
  });

  it("can't touch Super Admin", async () => {
    await expect(saveRole(superAdmin, null, { role: "super_admin", abilities: ["platform.licences"] })).rejects.toThrow(ValidationError);
  });
});

describe("tenant isolation", () => {
  it("keeps one institute's roles from another", async () => {
    await expectTenantIsolated(customRoles, (u) => ({ universityId: u.id, kind: "custom_institute" as const, name: `Iso ${uniqueCode()}`, actions: [] }));
  });
});
