/**
 * Team (Super Admin only): the Zinny team's members and their platform roles. Roles are
 * given and removed through core `grantPlatformRole` and `revokePlatformRole`; a new
 * person gets `user.invited` from core.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { roleAssignments, users } from "@/db/schema";
import { grantPlatformRole, revokePlatformRole, type Actor } from "@/server/core";
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
  roles: { assignmentId: string; role: PlatformRole; since: Date }[];
};

export async function listTeam(actor: Actor): Promise<TeamMember[]> {
  assertSuperAdmin(actor);
  const rows = await db()
    .select({
      assignmentId: roleAssignments.id,
      role: roleAssignments.role,
      since: roleAssignments.startsAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      invited: sql<boolean>`${users.passwordHash} is null`,
    })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(and(eq(roleAssignments.scopeType, "platform"), isNull(roleAssignments.revokedAt)))
    .orderBy(asc(users.name), asc(roleAssignments.createdAt));
  const order = new Map<string, number>(PLATFORM_ROLES.map((r, i) => [r, i]));
  const people = new Map<string, TeamMember>();
  for (const r of rows) {
    if (!isPlatformRole(r.role)) continue;
    const m = people.get(r.userId) ?? { userId: r.userId, name: r.name, email: r.email, invited: r.invited, roles: [] };
    m.roles.push({ assignmentId: r.assignmentId, role: r.role, since: r.since });
    people.set(r.userId, m);
  }
  return [...people.values()].map((m) => ({ ...m, roles: m.roles.sort((a, b) => order.get(a.role)! - order.get(b.role)!) }));
}

async function activeRole(userId: string, role: PlatformRole) {
  const [a] = await db()
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.role, role), eq(roleAssignments.scopeType, "platform"), isNull(roleAssignments.revokedAt)));
  return a ?? null;
}

/** Invites someone to the Zinny team with one role. New people get an invite (`user.invited`). */
export async function inviteMember(actor: Actor, input: { name: string; email: string; role: string }) {
  assertSuperAdmin(actor);
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) throw new ValidationError("Enter the person's name.");
  if (!EMAIL_RE.test(email)) throw new ValidationError("Enter a valid email.");
  if (!isPlatformRole(input.role)) throw new ValidationError("Pick a Zinny team role.");
  const [existing] = await db().select({ id: users.id, name: users.name }).from(users).where(sql`lower(${users.email}) = ${email}`);
  if (existing && (await activeRole(existing.id, input.role))) {
    throw new ConflictError(`${existing.name} is already a ${PLATFORM_ROLE_LABELS[input.role]}.`);
  }
  return grantPlatformRole(actor, { email, name, role: input.role });
}

/** Gives a current team member another role. */
export async function addRole(actor: Actor, userId: string, role: string) {
  assertSuperAdmin(actor);
  if (!isUuid(userId)) throw new NotFoundError("Team member");
  if (!isPlatformRole(role)) throw new ValidationError("Pick a Zinny team role.");
  const [u] = await db().select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw new NotFoundError("Team member");
  const [member] = await db()
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.scopeType, "platform"), isNull(roleAssignments.revokedAt)))
    .limit(1);
  if (!member) throw new ValidationError("This person isn't on the Zinny team. Invite them instead.");
  if (await activeRole(userId, role)) throw new ConflictError(`${u.name} is already a ${PLATFORM_ROLE_LABELS[role]}.`);
  return grantPlatformRole(actor, { email: u.email, name: u.name, role });
}

/** Removes one platform role. Core refuses to remove your own Super Admin role. */
export async function removeRole(actor: Actor, assignmentId: string) {
  assertSuperAdmin(actor);
  if (!isUuid(assignmentId)) throw new NotFoundError("Zinny team role");
  await revokePlatformRole(actor, assignmentId);
}
