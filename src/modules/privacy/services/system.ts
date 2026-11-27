/**
 * The one place this module touches the system connection.
 *
 * DPDP makes Zinny a Data Fiduciary in its own right for marketplace learners and for the
 * people who sign institutes up. Those records have `university_id` null, which row-level
 * security hides from every tenant, and the breach register has no university at all. So,
 * as the marketplace and the Zinny team panel do, this file uses `systemDb()`, and only:
 *   - for the signed-in person's own rows (always filtered by their user id), or a guardian
 *     link looked up by its token hash;
 *   - for the Zinny team, after `assertPlatform` in the calling service.
 * Everything an institute owns goes through `withTenant`.
 */
import "server-only";
import { systemDb, type Tx } from "@/db/client";
import { audit, type Actor } from "@/server/core";

export function zinny() {
  return systemDb();
}

/** Runs `fn` in a system transaction. */
export function zinnyTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return systemDb().transaction(fn);
}

/** An audit entry for Zinny's own records: the platform log (university null), or the institute's when given. */
export async function zinnyAudit(tx: Tx, actor: Actor, universityId: string | null, action: string, entity: string, entityId: string | null, data: Record<string, unknown> = {}) {
  await audit(tx, { ...actor, universityId, supportSessionId: universityId ? actor.supportSessionId : null }, action, entity, entityId, data);
}
