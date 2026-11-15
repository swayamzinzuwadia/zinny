/**
 * Making and changing roles, in one of three places (a "role scope"):
 *  - an institute (its id): its Institute Admins, or any Super Admin from the Zinny panel;
 *  - the Zinny team (null): Super Admins only;
 *  - Zinny-wide defaults (ZINNY_DEFAULTS): Super Admins only. A change here applies to a
 *    built-in role at every institute that hasn't changed that role itself.
 *
 * The rules that keep this safe:
 *  - role.manage and user.manage_roles are never switchable, so whoever holds Institute Admin
 *    can always put the rest right. Only a Super Admin may change the Institute Admin role.
 *  - Super Admin can't be changed, so Zinny always has someone who can fix anything else.
 *  - A role can only be given what abilitiesFor() offers it. Locked actions are never saved,
 *    and effectiveGrants() checks again every time a role is read.
 *  - A role with people in it can't be deleted.
 */
import { and, eq, gt, inArray, isNull, isNotNull, ne, or, sql } from "drizzle-orm";
import { systemDb, type Tx } from "@/db/client";
import { customRoles, roleAssignments, type RoleName } from "@/db/schema";
import { CUSTOM_ROLES, actionsForAbilities, effectiveGrants, isEditableRole, isPlatformKind } from "../authz/abilities";
import { INSTITUTE_BUILT_IN, platformRoleSummaries, roleSummaries, type RoleRow, type RoleSummary } from "../authz/capabilities";
import { assertCan, can, isActive, type Actor } from "../authz/engine";
import { ROLE_GRANTS, ROLE_LABELS } from "../authz/roles";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { audit, withTenant } from "../tenant";

/** More than this and the list stops being useful. */
const MAX_CUSTOM_ROLES = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The role scope for the built-in institute roles' Zinny-wide defaults. */
export const ZINNY_DEFAULTS = "zinny-defaults";
/** An institute's id, null for the Zinny team, or ZINNY_DEFAULTS. */
export type RoleScope = string | null;

const isDefaults = (scope: RoleScope) => scope === ZINNY_DEFAULTS;
/** The institute a scope is about, or null for the Zinny team and the defaults. */
const instituteOf = (scope: RoleScope) => (scope && scope !== ZINNY_DEFAULTS ? scope : null);

export const isSuperAdmin = (actor: Actor, now = new Date()) => actor.assignments.some((a) => a.scopeType === "platform" && a.role === "super_admin" && isActive(a, now));

function assertManage(actor: Actor, scope: RoleScope) {
  const uni = instituteOf(scope);
  if (uni) {
    if (!UUID.test(uni)) throw new NotFoundError("Institute");
    if (!isSuperAdmin(actor)) assertCan(actor, "role.manage", { universityId: uni });
  } else if (!isSuperAdmin(actor)) {
    throw new ForbiddenError(isDefaults(scope) ? "Only a Super Admin can change Zinny-wide role defaults." : "Only a Super Admin can change Zinny team roles.");
  }
}

/**
 * Runs `fn` where this scope's roles live. An Institute Admin in their own institute works
 * under row-level security; a Super Admin from the panel uses the system connection (checked
 * in assertManage). `who` is the actor to log with: its institute is the scope's, so a change
 * lands in that institute's own log.
 */
function inScope<T>(actor: Actor, scope: RoleScope, fn: (tx: Tx, who: Actor) => Promise<T>): Promise<T> {
  const uni = instituteOf(scope);
  const who: Actor = { ...actor, universityId: uni };
  if (uni && actor.universityId === uni && can(actor, "role.manage", { universityId: uni })) return withTenant(who, (tx) => fn(tx, who));
  return systemDb().transaction((tx) => fn(tx, who));
}

/** Rows a scope owns. The team and the defaults both have no institute; they differ by kind. */
function ownedBy(scope: RoleScope) {
  const uni = instituteOf(scope);
  return uni ? eq(customRoles.universityId, uni) : isNull(customRoles.universityId);
}

/** Everyone holding a role right now. Revoked and ended assignments don't count. */
const heldNow = (now: Date) => and(isNull(roleAssignments.revokedAt), or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)));

const asRow = (r: typeof customRoles.$inferSelect): RoleRow => ({ id: r.id, kind: r.kind, name: r.name, description: r.description, actions: r.actions });

/**
 * Zinny-wide changes to the built-in institute roles. Always read on the system connection:
 * they have no institute, so row-level security would hide them from an Institute Admin.
 */
async function defaultEdits(): Promise<RoleRow[]> {
  const rows = await systemDb()
    .select()
    .from(customRoles)
    .where(and(isNull(customRoles.universityId), isNull(customRoles.name), inArray(customRoles.kind, [...INSTITUTE_BUILT_IN])));
  return rows.map(asRow);
}

export async function listRoles(actor: Actor, scope: RoleScope): Promise<RoleSummary[]> {
  assertManage(actor, scope);
  const uni = instituteOf(scope);
  const defaults = isDefaults(scope) || uni ? await defaultEdits() : [];
  const roles = await inScope(actor, scope, async (tx) => {
    const now = new Date();
    if (isDefaults(scope)) {
      const held = await tx
        .select({ role: roleAssignments.role, people: sql<number>`count(distinct ${roleAssignments.userId})`.mapWith(Number) })
        .from(roleAssignments)
        .where(and(ne(roleAssignments.scopeType, "platform"), isNull(roleAssignments.customRoleId), heldNow(now)))
        .groupBy(roleAssignments.role);
      return roleSummaries(defaults, new Map(held.map((h) => [h.role as string, h.people])));
    }
    const rows = await tx.select().from(customRoles).where(and(ownedBy(scope), isNull(customRoles.archivedAt)));
    const held = await tx
      .select({ role: roleAssignments.role, customRoleId: roleAssignments.customRoleId, people: sql<number>`count(distinct ${roleAssignments.userId})`.mapWith(Number) })
      .from(roleAssignments)
      .where(and(uni ? eq(roleAssignments.universityId, uni) : eq(roleAssignments.scopeType, "platform"), heldNow(now)))
      .groupBy(roleAssignments.role, roleAssignments.customRoleId);
    const holders = new Map(held.map((h) => [h.customRoleId ?? h.role, h.people]));
    return uni ? roleSummaries(rows.map(asRow), holders, defaults) : platformRoleSummaries(rows.map(asRow), holders);
  });
  // Only a Super Admin may change Institute Admin, wherever it shows.
  const superAdmin = isSuperAdmin(actor);
  return roles.map((r) => (r.kind === "institute_admin" ? { ...r, editable: superAdmin } : r));
}

/** Custom roles that can be given to someone. Empty for anyone who can't give them. */
export async function customRoleChoices(actor: Actor, universityId: string | null) {
  const allowed = universityId ? can(actor, "user.manage_roles", { universityId }) || isSuperAdmin(actor) : isSuperAdmin(actor);
  if (!allowed) return [];
  return inScope(actor, universityId, (tx) =>
    tx
      .select({ id: customRoles.id, name: customRoles.name, kind: customRoles.kind })
      .from(customRoles)
      .where(and(ownedBy(universityId), isNotNull(customRoles.name), isNull(customRoles.archivedAt)))
      .orderBy(customRoles.name),
  ).then((rows) => rows.map((r) => ({ id: r.id, name: r.name!, kind: r.kind })));
}

/** The custom role a form picked (custom:<id>), or the built-in role it named. */
export function parseRoleChoice(value: string): { role: string; customRoleId: string | null } {
  if (!value.startsWith("custom:")) return { role: value, customRoleId: null };
  const id = value.slice("custom:".length);
  if (!UUID.test(id)) throw new NotFoundError("Role");
  return { role: "", customRoleId: id };
}

export type RoleDraft = {
  /** Set to change a built-in role. */
  role?: string;
  /** Set to change a custom role. */
  id?: string;
  /** For a new custom role: custom_institute, custom_department or custom_platform. */
  kind?: string;
  name?: string;
  description?: string;
  abilities: readonly string[];
};

/** A role form's fields. Everything in it is checked again in saveRole(). */
export function roleDraft(data: FormData): RoleDraft {
  const field = (key: string) => String(data.get(key) ?? "").trim();
  return {
    role: field("role") || undefined,
    id: field("id") || undefined,
    kind: field("kind") || undefined,
    name: field("name"),
    description: field("description"),
    abilities: data.getAll("ability").map(String),
  };
}

function changes(before: readonly string[], after: readonly string[]) {
  const was = new Set(before);
  const now = new Set(after);
  return { added: after.filter((a) => !was.has(a)), removed: before.filter((a) => !now.has(a)) };
}

function chosenActions(role: RoleName, abilities: readonly string[]) {
  const actions = actionsForAbilities(role, abilities);
  if (actions.length === 0) throw new ValidationError("Switch on at least one thing this role can do.");
  return actions;
}

async function saveBuiltIn(tx: Tx, who: Actor, scope: RoleScope, role: RoleName, abilities: readonly string[]) {
  const actions = chosenActions(role, abilities);
  const [row] = await tx
    .select()
    .from(customRoles)
    .where(and(ownedBy(scope), eq(customRoles.kind, role), isNull(customRoles.name)))
    .for("update");
  const before = effectiveGrants(role, row?.actions) ?? ROLE_GRANTS[role];
  const saved = row
    ? (await tx.update(customRoles).set({ actions, updatedAt: new Date() }).where(eq(customRoles.id, row.id)).returning())[0]
    : (await tx.insert(customRoles).values({ universityId: instituteOf(scope), kind: role, actions, createdBy: who.userId || null }).returning())[0];
  await audit(tx, who, "role.update", "role", saved.id, { role, ...(isDefaults(scope) ? { zinnyDefault: true } : {}), ...changes(before, effectiveGrants(role, actions) ?? []) });
  return isDefaults(scope)
    ? `${ROLE_LABELS[role]} updated at every institute that hasn't changed it itself. It applies on each person's next page.`
    : `${ROLE_LABELS[role]} updated. It applies on each person's next page.`;
}

/** A new or changed custom role. `universityId` is the institute, or null for the Zinny team. */
async function saveCustom(tx: Tx, who: Actor, universityId: string | null, draft: RoleDraft) {
  const name = (draft.name ?? "").trim();
  const description = (draft.description ?? "").trim().slice(0, 200);
  if (name.length < 2 || name.length > 40) throw new ValidationError("Give the role a name of 2 to 40 characters.");
  const lower = name.toLowerCase();
  if (Object.values(ROLE_LABELS).some((l) => l.toLowerCase() === lower)) throw new ConflictError(`${name} is already a role. Choose another name.`);

  const [taken] = await tx
    .select({ id: customRoles.id })
    .from(customRoles)
    .where(and(ownedBy(universityId), isNull(customRoles.archivedAt), sql`lower(${customRoles.name}) = ${lower}`));
  if (taken && taken.id !== draft.id) throw new ConflictError(`${name} is already a role. Choose another name.`);

  if (draft.id) {
    if (!UUID.test(draft.id)) throw new NotFoundError("Role");
    const [row] = await tx
      .select()
      .from(customRoles)
      .where(and(eq(customRoles.id, draft.id), ownedBy(universityId), isNotNull(customRoles.name), isNull(customRoles.archivedAt)))
      .for("update");
    if (!row) throw new NotFoundError("Role");
    // A role keeps its kind: moving it would change the reach of everyone already holding it.
    const actions = chosenActions(row.kind, draft.abilities);
    await tx.update(customRoles).set({ name, description, actions, updatedAt: new Date() }).where(eq(customRoles.id, row.id));
    await audit(tx, who, "role.update", "role", row.id, { name, ...changes(effectiveGrants(row.kind, row.actions) ?? [], effectiveGrants(row.kind, actions) ?? []) });
    return `${name} updated. It applies on each person's next page.`;
  }

  const kinds: RoleName[] = universityId ? ["custom_institute", "custom_department"] : ["custom_platform"];
  const kind = draft.kind as RoleName;
  if (!kinds.includes(kind)) throw new ValidationError("Choose how far this role reaches.");
  const actions = chosenActions(kind, draft.abilities);
  const [{ total }] = await tx
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(customRoles)
    .where(and(ownedBy(universityId), isNotNull(customRoles.name), isNull(customRoles.archivedAt)));
  if (total >= MAX_CUSTOM_ROLES) throw new ValidationError(`You can have up to ${MAX_CUSTOM_ROLES} custom roles. Delete one you no longer use.`);
  const [row] = await tx.insert(customRoles).values({ universityId, kind, name, description, actions, createdBy: who.userId || null }).returning();
  await audit(tx, who, "role.create", "role", row.id, { name, kind, actions });
  return `${name} created. Give it to people from Users.`;
}

/** A built-in role that this person may change in this scope. */
function assertChangeable(actor: Actor, scope: RoleScope, role: RoleName) {
  const team = scope === null;
  if (!isEditableRole(role) || CUSTOM_ROLES.has(role) || isPlatformKind(role) !== team) throw new ValidationError("That role can't be changed.");
  if (role === "institute_admin" && !isSuperAdmin(actor)) throw new ForbiddenError("Only a Super Admin can change the Institute Admin role.");
}

export async function saveRole(actor: Actor, scope: RoleScope, draft: RoleDraft): Promise<string> {
  assertManage(actor, scope);
  if (draft.role) {
    const role = draft.role as RoleName;
    assertChangeable(actor, scope, role);
    return inScope(actor, scope, (tx, who) => saveBuiltIn(tx, who, scope, role, draft.abilities));
  }
  if (isDefaults(scope)) throw new ValidationError("Zinny-wide defaults cover the built-in roles. Make custom roles inside an institute.");
  return inScope(actor, scope, (tx, who) => saveCustom(tx, who, instituteOf(scope), draft));
}

/**
 * Puts a built-in role back. At an institute it goes back to the Zinny default (the Zinny-wide
 * one, when a Super Admin has changed that); in the defaults it goes back to Zinny's original.
 */
export async function resetRole(actor: Actor, scope: RoleScope, role: string): Promise<string> {
  assertManage(actor, scope);
  const name = role as RoleName;
  assertChangeable(actor, scope, name);
  return inScope(actor, scope, async (tx, who) => {
    const gone = await tx
      .delete(customRoles)
      .where(and(ownedBy(scope), eq(customRoles.kind, name), isNull(customRoles.name)))
      .returning();
    if (gone[0]) await audit(tx, who, "role.reset", "role", gone[0].id, { role: name, ...(isDefaults(scope) ? { zinnyDefault: true } : {}) });
    return isDefaults(scope)
      ? `${ROLE_LABELS[name]} is back to Zinny's original permissions at every institute that hasn't changed it.`
      : `${ROLE_LABELS[name]} is back to the Zinny default.`;
  });
}

/** Deletes a custom role that nobody holds. Past assignments keep pointing at it, so it is only marked as gone. */
export async function deleteRole(actor: Actor, scope: RoleScope, id: string): Promise<string> {
  assertManage(actor, scope);
  if (!UUID.test(id) || isDefaults(scope)) throw new NotFoundError("Role");
  return inScope(actor, scope, async (tx, who) => {
    const [row] = await tx
      .select()
      .from(customRoles)
      .where(and(eq(customRoles.id, id), ownedBy(scope), isNotNull(customRoles.name), isNull(customRoles.archivedAt)))
      .for("update");
    if (!row) throw new NotFoundError("Role");
    const [{ people }] = await tx
      .select({ people: sql<number>`count(distinct ${roleAssignments.userId})`.mapWith(Number) })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.customRoleId, id), heldNow(new Date())));
    if (people > 0) throw new ConflictError(`${people === 1 ? "1 person has" : `${people} people have`} this role. Move them to another role first.`);
    await tx.update(customRoles).set({ archivedAt: new Date() }).where(eq(customRoles.id, id));
    await audit(tx, who, "role.delete", "role", id, { name: row.name });
    return `${row.name} deleted.`;
  });
}

/**
 * The custom role an assignment should use, locked so it can't be deleted while this runs.
 * Only a role this institute owns is found: row-level security hides everyone else's.
 */
export async function liveCustomRole(tx: Tx, universityId: string | null, id: string) {
  const [row] = await tx
    .select({ id: customRoles.id, kind: customRoles.kind, name: customRoles.name })
    .from(customRoles)
    .where(and(eq(customRoles.id, id), ownedBy(universityId), isNotNull(customRoles.name), isNull(customRoles.archivedAt)))
    .for("share");
  if (!row) throw new NotFoundError("Role");
  return row;
}
