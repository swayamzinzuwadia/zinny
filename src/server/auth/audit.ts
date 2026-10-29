/**
 * Security events that happen outside any one university (a password reset, a lockout,
 * signing out everywhere) are written to the audit log of every university the person
 * belongs to, with the person as the actor, so each institute's admins can see them.
 */
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { roleAssignments } from "@/db/schema";
import { audit, systemActorFor, withTenant, type Actor } from "@/server/core";

export async function universitiesOf(userId: string): Promise<string[]> {
  const rows = await systemDb()
    .selectDistinct({ universityId: roleAssignments.universityId })
    .from(roleAssignments)
    .where(and(eq(roleAssignments.userId, userId), isNull(roleAssignments.revokedAt), isNotNull(roleAssignments.universityId)));
  return rows.map((r) => r.universityId!).filter(Boolean);
}

/** The person acting on their own account, inside one university, for the audit log. */
export function personActor(universityId: string, userId: string): Actor {
  return { ...systemActorFor(universityId), userId, name: "", email: "" };
}

export async function auditEverywhere(userId: string, action: string, data: Record<string, unknown> = {}) {
  for (const universityId of await universitiesOf(userId)) {
    try {
      await withTenant(systemActorFor(universityId), (tx) => audit(tx, personActor(universityId, userId), action, "user", userId, data));
    } catch (e) {
      // Logging must never block someone getting into their account.
      console.error(`[identity] couldn't write ${action} to the audit log of ${universityId}:`, e);
    }
  }
}
