/**
 * Who may do what with personal data.
 *  - A person always acts on their own records: inside an institute that is `self.profile` on
 *    their own record; outside any institute (a marketplace learner, someone who signed an
 *    institute up) being signed in is enough, and every query is limited to their user id and
 *    to Zinny's own rows.
 *  - An institute's requests, consents and retention: `privacy.manage` (Institute Admin).
 *  - Zinny's own requests and the breach register: `platform.manage_universities`
 *    (Super Admin and Account Managers, the Zinny privacy desk).
 */
import { assertCan, assertPlatform, canPlatform, todayFor, todayIn, type Actor } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import type { Tx } from "@/db/client";

export type Self = { userId: string; universityId: string | null };

export function selfOf(actor: Actor): Self {
  if (!actor.userId) throw new ForbiddenError("Sign in to see your privacy settings.");
  if (actor.universityId) assertCan(actor, "self.profile", { universityId: actor.universityId, ownerUserId: actor.userId });
  return { userId: actor.userId, universityId: actor.universityId };
}

export function assertHandler(actor: Actor): string {
  if (!actor.universityId) throw new ForbiddenError("No institute selected.");
  assertCan(actor, "privacy.manage", { universityId: actor.universityId });
  return actor.universityId;
}

export const PLATFORM_PRIVACY = "platform.manage_universities" as const;

export function assertPlatformPrivacy(actor: Actor) {
  assertPlatform(actor, PLATFORM_PRIVACY);
}

export function canPlatformPrivacy(actor: Actor) {
  return canPlatform(actor, PLATFORM_PRIVACY);
}

/** Today in the institute's time zone, or India's for Zinny's own records. */
export async function todayOf(tx: Tx | null): Promise<string> {
  return tx ? todayFor(tx) : todayIn("Asia/Kolkata");
}
