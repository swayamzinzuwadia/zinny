import { and, eq, gt, isNull, or } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { roleAssignments, supportSessions, users } from "@/db/schema";
import type { Actor, Assignment } from "./authz/engine";
import { canPlatform } from "./authz/engine";
import { NotFoundError } from "./errors";

/**
 * Builds the actor for one request: who they are and every role they hold in
 * this university (plus Zinny team roles). Reads through the system connection
 * because it runs before the tenant is set — it is part of sign-in.
 */
export async function loadActor(userId: string, universityId: string | null): Promise<Actor> {
  const db = systemDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new NotFoundError("User");

  const rows = await db
    .select()
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        isNull(roleAssignments.revokedAt),
        universityId
          ? or(eq(roleAssignments.universityId, universityId), eq(roleAssignments.scopeType, "platform"))
          : eq(roleAssignments.scopeType, "platform"),
      ),
    );

  const assignments: Assignment[] = rows.map((r) => ({
    role: r.role,
    scopeType: r.scopeType,
    universityId: r.universityId,
    departmentId: r.departmentId,
    batchId: r.batchId,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
  }));

  const actor: Actor = {
    userId: user.id,
    name: user.name,
    email: user.email,
    universityId,
    assignments,
    supportSessionId: null,
  };

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
