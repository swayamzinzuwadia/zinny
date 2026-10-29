/**
 * emit(): the transactional outbox (contracts.md section 2).
 *
 *   await emit(tx, actor, "lesson.completed", { userId, courseId, lessonId });
 *
 * The event row is written in the caller's transaction, so it exists only if the change
 * that caused it commits. Delivery to handlers happens after the response (Next `after()`),
 * with GET /api/jobs/events as the safety net. Tests and seeds call drainEvents() directly.
 */
import { after } from "next/server";
import type { Conn } from "@/db/client";
import { domainEvents } from "@/db/schema";
import { EVENT_TYPES, type EventMap, type EventType } from "@/contracts/events";
import type { Actor } from "./authz/engine";

const KNOWN = new Set<string>(EVENT_TYPES);

/** Core-internal: emit for an explicit university (e.g. createUniversity, which runs on the platform). */
export async function emitFor<T extends EventType>(
  tx: Conn,
  universityId: string | null,
  actorUserId: string | null,
  type: T,
  payload: EventMap[T],
): Promise<string> {
  if (!KNOWN.has(type)) throw new Error(`Unknown event type "${type}". Add it to the catalogue in contracts.md first.`);
  const [row] = await tx
    .insert(domainEvents)
    .values({ universityId, type, payload: payload as Record<string, unknown>, actorUserId: actorUserId || null })
    .returning({ id: domainEvents.id });
  scheduleDrain(universityId);
  return row.id;
}

/**
 * Records an event in the caller's transaction, for the actor's university
 * (or as a platform event when the actor works outside any university).
 * Returns the event id.
 */
export async function emit<T extends EventType>(tx: Conn, actor: Actor, type: T, payload: EventMap[T]): Promise<string> {
  return emitFor(tx, actor.universityId, actor.userId || null, type, payload);
}

/** Deliver soon after the current response. Outside a request (tests, scripts) this does nothing. */
function scheduleDrain(universityId: string | null) {
  try {
    after(async () => {
      try {
        const { drainEvents } = await import("./events-drain");
        await drainEvents({ universityId });
      } catch (e) {
        console.error("[events] delivery after response failed; the cron job will retry:", e);
      }
    });
  } catch {
    // Not inside a request: the caller (test, seed or cron) drains explicitly.
  }
}
