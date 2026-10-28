import { sql } from "drizzle-orm";
import { appDb, type Tx } from "@/db/client";
import { auditLog } from "@/db/schema";
import type { Actor } from "./authz/engine";
import { ForbiddenError } from "./errors";

/**
 * Runs `fn` in a transaction that can only see the actor's university.
 * Row-level security in Postgres enforces this even if a query forgets a filter.
 */
export async function withTenant<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const universityId = actor.universityId;
  if (!universityId) throw new ForbiddenError("No university selected.");
  return appDb().transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.university_id', ${universityId}, true), set_config('app.user_id', ${actor.userId}, true)`,
    );
    return fn(tx);
  });
}

/** Every change is logged. Support-mode changes carry the support session, so they show who, what and when. */
export async function audit(
  tx: Tx,
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
) {
  await tx.insert(auditLog).values({
    universityId: actor.universityId,
    actorUserId: actor.userId || null,
    supportSessionId: actor.supportSessionId,
    action,
    entity,
    entityId,
    data,
  });
}
