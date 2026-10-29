/**
 * The university's choice of how student names show to other students on leaderboards
 * (brief: "Must have" 5). Staff always see full names.
 */
import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, audit, withTenant, type Actor } from "@/server/core";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { holdsAnywhere, uni } from "./scope";
import { gamSettings, type NameDisplay } from "./schema";

export const NAME_DISPLAYS: { key: NameDisplay; label: string; example: string }[] = [
  { key: "first_initial", label: "First name and initial", example: "Riya S." },
  { key: "full", label: "Full name", example: "Riya Sharma" },
];

/** Inside a tenant transaction. Defaults to first name and initial. */
export async function nameDisplayIn(tx: Tx): Promise<NameDisplay> {
  const [row] = await tx.select({ v: gamSettings.nameDisplay }).from(gamSettings);
  return row?.v ?? "first_initial";
}

export async function getNameDisplay(actor: Actor): Promise<NameDisplay> {
  if (!holdsAnywhere(actor, "leaderboard.view")) throw new ForbiddenError();
  return withTenant(actor, nameDisplayIn);
}

export async function setNameDisplay(actor: Actor, value: string): Promise<NameDisplay> {
  const u = uni(actor);
  assertCan(actor, "leaderboard.manage", { universityId: u });
  if (value !== "full" && value !== "first_initial") throw new ValidationError("Choose full name, or first name and initial.");
  return withTenant(actor, async (tx) => {
    const before = await nameDisplayIn(tx);
    await tx
      .insert(gamSettings)
      .values({ universityId: u, nameDisplay: value, updatedBy: actor.userId || null })
      .onConflictDoUpdate({ target: gamSettings.universityId, set: { nameDisplay: value, updatedBy: actor.userId || null, updatedAt: new Date() } });
    await audit(tx, actor, "gamification.name_display", "gam_settings", u, { before, after: value });
    const [row] = await tx.select({ v: gamSettings.nameDisplay }).from(gamSettings).where(eq(gamSettings.universityId, u));
    return row.v;
  });
}
