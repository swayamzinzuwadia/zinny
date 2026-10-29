/**
 * certificates handles `enrolment.completed` (contracts.md section 2): issue the course's
 * certificate. Delivery is at least once, so issueOnCompletion is idempotent.
 */
import { defineHandler, type EventHandler } from "@/contracts/events";
import { issueOnCompletion } from "./service/issue";

export const handlers: EventHandler[] = [
  defineHandler({
    id: "certificates.issue-on-completion",
    on: ["enrolment.completed"],
    handle: async ({ tx, actor, event }) => {
      // Zinny team (platform) events have no university and no tenant transaction.
      if (!event.universityId) return;
      await issueOnCompletion(tx, actor, event);
    },
  }),
];
