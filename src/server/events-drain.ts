/**
 * drainEvents(): delivers every undelivered (event, handler) pair.
 *
 * - University events are delivered inside withTenant(systemActorFor(universityId)), so a
 *   handler sees and writes only that university's data. Platform events (no university,
 *   e.g. a Zinny team member's invite) run in a system transaction with a platform actor.
 * - The handler runs in a savepoint. Its work and the "delivered" record commit together;
 *   if it throws, its work is rolled back and the failure is recorded instead.
 * - Each pair is locked while it runs (FOR UPDATE SKIP LOCKED), so two drains running at
 *   the same time never deliver the same pair twice.
 * - Failures retry with backoff (30 s, 1 min, 2 min … capped at 1 hour) and stop after
 *   MAX_ATTEMPTS. A failing handler never blocks other handlers or other events.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { systemDb, type Tx } from "@/db/client";
import { domainEventDeliveries, domainEvents } from "@/db/schema";
import type { DomainEvent, EventHandler } from "@/contracts/events";
import { systemActorFor } from "./actor";
import type { Actor } from "./authz/engine";
import { eventHandlers } from "./registry";
import { withTenant } from "./tenant";

export const MAX_ATTEMPTS = 10;
const BATCH = 500;
const MAX_PASSES = 10;

export function backoffMs(attempts: number) {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

/** The actor for platform events: outside any university, no roles. */
export function platformSystemActor(): Actor {
  return { userId: "", name: "Zinny system", email: "system@zinny", universityId: null, assignments: [], supportSessionId: null };
}

export type DrainOptions = {
  /** Only this university's events; null = only platform events; omitted = everything. */
  universityId?: string | null;
  /** Ignore the backoff wait and retry failed pairs now (tests and manual runs). */
  retryNow?: boolean;
  /** Handlers to use instead of the registry's (tests). */
  handlers?: EventHandler[];
};

export type DrainResult = { delivered: number; failed: number; gaveUp: number };

type EventRow = typeof domainEvents.$inferSelect;

/** Pairs still to deliver for one handler, oldest event first. */
async function pendingFor(h: EventHandler, opts: DrainOptions): Promise<EventRow[]> {
  const settled = sql`exists (
    select 1 from ${domainEventDeliveries} d
    where d.event_id = ${domainEvents.id} and d.handler_id = ${h.id}
      and (d.delivered_at is not null or d.attempts >= ${MAX_ATTEMPTS}
           ${opts.retryNow ? sql`` : sql`or d.next_attempt_at > now()`})
  )`;
  return systemDb()
    .select()
    .from(domainEvents)
    .where(
      and(
        inArray(domainEvents.type, [...h.on]),
        opts.universityId === undefined
          ? undefined
          : opts.universityId === null
            ? sql`${domainEvents.universityId} is null`
            : eq(domainEvents.universityId, opts.universityId),
        sql`not ${settled}`,
      ),
    )
    .orderBy(asc(domainEvents.occurredAt), asc(domainEvents.id))
    .limit(BATCH);
}

type Outcome = "delivered" | "failed" | "gave_up" | "skipped";

async function deliverInTx(tx: Tx, actor: Actor, h: EventHandler, e: EventRow, retryNow: boolean): Promise<Outcome> {
  await tx
    .insert(domainEventDeliveries)
    .values({ eventId: e.id, handlerId: h.id, universityId: e.universityId })
    .onConflictDoNothing();
  const [d] = await tx
    .select()
    .from(domainEventDeliveries)
    .where(and(eq(domainEventDeliveries.eventId, e.id), eq(domainEventDeliveries.handlerId, h.id)))
    .for("update", { skipLocked: true });
  // Locked by another drain right now, already delivered, given up, or waiting for its retry time.
  if (!d || d.deliveredAt || d.attempts >= MAX_ATTEMPTS) return "skipped";
  if (!retryNow && d.nextAttemptAt && d.nextAttemptAt > new Date()) return "skipped";

  const event = {
    id: e.id,
    universityId: e.universityId,
    type: e.type,
    payload: e.payload,
    actorUserId: e.actorUserId,
    occurredAt: e.occurredAt,
  } as DomainEvent;

  const attempts = d.attempts + 1;
  try {
    // Savepoint: if the handler throws, only its own work is rolled back.
    await tx.transaction((sp) => h.handle({ tx: sp, actor, event }));
    await tx
      .update(domainEventDeliveries)
      .set({ deliveredAt: new Date(), attempts, lastError: null, nextAttemptAt: null })
      .where(and(eq(domainEventDeliveries.eventId, e.id), eq(domainEventDeliveries.handlerId, h.id)));
    return "delivered";
  } catch (err) {
    const message = err instanceof Error ? `${err.message}${err.cause instanceof Error ? ` (${err.cause.message})` : ""}` : String(err);
    const gaveUp = attempts >= MAX_ATTEMPTS;
    await tx
      .update(domainEventDeliveries)
      .set({ attempts, lastError: message.slice(0, 2000), nextAttemptAt: gaveUp ? null : new Date(Date.now() + backoffMs(attempts)) })
      .where(and(eq(domainEventDeliveries.eventId, e.id), eq(domainEventDeliveries.handlerId, h.id)));
    console.error(`[events] ${h.id} failed on ${e.type} ${e.id} (attempt ${attempts}${gaveUp ? ", giving up" : ""}): ${message}`);
    return gaveUp ? "gave_up" : "failed";
  }
}

async function deliver(h: EventHandler, e: EventRow, retryNow: boolean): Promise<Outcome> {
  if (e.universityId) {
    const actor = systemActorFor(e.universityId);
    return withTenant(actor, (tx) => deliverInTx(tx, actor, h, e, retryNow));
  }
  return systemDb().transaction((tx) => deliverInTx(tx, platformSystemActor(), h, e, retryNow));
}

/** Delivers everything pending, including events that handlers emit while it runs. */
export async function drainEvents(opts: DrainOptions = {}): Promise<DrainResult> {
  const handlers = opts.handlers ?? eventHandlers();
  const result: DrainResult = { delivered: 0, failed: 0, gaveUp: 0 };
  if (handlers.length === 0) return result;

  // Each pair is tried at most once per call. Later passes pick up events that the
  // handlers themselves emitted while this drain was running.
  const tried = new Set<string>();
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const pairs: { h: EventHandler; e: EventRow }[] = [];
    for (const h of handlers) {
      for (const e of await pendingFor(h, opts)) {
        const key = `${e.id}|${h.id}`;
        if (!tried.has(key)) pairs.push({ h, e });
      }
    }
    if (pairs.length === 0) break;
    pairs.sort((a, b) => a.e.occurredAt.getTime() - b.e.occurredAt.getTime() || a.e.id.localeCompare(b.e.id) || a.h.id.localeCompare(b.h.id));

    for (const { h, e } of pairs) {
      tried.add(`${e.id}|${h.id}`);
      const outcome = await deliver(h, e, !!opts.retryNow);
      if (outcome === "delivered") result.delivered++;
      if (outcome === "failed") result.failed++;
      if (outcome === "gave_up") result.gaveUp++;
    }
  }
  return result;
}
