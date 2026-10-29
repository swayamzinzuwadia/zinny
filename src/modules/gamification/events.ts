/**
 * Event handlers (contracts.md section 2). Gamification never calls other modules:
 * everything it reacts to arrives here.
 *
 *   gamification.award-xp       learning events → activity, XP (then xp.awarded), badges
 *   gamification.follow-switch  enrolment.switched → XP and progress follow the student's new batch
 *
 * Delivery is at least once; both handlers are idempotent (see engine.ts).
 */
import { defineHandler, type DomainEvent, type EventHandler } from "@/contracts/events";
import { SOURCE_EVENTS } from "./catalog";
import { followSwitch, processEvent } from "./engine";

export const handlers: EventHandler[] = [
  defineHandler({
    id: "gamification.award-xp",
    on: SOURCE_EVENTS,
    handle: async ({ tx, actor, event }) => {
      if (!event.universityId) return;
      await processEvent(tx, actor, event as DomainEvent);
    },
  }),
  defineHandler({
    id: "gamification.follow-switch",
    on: ["enrolment.switched"],
    handle: async ({ tx, actor, event }) => {
      if (!event.universityId) return;
      await followSwitch(tx, actor, event);
    },
  }),
];
