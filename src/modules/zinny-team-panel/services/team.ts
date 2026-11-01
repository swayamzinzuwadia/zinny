/**
 * Team (Super Admin only): the Zinny team's members and their platform roles. Roles are
 * given and removed through core `grantPlatformRole` and `revokePlatformRole`; a new
 * person gets `user.invited` from core.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { customRoles, roleAssignments, users } from "@/db/schema";
import { grantPlatformRole, parseRoleChoice, revokePlatformRole, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { assertSuperAdmin } from "../lib/access";
import { isPlatformRole, PLATFORM_ROLE_LABELS, PLATFORM_ROLES, type PlatformRole } from "../lib/constants";
import { db, EMAIL_RE, isUuid } from "./shared";

export type TeamMember = {
  userId: string;
  name: string;
  email: string;
  /** Has not set a password yet. */
  invited: boolean;
  roles: { assignmentId: string; role: PlatformRole; label: string; customRoleId: string | null; since: Date }[];
};

export async function listTeam(actor: Actor): Promise<TeamMember[]> {
  assertSuperAdmin(actor);
  const rows = await db()
    .select({
      assignmentId: roleAssignments.id,
      role: roleAssignments.role,
      customRoleId: roleAssignments.customRoleId,
      customName: customRoles.name,
      since: roleAssignments.startsAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      invited: sql<boolean>`${users.passwordHash} is null`,
    })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .leftJoin(customRoles, eq(customRoles.id, roleAssignments.customRoleId))
    .where(and(eq(roleAssignments.scopeType, "platform"), isNull(roleAssignments.revokedAt)))
    .orderBy(asc(users.name), asc(roleAssignments.createdAt));
  const order = new Map<string, number>(PLATFORM_ROLES.map((r, i) => [r, i]));
  const rank = (role: string) => order.get(role) ?? PLATFORM_ROLES.length;
  const people = new Map<string, TeamMember>();
  for (const r of rows) {
    if (!isPlatformRole(r.role)) continue;
    const m = people.get(r.userId) ?? { userId: r.userId, name: r.name, email: r.email, invited: r.invited, roles: [] };
    m.roles.push({ assignmentId: r.assignmentId, role: r.role, label: r.customName ?? PLATFORM_ROLE_LABELS[r.role], customRoleId: r.customRoleId, since: r.since });
    people.set(r.userId, m);
  }
  return [...people.values()].map((m) => ({ ...m, roles: m.roles.sort((a, b) => rank(a.role) - rank(b.role)) }));
}

async function activeRole(userId: string, role: PlatformRole, customRoleId: string | null) {
  const [a] = await db()
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.role, role),
        customRoleId ? eq(roleAssignments.customRoleId, customRoleId) : isNull(roleAssignments.customRoleId),
        eq(roleAssignments.scopeType, "platform"),
        isNull(roleAssignments.revokedAt),
      ),
    );
  return a ?? null;
}

/** The role a form picked: a built-in role, or a custom one as custom:<id>. */
function pickedRole(value: string): { role: PlatformRole; customRoleId: string | null } {
  const { role, customRoleId } = parseRoleChoice(value);
  if (customRoleId) return { role: "custom_platform", customRoleId };
  if (!isPlatformRole(role)) throw new ValidationError("Pick a Zinny team role.");
  return { role, customRoleId: null };
}

/** Invites someone to the Zinny team with one role. New people get an invite (`user.invited`). */
export async function inviteMember(actor: Actor, input: { name: string; email: string; role: string }) {
  assertSuperAdmin(actor);
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) throw new ValidationError("Enter the person's name.");
  if (!EMAIL_RE.test(email)) throw new ValidationError("Enter a valid email.");
  const picked = pickedRole(input.role);
  const [existing] = await db().select({ id: users.id, name: users.name }).from(users).where(sql`lower(${users.email}) = ${email}`);
  if (existing && (await activeRole(existing.id, picked.role, picked.customRoleId))) {
    throw new ConflictError(`${existing.name} already has that role.`);
  }
  return grantPlatformRole(actor, { email, name, ...picked });
}

/** Gives a current team member another role. */
export async function addRole(actor: Actor, userId: string, role: string) {
  assertSuperAdmin(actor);
  if (!isUuid(userId)) throw new NotFoundError("Team member");
  const picked = pickedRole(role);
  const [u] = await db().select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError("Team member");
  const [member] = await db()
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.scopeType, "platform"), isNull(roleAssignments.revokedAt)))
    .limit(1);
  if (!member) throw new ValidationError("This person isn't on the Zinny team. Invite them instead.");
  if (await activeRole(userId, picked.role, picked.customRoleId)) throw new ConflictError(`${u.name} already has that role.`);
  return grantPlatformRole(actor, { email: u.email, name: u.name, ...picked });
}

/** Removes one platform role. Core refuses to remove your own Super Admin role. */
export async function removeRole(actor: Actor, assignmentId: string) {
  assertSuperAdmin(actor);
  if (!isUuid(assignmentId)) throw new NotFoundError("Zinny team role");
  await revokePlatformRole(actor, assignmentId);
}
