import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { notifications, roleAssignments } from "@/db/schema";
import type { Actor } from "../authz/engine";
import { withTenant } from "../tenant";

export async function notify(
  tx: Tx,
  universityId: string,
  userIds: readonly string[],
  n: { kind: string; title: string; body?: string; data?: Record<string, unknown> },
) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return;
  await tx.insert(notifications).values(
    unique.map((userId) => ({ universityId, userId, kind: n.kind, title: n.title, body: n.body ?? "", data: n.data ?? {} })),
  );
}

/** Everyone who heads a department (for approvals and alerts). */
export async function hodsOf(tx: Tx, departmentId: string): Promise<string[]> {
  const now = new Date();
  const rows = await tx
    .select({ userId: roleAssignments.userId, endsAt: roleAssignments.endsAt })
    .from(roleAssignments)
    .where(
      and(eq(roleAssignments.role, "hod"), eq(roleAssignments.departmentId, departmentId), isNull(roleAssignments.revokedAt)),
    );
  return rows.filter((r) => !r.endsAt || r.endsAt > now).map((r) => r.userId);
}

export async function myNotifications(actor: Actor, limit = 30) {
  return withTenant(actor, (tx) =>
    tx
      .select()
      .from(notifications)
      .where(eq(notifications.userId, actor.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
  );
}

export async function markRead(actor: Actor, ids: string[]) {
  if (ids.length === 0) return;
  await withTenant(actor, (tx) =>
    tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, actor.userId), inArray(notifications.id, ids))),
  );
}
