/**
 * Making and changing roles. Institute Admins do this for their own institute, and Super
 * Admins for the Zinny team (universityId null).
 *
 * The rules that keep this safe:
 *  - Only Institute Admins hold role.manage, and it can't be given to any other role.
 *  - Institute Admin and Super Admin can't be changed, so nobody can lock everyone out.
 *  - A role can only be given what abilitiesFor() offers it. Locked actions are never saved,
 *    and effectiveGrants() checks again every time a role is read.
 *  - A role with people in it can't be deleted.
 */
import { and, eq, gt, isNull, isNotNull, or, sql } from "drizzle-orm";
import { systemDb, type Tx } from "@/db/client";
import { customRoles, roleAssignments, type RoleName } from "@/db/schema";
import { CUSTOM_ROLES, actionsForAbilities, effectiveGrants, isEditableRole, isPlatformKind } from "../authz/abilities";
import { platformRoleSummaries, roleSummaries, type RoleRow, type RoleSummary } from "../authz/capabilities";
import { assertCan, can, isActive, type Actor } from "../authz/engine";
import { ROLE_GRANTS, ROLE_LABELS } from "../authz/roles";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { audit, withTenant } from "../tenant";

/** More than this and the list stops being useful. */
const MAX_CUSTOM_ROLES = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isSuperAdmin = (actor: Actor, now = new Date()) => actor.assignments.some((a) => a.scopeType === "platform" && a.role === "super_admin" && isActive(a, now));

function assertManage(actor: Actor, universityId: string | null) {
  if (universityId) assertCan(actor, "role.manage", { universityId });
  else if (!isSuperAdmin(actor)) throw new ForbiddenError("Only a Super Admin can change Zinny team roles.");
}

function inScope<T>(actor: Actor, universityId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return universityId ? withTenant(actor, fn) : systemDb().transaction(fn);
}

const ownedBy = (universityId: string | null) => (universityId ? eq(customRoles.universityId, universityId) : isNull(customRoles.universityId));

/** Everyone holding a role right now. Revoked and ended assignments don't count. */
const heldNow = (now: Date) => and(isNull(roleAssignments.revokedAt), or(isNull(roleAssignments.endsAt), gt(roleAssignments.endsAt, now)));

export async function listRoles(actor: Actor, universityId: string | null): Promise<RoleSummary[]> {
  assertManage(actor, universityId);
  return inScope(actor, universityId, async (tx) => {
    const rows = await tx.select().from(customRoles).where(and(ownedBy(universityId), isNull(customRoles.archivedAt)));
    const held = await tx
      .select({ role: roleAssignments.role, customRoleId: roleAssignments.customRoleId, people: sql<number>`count(distinct ${roleAssignments.userId})`.mapWith(Number) })
      .from(roleAssignments)
      .where(and(universityId ? eq(roleAssignments.universityId, universityId) : eq(roleAssignments.scopeType, "platform"), heldNow(new Date())))
      .groupBy(roleAssignments.role, roleAssignments.customRoleId);
    const holders = new Map(held.map((h) => [h.customRoleId ?? h.role, h.people]));
    const saved: RoleRow[] = rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, description: r.description, actions: r.actions }));
    return universityId ? roleSummaries(saved, holders) : platformRoleSummaries(saved, holders);
  });
}

/** Custom roles that can be given to someone. Empty for anyone who can't give them. */
export async function customRoleChoices(actor: Actor, universityId: string | null) {
  const allowed = universityId ? can(actor, "user.manage_roles", { universityId }) : isSuperAdmin(actor);
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
  if (actions.length === 0) throw new ValidationError("Tick at least one thing this role can do.");
  return actions;
}

async function saveBuiltIn(tx: Tx, actor: Actor, universityId: string | null, role: RoleName, abilities: readonly string[]) {
  const actions = chosenActions(role, abilities);
  const [row] = await tx
    .select()
    .from(customRoles)
    .where(and(ownedBy(universityId), eq(customRoles.kind, role), isNull(customRoles.name)))
    .for("update");
  const before = effectiveGrants(role, row?.actions) ?? ROLE_GRANTS[role];
  const saved = row
    ? (await tx.update(customRoles).set({ actions, updatedAt: new Date() }).where(eq(customRoles.id, row.id)).returning())[0]
    : (await tx.insert(customRoles).values({ universityId, kind: role, actions, createdBy: actor.userId || null }).returning())[0];
  await audit(tx, actor, "role.update", "role", saved.id, { role, ...changes(before, effectiveGrants(role, actions) ?? []) });
  return `${ROLE_LABELS[role]} updated. It applies on each person's next page.`;
}

async function saveCustom(tx: Tx, actor: Actor, universityId: string | null, draft: RoleDraft) {
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
    await audit(tx, actor, "role.update", "role", row.id, { name, ...changes(effectiveGrants(row.kind, row.actions) ?? [], effectiveGrants(row.kind, actions) ?? []) });
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
  const [row] = await tx.insert(customRoles).values({ universityId, kind, name, description, actions, createdBy: actor.userId || null }).returning();
  await audit(tx, actor, "role.create", "role", row.id, { name, kind, actions });
  return `${name} created. Give it to people from Users.`;
}

export async function saveRole(actor: Actor, universityId: string | null, draft: RoleDraft): Promise<string> {
  assertManage(actor, universityId);
  if (draft.role) {
    const role = draft.role as RoleName;
    if (!isEditableRole(role) || CUSTOM_ROLES.has(role) || isPlatformKind(role) !== !universityId) throw new ValidationError("That role can't be changed.");
    return inScope(actor, universityId, (tx) => saveBuiltIn(tx, actor, universityId, role, draft.abilities));
  }
  return inScope(actor, universityId, (tx) => saveCustom(tx, actor, universityId, draft));
}

/** Puts a built-in role back to Zinny's default. */
export async function resetRole(actor: Actor, universityId: string | null, role: string): Promise<string> {
  assertManage(actor, universityId);
  const name = role as RoleName;
  if (!isEditableRole(name) || CUSTOM_ROLES.has(name)) throw new ValidationError("That role can't be changed.");
  return inScope(actor, universityId, async (tx) => {
    const gone = await tx
      .delete(customRoles)
      .where(and(ownedBy(universityId), eq(customRoles.kind, name), isNull(customRoles.name)))
      .returning();
    if (gone[0]) await audit(tx, actor, "role.reset", "role", gone[0].id, { role: name });
    return `${ROLE_LABELS[name]} is back to the Zinny default.`;
  });
}

/** Deletes a custom role that nobody holds. Past assignments keep pointing at it, so it is only marked as gone. */
export async function deleteRole(actor: Actor, universityId: string | null, id: string): Promise<string> {
  assertManage(actor, universityId);
  if (!UUID.test(id)) throw new NotFoundError("Role");
  return inScope(actor, universityId, async (tx) => {
    const [row] = await tx
      .select()
      .from(customRoles)
      .where(and(eq(customRoles.id, id), ownedBy(universityId), isNotNull(customRoles.name), isNull(customRoles.archivedAt)))
      .for("update");
    if (!row) throw new NotFoundError("Role");
    const [{ people }] = await tx
      .select({ people: sql<number>`count(distinct ${roleAssignments.userId})`.mapWith(Number) })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.customRoleId, id), heldNow(new Date())));
    if (people > 0) throw new ConflictError(`${people === 1 ? "1 person has" : `${people} people have`} this role. Move them to another role first.`);
    await tx.update(customRoles).set({ archivedAt: new Date() }).where(eq(customRoles.id, id));
    await audit(tx, actor, "role.delete", "role", id, { name: row.name });
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
