"use server";
/**
 * The institute sign-up wizard's server actions. They only call the onboarding services,
 * then sign the new admin in.
 */
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { clientInfo, cookieOptions, startSession } from "@/server/auth/session";
import { AppError } from "@/server/errors";
import { UNI_COOKIE } from "@/modules/identity/cookies";
import { SignupError, checkSignupStep, startInstituteTrial, type InstituteSignupInput, type SignupStep } from "@/modules/onboarding/services/signup";
import type { SignupConsents } from "@/modules/onboarding/components/institute-signup";
import { loadActor } from "@/server/core";
import { recordSignupConsents } from "@/modules/privacy/services/consents";

export type StepCheck = { step: SignupStep; message: string } | null;

/** "Continue" on each step: the problem to fix on this step or an earlier one, or null. */
export async function checkStepAction(input: InstituteSignupInput, step: SignupStep): Promise<StepCheck> {
  try {
    return await checkSignupStep(input, step);
  } catch (e) {
    unstable_rethrow(e);
    console.error(e);
    return { step, message: "Something went wrong on our side. Please try again." };
  }
}

export type StartState = { ok: true; slug: string; trialEndsAt: string } | { ok: false; step: SignupStep | null; message: string };

/** "Start my free trial": makes the institute and its admin, and signs them in. */
export async function startTrialAction(input: InstituteSignupInput, consents: SignupConsents): Promise<StartState> {
  try {
    if (!consents?.account || !consents?.service) {
      return { ok: false, step: "documents", message: "Tick both boxes to agree to how Zinny uses your details. News is optional." };
    }
    const { ip } = await clientInfo();
    const created = await startInstituteTrial(input, { ip });
    // Zinny is the Data Fiduciary for the person signing the institute up: record each consent (DPDP Act s.6).
    await recordSignupConsents(await loadActor(created.userId, null), { source: "institute_signup", consents: { marketing: !!consents.marketing }, ip });
    await startSession(created.userId, "password");
    (await cookies()).set(UNI_COOKIE, created.slug, { ...cookieOptions(), maxAge: 400 * 86_400 });
    return { ok: true, slug: created.slug, trialEndsAt: created.trialEndsAt };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof SignupError) return { ok: false, step: e.step, message: e.message };
    if (e instanceof AppError) return { ok: false, step: null, message: e.message };
    console.error(e);
    return { ok: false, step: null, message: "Something went wrong on our side, so your institute wasn't created. Please try again." };
  }
}
