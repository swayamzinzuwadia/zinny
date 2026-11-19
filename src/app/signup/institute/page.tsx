import { OnboardingShell } from "@/modules/onboarding/components/shell";
import { InstituteSignup } from "@/modules/onboarding/components/institute-signup";
import { INSTITUTE_MORPH } from "@/modules/onboarding/components/signup-choice";
import { Morph } from "@/modules/onboarding/components/motion";
import { TRIAL_DAYS } from "@/modules/onboarding/lib/constants";
import { checkStepAction, startTrialAction } from "./actions";

export const metadata = { title: "Sign up your institute", referrer: "strict-origin-when-cross-origin" as const };

/** Institute self sign-up with a free trial (the "Sign up as institute" choice on /signup). */
export default function InstituteSignupPage() {
  return (
    <OnboardingShell>
      <Morph name={INSTITUTE_MORPH}>
        <div>
          <h1 className="text-[clamp(2.1rem,6vw,3.2rem)] leading-[1.05] font-medium tracking-[-0.02em]">Start your free {TRIAL_DAYS}-day trial</h1>
          <p className="mt-3 mb-8 max-w-[36rem] text-[16px] text-muted">Four short steps. Your institute&apos;s space is ready the moment you finish.</p>
          <InstituteSignup checkStep={checkStepAction} start={startTrialAction} source="signup" />
        </div>
      </Morph>
    </OnboardingShell>
  );
}
