import { sql } from "drizzle-orm";
import { appDb, type Tx } from "@/db/client";
import { auditLog } from "@/db/schema";
import type { Actor } from "./authz/engine";
import { ForbiddenError } from "./errors";

/** Thrown to end a transaction with a rollback once its result is in hand. */
const DISCARD = new Error("Read-only transaction discarded");

/**
 * Runs `fn` in a transaction that can only see the actor's university.
 * Row-level security in Postgres enforces this even if a query forgets a filter.
 */
export async function withTenant<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const universityId = actor.universityId;
  if (!universityId) throw new ForbiddenError("No university selected.");
  const run = async (tx: Tx) => {
    await tx.execute(
      sql`select set_config('app.university_id', ${universityId}, true), set_config('app.user_id', ${actor.userId}, true)`,
    );
    return fn(tx);
  };
  if (!actor.viewedBy) return appDb().transaction(run);

  // View as student is read only. Pages that write as they open (a lesson recording
  // progress) still work, but whatever they wrote is rolled back, so viewing leaves no trace.
  let result!: T;
  try {
    await appDb().transaction(async (tx) => {
      result = await run(tx);
      throw DISCARD;
    });
  } catch (e) {
    if (e !== DISCARD) throw e;
  }
  return result;
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
