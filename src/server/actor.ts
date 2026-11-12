import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { customRoles, roleAssignments, supportSessions, users } from "@/db/schema";
import { effectiveGrants } from "./authz/abilities";
import type { Actor, Assignment } from "./authz/engine";
import { canPlatform } from "./authz/engine";
import { NotFoundError } from "./errors";

/** What loadActor needs to know about the session it is building an actor for. */
export type ActorSession = { userId: string; impersonatorUserId: string | null };

/**
 * The session of the request in progress, or null outside one (jobs, scripts, tests).
 * Loaded on demand: the session code needs a request, which this file must work without.
 */
async function requestSession(): Promise<ActorSession | null> {
  try {
    const { currentSession } = await import("./auth/session");
    return await currentSession();
  } catch {
    return null;
  }
}

/** The Super Admin signed in as `userId` in this session, if that is what the session is. */
async function impersonatorOf(userId: string, session: ActorSession | null | undefined): Promise<Actor["impersonatedBy"]> {
  const s = session === undefined ? await requestSession() : session;
  if (!s?.impersonatorUserId || s.userId !== userId) return undefined;
  const [who] = await systemDb().select({ id: users.id, name: users.name }).from(users).where(eq(users.id, s.impersonatorUserId));
  return who ? { userId: who.id, name: who.name } : undefined;
}

/**
 * Builds the actor for one request: who they are and every role they hold in
 * this university (plus Zinny team roles). Reads through the system connection
 * because it runs before the tenant is set — it is part of sign-in.
 *
 * When the request's session is a Super Admin signed in as this person, the actor carries
 * `impersonatedBy`, which `audit` writes into every entry. `opts.session` replaces the
 * request's own session (tests; null means "no session").
 */
export async function loadActor(userId: string, universityId: string | null, opts: { session?: ActorSession | null } = {}): Promise<Actor> {
  const db = systemDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new NotFoundError("User");

  // Each assignment comes with this institute's custom role, or its edit of a built-in role.
  // The university check means a row can never pick up another institute's role.
  const rows = await db
    .select({ assignment: roleAssignments, roleName: customRoles.name, stored: customRoles.actions, archivedAt: customRoles.archivedAt })
    .from(roleAssignments)
    .leftJoin(
      customRoles,
      and(
        sql`${customRoles.universityId} is not distinct from ${roleAssignments.universityId}`,
        or(
          eq(customRoles.id, roleAssignments.customRoleId),
          and(isNull(roleAssignments.customRoleId), isNull(customRoles.name), eq(customRoles.kind, roleAssignments.role)),
        ),
      ),
    )
    .where(
      and(
        eq(roleAssignments.userId, userId),
        isNull(roleAssignments.revokedAt),
        universityId
          ? or(eq(roleAssignments.universityId, universityId), eq(roleAssignments.scopeType, "platform"))
          : eq(roleAssignments.scopeType, "platform"),
      ),
    );

  const assignments: Assignment[] = rows.map(({ assignment: r, roleName, stored, archivedAt }) => {
    const grants = effectiveGrants(r.role, archivedAt ? [] : stored);
    return {
      role: r.role,
      scopeType: r.scopeType,
      universityId: r.universityId,
      departmentId: r.departmentId,
      batchId: r.batchId,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      ...(grants ? { grants } : {}),
      ...(roleName ? { label: roleName } : {}),
    };
  });

  const actor: Actor = {
    userId: user.id,
    name: user.name,
    email: user.email,
    universityId,
    assignments,
    supportSessionId: null,
  };
  const impersonatedBy = await impersonatorOf(userId, opts.session);
  if (impersonatedBy) actor.impersonatedBy = impersonatedBy;

  // Support mode: a Zinny team member with an open session acts as an Institute Admin
  // until the session ends or expires. Everything they do is logged with the session id.
  if (universityId && canPlatform(actor, "platform.support_mode")) {
    const [session] = await db
      .select()
      .from(supportSessions)
      .where(
        and(
          eq(supportSessions.staffUserId, userId),
          eq(supportSessions.universityId, universityId),
          isNull(supportSessions.endedAt),
          gt(supportSessions.expiresAt, new Date()),
        ),
      );
    if (session) {
      actor.supportSessionId = session.id;
      actor.assignments.push({
        role: "institute_admin",
        scopeType: "university",
        universityId,
        departmentId: null,
        batchId: null,
        startsAt: session.startedAt,
        endsAt: session.expiresAt,
      });
    }
  }

  return actor;
}

/**
 * The actor used by payment webhooks and scheduled jobs for one university.
 * It works under row-level security like everyone else, so a job can never
 * touch another university's data. Its log entries have no person attached.
 */
export function systemActorFor(universityId: string): Actor {
  return {
    userId: "",
    name: "Zinny system",
    email: "system@zinny",
    universityId,
    supportSessionId: null,
    assignments: [
      {
        role: "institute_admin",
        scopeType: "university",
        universityId,
        departmentId: null,
        batchId: null,
        startsAt: new Date(0),
        endsAt: null,
      },
    ],
  };
}
