/**
 * Super Admin control over roles: any institute's roles from the Zinny panel, Zinny-wide
 * defaults for the built-in institute roles, and the Institute Admin role itself.
 */
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { auditLog, customRoles } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { can, type Actor } from "@/server/authz/engine";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { ZINNY_DEFAULTS, deleteRole, listRoles, resetRole, saveRole } from "@/server/services/roles";
import { makeUniversity, person } from "../fixtures";

let uniA: string;
let uniB: string;
let superAdmin: Actor;
let support: Actor;
let adminA: Actor;
let adminAUserId: string;
let boardAUserId: string;
let boardBUserId: string;

beforeAll(async () => {
  uniA = (await makeUniversity("Scope Alpha")).id;
  uniB = (await makeUniversity("Scope Beta")).id;
  superAdmin = await (await person("Sana Super", "super_admin", {})).actor();
  support = await (await person("Sid Support", "support_agent", {})).actor();
  const a = await person("Arun Admin", "institute_admin", { universityId: uniA });
  adminA = await a.actor();
  adminAUserId = a.user.id;
  boardAUserId = (await person("Bina Board", "board_owner", { universityId: uniA })).user.id;
  boardBUserId = (await person("Bilal Board", "board_owner", { universityId: uniB })).user.id;
});

afterAll(async () => {
  // Zinny-wide defaults are shared by every test file: always put them back.
  await systemDb().delete(customRoles).where(and(isNull(customRoles.universityId), isNull(customRoles.name), eq(customRoles.kind, "board_owner")));
  await systemDb().delete(customRoles).where(and(eq(customRoles.universityId, uniA), isNull(customRoles.name)));
  await closeDb();
});

const seesFinance = async (userId: string, uni: string) => can(await loadActor(userId, uni), "finance.view", { universityId: uni });

describe("a Super Admin changing an institute's roles from the panel", () => {
  it("lists and changes them without being part of the institute, and logs it in that institute", async () => {
    const roles = await listRoles(superAdmin, uniA);
    expect(roles.map((r) => r.kind)).toContain("board_owner");

    await saveRole(superAdmin, uniA, { role: "accounts_fees", abilities: ["finance.view"] });
    const [row] = await systemDb()
      .select()
      .from(customRoles)
      .where(and(eq(customRoles.universityId, uniA), eq(customRoles.kind, "accounts_fees"), isNull(customRoles.name)));
    expect(row).toBeDefined();
    const log = await systemDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.universityId, uniA), eq(auditLog.action, "role.update"), eq(auditLog.actorUserId, superAdmin.userId)));
    expect(log.length).toBeGreaterThan(0);
    await resetRole(superAdmin, uniA, "accounts_fees");
  });

  it("makes and deletes a custom role for an institute", async () => {
    await saveRole(superAdmin, uniA, { name: "Panel made", kind: "custom_institute", abilities: ["finance.view"] });
    const made = (await listRoles(superAdmin, uniA)).find((r) => r.label === "Panel made")!;
    expect(made.custom).toBe(true);
    await deleteRole(superAdmin, uniA, made.key);
    expect((await listRoles(superAdmin, uniA)).some((r) => r.label === "Panel made")).toBe(false);
  });

  it("is refused to the rest of the Zinny team and to another institute's admin", async () => {
    await expect(listRoles(support, uniA)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveRole(support, uniA, { role: "hod", abilities: ["courses.view"] })).rejects.toBeInstanceOf(ForbiddenError);
    const otherAdmin = await (await person("Omar Other", "institute_admin", { universityId: uniB })).actor();
    await expect(saveRole(otherAdmin, uniA, { role: "hod", abilities: ["courses.view"] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Zinny-wide defaults", () => {
  it("are for Super Admins only, and cover only built-in institute roles", async () => {
    await expect(listRoles(support, ZINNY_DEFAULTS)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveRole(adminA, ZINNY_DEFAULTS, { role: "board_owner", abilities: [] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(saveRole(superAdmin, ZINNY_DEFAULTS, { name: "Global thing", kind: "custom_institute", abilities: ["finance.view"] })).rejects.toBeInstanceOf(ValidationError);
    await expect(saveRole(superAdmin, ZINNY_DEFAULTS, { role: "support_agent", abilities: ["platform.finance"] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("apply at every institute that hasn't changed the role, and an institute's own change wins", async () => {
    expect(await seesFinance(boardAUserId, uniA)).toBe(true);
    expect(await seesFinance(boardBUserId, uniB)).toBe(true);

    // Everywhere: Board / Owner no longer sees finance.
    await saveRole(superAdmin, ZINNY_DEFAULTS, { role: "board_owner", abilities: ["courses.view"] });
    expect(await seesFinance(boardAUserId, uniA)).toBe(false);
    expect(await seesFinance(boardBUserId, uniB)).toBe(false);
    expect((await listRoles(superAdmin, ZINNY_DEFAULTS)).find((r) => r.kind === "board_owner")?.edited).toBe(true);
    expect((await listRoles(superAdmin, uniB)).find((r) => r.kind === "board_owner")).toMatchObject({ edited: false, zinnyDefault: true });

    // Institute A puts finance back for itself only.
    await saveRole(superAdmin, uniA, { role: "board_owner", abilities: ["courses.view", "finance.view"] });
    expect(await seesFinance(boardAUserId, uniA)).toBe(true);
    expect(await seesFinance(boardBUserId, uniB)).toBe(false);

    // Resetting the default puts everyone else back to Zinny's original.
    await resetRole(superAdmin, ZINNY_DEFAULTS, "board_owner");
    expect(await seesFinance(boardBUserId, uniB)).toBe(true);
    await resetRole(superAdmin, uniA, "board_owner");
  });
});

describe("the Institute Admin role", () => {
  it("can be changed by a Super Admin but not by an Institute Admin", async () => {
    await expect(saveRole(adminA, uniA, { role: "institute_admin", abilities: ["finance.view"] })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listRoles(adminA, uniA)).find((r) => r.kind === "institute_admin")?.editable).toBe(false);
    expect((await listRoles(superAdmin, uniA)).find((r) => r.kind === "institute_admin")?.editable).toBe(true);
  });

  it("always keeps changing roles and people, so an institute can't lock itself out", async () => {
    await saveRole(superAdmin, uniA, { role: "institute_admin", abilities: ["courses.view"] });
    const a = await loadActor(adminAUserId, uniA);
    expect(can(a, "finance.view", { universityId: uniA })).toBe(false);
    expect(can(a, "role.manage", { universityId: uniA })).toBe(true);
    expect(can(a, "user.manage_roles", { universityId: uniA })).toBe(true);
    await resetRole(superAdmin, uniA, "institute_admin");
    expect(can(await loadActor(adminAUserId, uniA), "finance.view", { universityId: uniA })).toBe(true);
  });
});
