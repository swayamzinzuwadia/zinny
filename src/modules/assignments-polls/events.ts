/** Event handlers (contracts.md section 2). Idempotent: running one twice changes nothing more. */
import { defineHandler, type EventHandler } from "@/contracts/events";
import { followBatchSwitch } from "./service/assignments";

export const handlers: EventHandler[] = [
  defineHandler({
    // Ungraded work moves with a student who switches batch, so the new batch's faculty grade it.
    id: "assignments-polls.follow-batch-switch",
    on: ["enrolment.switched"],
    handle: async ({ tx, event }) => {
      if (!event.universityId) return;
      await followBatchSwitch(tx, event.payload);
    },
  }),
];
