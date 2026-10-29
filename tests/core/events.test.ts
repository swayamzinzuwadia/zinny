import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { departments, domainEventDeliveries, domainEvents, notifications } from "@/db/schema";
import { defineHandler, type EventHandler } from "@/contracts/events";
import { systemActorFor } from "@/server/actor";
import { emit } from "@/server/events";
import { MAX_ATTEMPTS } from "@/server/events-drain";
import { withTenant } from "@/server/tenant";
import { drainEvents } from "../helpers/events";
import { makeUniversity, makeUser } from "../fixtures";

let A: { id: string };
let B: { id: string };
let userA: string;
let userB: string;

beforeAll(async () => {
  A = await makeUniversity("Events A");
  B = await makeUniversity("Events B");
  userA = (await makeUser("Event Person A")).id;
  userB = (await makeUser("Event Person B")).id;
});
afterEach(async () => {
  // Each test uses its own handler ids; clearing events keeps the next test's drain small.
  await systemDb().delete(domainEvents);
});
afterAll(closeDb);

const lesson = (userId: string) => ({ userId, courseId: "c1", lessonId: "l1" });

async function emitIn(universityId: string, userId: string) {
  return withTenant(systemActorFor(universityId), (tx) => emit(tx, systemActorFor(universityId), "lesson.completed", lesson(userId)));
}

describe("contracts section 2: event delivery", () => {
  it("an event is written in the caller's transaction and disappears if it rolls back", async () => {
    const actor = systemActorFor(A.id);
    await expect(
      withTenant(actor, async (tx) => {
        await emit(tx, actor, "lesson.completed", lesson(userA));
        throw new Error("change failed");
      }),
    ).rejects.toThrow("change failed");
    const rows = await systemDb()
      .select()
      .from(domainEvents)
      .where(and(eq(domainEvents.universityId, A.id), eq(domainEvents.type, "lesson.completed")));
    expect(rows).toHaveLength(0);
  });

  it("delivers once per handler even when drainEvents runs twice", async () => {
    const seen: string[] = [];
    const h = defineHandler({ id: "test.once", on: ["lesson.completed"], handle: async ({ event }) => void seen.push(event.id) });
    const id = await emitIn(A.id, userA);
    const first = await drainEvents({ handlers: [h] });
    const second = await drainEvents({ handlers: [h] });
    expect(seen).toEqual([id]);
    expect(first.delivered).toBe(1);
    expect(second.delivered).toBe(0);
    const [d] = await systemDb().select().from(domainEventDeliveries).where(eq(domainEventDeliveries.eventId, id));
    expect(d).toMatchObject({ handlerId: "test.once", attempts: 1, lastError: null });
    expect(d.deliveredAt).toBeInstanceOf(Date);
  });

  it("two drains running at the same time still deliver each pair once", async () => {
    let calls = 0;
    const h = defineHandler({
      id: "test.concurrent",
      on: ["lesson.completed"],
      handle: async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 50));
      },
    });
    for (let i = 0; i < 3; i++) await emitIn(A.id, userA);
    await Promise.all([drainEvents({ handlers: [h] }), drainEvents({ handlers: [h] })]);
    expect(calls).toBe(3);
  });

  it("a failing handler doesn't block other handlers, and its work is rolled back", async () => {
    const ok: string[] = [];
    const failing = defineHandler({
      id: "test.failing",
      on: ["lesson.completed"],
      handle: async ({ tx, event }) => {
        await tx.insert(departments).values({ universityId: event.universityId!, code: "ROLLBACK", name: "Should not stay" });
        throw new Error("boom");
      },
    });
    const good = defineHandler({ id: "test.good", on: ["lesson.completed"], handle: async ({ event }) => void ok.push(event.id) });
    const id = await emitIn(A.id, userA);
    const res = await drainEvents({ handlers: [failing, good] });
    expect(ok).toEqual([id]);
    expect(res).toMatchObject({ delivered: 1, failed: 1 });
    const [d] = await systemDb()
      .select()
      .from(domainEventDeliveries)
      .where(and(eq(domainEventDeliveries.eventId, id), eq(domainEventDeliveries.handlerId, "test.failing")));
    expect(d).toMatchObject({ attempts: 1, deliveredAt: null, lastError: "boom" });
    expect(d.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    const leftovers = await systemDb().select().from(departments).where(eq(departments.code, "ROLLBACK"));
    expect(leftovers).toHaveLength(0);
  });

  it("waits for the backoff before retrying, and gives up after 10 attempts", async () => {
    let calls = 0;
    const h = defineHandler({
      id: "test.flaky",
      on: ["lesson.completed"],
      handle: async () => {
        calls++;
        throw new Error("down");
      },
    });
    await emitIn(A.id, userA);
    const { drainEvents: drainRespectingBackoff } = await import("@/server/events-drain");
    await drainRespectingBackoff({ handlers: [h] });
    await drainRespectingBackoff({ handlers: [h] }); // still inside the backoff window
    expect(calls).toBe(1);
    for (let i = 0; i < MAX_ATTEMPTS + 3; i++) await drainEvents({ handlers: [h] });
    expect(calls).toBe(MAX_ATTEMPTS);
    const [d] = await systemDb().select().from(domainEventDeliveries).where(eq(domainEventDeliveries.handlerId, "test.flaky"));
    expect(d).toMatchObject({ attempts: MAX_ATTEMPTS, deliveredAt: null, nextAttemptAt: null });
  });

  it("events from university A are delivered under A's tenant only", async () => {
    const seen: { uni: string | null; actorUni: string | null; visibleUniversities: string[] }[] = [];
    const h: EventHandler = defineHandler({
      id: "test.tenant",
      on: ["lesson.completed"],
      handle: async ({ tx, actor, event }) => {
        const rows = await tx.execute<{ university_id: string }>(sql`select distinct university_id from notifications`);
        seen.push({ uni: event.universityId, actorUni: actor.universityId, visibleUniversities: rows.map((r) => r.university_id) });
        // Writing for the other university is refused by row-level security.
        const other = event.universityId === A.id ? B.id : A.id;
        await expect(
          tx.transaction((sp) => sp.insert(notifications).values({ universityId: other, userId: event.payload.userId, kind: "x", title: "x" })),
        ).rejects.toThrow();
        await tx.insert(notifications).values({ universityId: event.universityId!, userId: event.payload.userId, kind: "test.tenant", title: "hi" });
      },
    });
    await emitIn(A.id, userA);
    await emitIn(B.id, userB);
    await drainEvents({ handlers: [h] });
    expect(seen.map((s) => s.uni).sort()).toEqual([A.id, B.id].sort());
    for (const s of seen) {
      expect(s.actorUni).toBe(s.uni);
      expect(s.visibleUniversities.every((u) => u === s.uni)).toBe(true);
    }
  });

  it("drainEvents can be limited to one university", async () => {
    const seen: (string | null)[] = [];
    const h = defineHandler({ id: "test.scoped", on: ["lesson.completed"], handle: async ({ event }) => void seen.push(event.universityId) });
    await emitIn(A.id, userA);
    await emitIn(B.id, userB);
    await drainEvents({ handlers: [h], universityId: B.id });
    expect(seen).toEqual([B.id]);
  });

  it("events emitted by a handler are delivered in the same drain", async () => {
    const xp: string[] = [];
    const award = defineHandler({
      id: "test.award",
      on: ["lesson.completed"],
      handle: async ({ tx, actor, event }) => {
        await emit(tx, actor, "xp.awarded", { userId: event.payload.userId, points: 10, reason: "lesson", sourceEventId: event.id });
      },
    });
    const listen = defineHandler({ id: "test.listen-xp", on: ["xp.awarded"], handle: async ({ event }) => void xp.push(event.payload.sourceEventId) });
    const id = await emitIn(A.id, userA);
    await drainEvents({ handlers: [award, listen] });
    expect(xp).toEqual([id]);
  });

  it("refuses event types that aren't in the catalogue", async () => {
    const actor = systemActorFor(A.id);
    await expect(
      withTenant(actor, (tx) => emit(tx, actor, "made.up" as "lesson.completed", lesson(userA))),
    ).rejects.toThrow(/Unknown event type/);
  });

  it("the app role can't change or delete events", async () => {
    await emitIn(A.id, userA);
    const actor = systemActorFor(A.id);
    await expect(withTenant(actor, (tx) => tx.delete(domainEvents))).rejects.toThrow();
    await expect(withTenant(actor, (tx) => tx.update(domainEvents).set({ type: "x" }))).rejects.toThrow();
  });
});
