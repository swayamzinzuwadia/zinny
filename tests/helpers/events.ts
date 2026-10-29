/**
 * Event helpers for tests (contracts.md section 2).
 *
 *   await emit(tx, actor, "lesson.completed", { … });   // inside your service
 *   await drainEvents();                                 // delivers everything now
 *
 * drainEvents() ignores retry backoff by default, so a handler that failed is tried
 * again on the next call.
 */
import { and, desc, eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { domainEventDeliveries, domainEvents } from "@/db/schema";
import type { EventType } from "@/contracts/events";
import { drainEvents as drain, type DrainOptions } from "@/server/events-drain";

export function drainEvents(opts: DrainOptions = {}) {
  return drain({ retryNow: true, ...opts });
}

/** Events of a type (newest first), optionally for one university. Reads with the owner connection. */
export async function eventsOfType<T extends EventType>(type: T, universityId?: string) {
  return systemDb()
    .select()
    .from(domainEvents)
    .where(and(eq(domainEvents.type, type), universityId ? eq(domainEvents.universityId, universityId) : undefined))
    .orderBy(desc(domainEvents.occurredAt));
}

export async function deliveriesOf(eventId: string) {
  return systemDb().select().from(domainEventDeliveries).where(eq(domainEventDeliveries.eventId, eventId));
}
