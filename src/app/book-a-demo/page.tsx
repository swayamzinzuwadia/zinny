import type { Metadata } from "next";
import { DemoRequestForm } from "@/modules/marketing/components/DemoRequestForm";
import { InstituteSignup } from "@/modules/onboarding/components/institute-signup";
import { PreferCall } from "@/modules/onboarding/components/prefer-call";
import { OnboardingShell } from "@/modules/onboarding/components/shell";
import { TRIAL_DAYS } from "@/modules/onboarding/lib/constants";
import { checkStepAction, startTrialAction } from "../signup/institute/actions";
import { requestDemoAction } from "./actions";

export const metadata: Metadata = {
  title: "Start your free trial",
  description: `Sign up your institute and use Zinny free for ${TRIAL_DAYS} days: courses, batches, tests, fees and GST invoices.`,
};

/**
 * "Book a demo" from the landing page and the marketplace is now self sign-up: the institute
 * starts a free trial straight away. People who'd rather talk first can still ask for a call.
 */
export default function BookADemo() {
  return (
    <OnboardingShell>
      <h1 className="text-[clamp(2.1rem,6vw,3.2rem)] leading-[1.05] font-medium tracking-[-0.02em]">Try Zinny free for {TRIAL_DAYS} days</h1>
      <p className="mt-3 mb-8 max-w-[36rem] text-[16px] text-muted">Sign up your institute and start using it right away. No card needed, and the Zinny team is here if you have questions.</p>
      <InstituteSignup checkStep={checkStepAction} start={startTrialAction} source="book-a-demo" />
      <PreferCall>
        <DemoRequestForm action={requestDemoAction} />
      </PreferCall>
    </OnboardingShell>
  );
}
