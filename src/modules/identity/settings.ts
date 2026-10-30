/**
 * A university's sign-in options. Today: phone sign-in on or off (off by default, since it
 * sends SMS, which costs money and needs DLT templates in India).
 */
import { eq } from "drizzle-orm";
import { assertCan, audit, withTenant, type Actor } from "@/server/core";
import { idnSettings } from "./schema";

const uni = (actor: Actor) => actor.universityId!;

export type SignInSettings = { phoneSignIn: boolean; selfSignup: boolean };

/** Anyone in the university can read these (the sign-in screen shows them to everyone). */
export async function getSignInSettings(actor: Actor): Promise<SignInSettings> {
  return withTenant(actor, async (tx) => {
    const [s] = await tx.select().from(idnSettings).where(eq(idnSettings.universityId, uni(actor)));
    return { phoneSignIn: s?.phoneSignIn ?? false, selfSignup: s?.selfSignup ?? true };
  });
}

/** Institute Admins only (`settings.manage`). */
export async function setSelfSignup(actor: Actor, on: boolean) {
  assertCan(actor, "settings.manage", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const now = new Date();
    await tx
      .insert(idnSettings)
      .values({ universityId: uni(actor), selfSignup: on, updatedAt: now, updatedBy: actor.userId || null })
      .onConflictDoUpdate({ target: idnSettings.universityId, set: { selfSignup: on, updatedAt: now, updatedBy: actor.userId || null } });
    await audit(tx, actor, on ? "settings.self_signup_on" : "settings.self_signup_off", "idn_settings", uni(actor));
    return { selfSignup: on };
  });
}

/** Institute Admins only (`settings.manage`). */
export async function setPhoneSignIn(actor: Actor, on: boolean) {
  assertCan(actor, "settings.manage", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const now = new Date();
    await tx
      .insert(idnSettings)
      .values({ universityId: uni(actor), phoneSignIn: on, updatedAt: now, updatedBy: actor.userId || null })
      .onConflictDoUpdate({ target: idnSettings.universityId, set: { phoneSignIn: on, updatedAt: now, updatedBy: actor.userId || null } });
    await audit(tx, actor, on ? "settings.phone_sign_in_on" : "settings.phone_sign_in_off", "idn_settings", uni(actor));
    return { phoneSignIn: on };
  });
}
