import { defineHandler, type EventHandler } from "@/contracts/events";
import { sendTeamInvite } from "./auth";
import { handleUserInvited } from "./invites";

export const handlers: EventHandler[] = [
  defineHandler({
    id: "identity.send-invite",
    on: ["user.invited"],
    // University invitations run under that university's row-level security; a Zinny team
    // member's invitation (no university) runs in the platform's system transaction.
    handle: async ({ tx, actor, event }) => {
      if (event.universityId) await handleUserInvited(tx, actor, event);
      else await sendTeamInvite(tx, event);
    },
  }),
];
