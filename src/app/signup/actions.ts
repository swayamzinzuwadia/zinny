"use server";
/**
 * Student sign-up with consent (DPDP Act s.6) and an age declaration (s.9). Checks the consent
 * boxes and the age first, then makes the account exactly as before (identity's sign-up),
 * and once it exists records each consent and, for a learner under 18, sends their parent or
 * guardian the consent link.
 */
import type { AuthState } from "../login/actions";
import { signUpAction } from "../login/actions";
import { appUrl } from "@/server/auth/config";
import { clientInfo } from "@/server/auth/session";
import { universityBySlug } from "@/server/context";
import { loadActor, todayIn } from "@/server/core";
import { AppError } from "@/server/errors";
import { str } from "@/server/action";
import { findInstituteByCode } from "@/modules/identity/joining";
import { freshAccountId, recordSignupConsents } from "@/modules/privacy/services/consents";
import { checkAgeInput, startGuardianConsent, type GuardianDetails } from "@/modules/privacy/services/children";

const isRedirect = (e: unknown) => typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");

export async function studentSignUpAction(prev: AuthState, data: FormData): Promise<AuthState> {
  const email = str(data, "email");
  const name = str(data, "name");
  const back = (error: string): AuthState => ({ error, email, name, at: Date.now() });
  if (str(data, "consent_account") !== "yes" || str(data, "consent_service") !== "yes") {
    return back("Tick both consent boxes to create your account. News is optional.");
  }
  let guardian: GuardianDetails | null;
  try {
    guardian = checkAgeInput(
      { age: str(data, "age"), birthDate: str(data, "birthDate"), guardianName: str(data, "guardianName"), guardianContact: str(data, "guardianContact") },
      todayIn("Asia/Kolkata"),
    );
  } catch (e) {
    if (e instanceof AppError) return back(e.message);
    throw e;
  }

  try {
    // No redirect means the account wasn't made: show the form's error as before.
    return await signUpAction(prev, data);
  } catch (e) {
    if (!isRedirect(e)) throw e;
    const userId = await freshAccountId(email);
    if (userId) {
      try {
        const { ip } = await clientInfo();
        const code = str(data, "code");
        const slug = str(data, "uni");
        const institute = code ? await findInstituteByCode(code) : slug ? await universityBySlug(slug) : null;
        const actor = await loadActor(userId, null);
        await recordSignupConsents(actor, { source: "student_signup", consents: { marketing: str(data, "consent_marketing") === "yes" }, ip, instituteId: institute?.id ?? null });
        if (guardian) await startGuardianConsent(actor, guardian, { ip, linkBase: appUrl() });
      } catch (err) {
        // The account exists and the person is signed in; a consent record that failed is logged, not shown.
        console.error("Recording sign-up consent failed", err);
      }
    }
    throw e;
  }
}
