import type { ModuleId, ZinnyModule } from "@/contracts/module";
import { KycHomeCard } from "./components/kyc-card";
import { seed } from "./seed";
import { freezeIfTrialOver } from "./services/trial";

/**
 * onboarding: institute self sign-up with a free trial, document review, the trial freeze
 * and plan checkout, and student KYC. Brief: docs/handoff/onboarding.md.
 *
 * "onboarding" is not yet in MODULE_IDS (src/contracts/module.ts is frozen for the wave);
 * the cast goes once the integrator adds it.
 */
const onboarding: ZinnyModule = {
  id: "onboarding" as ModuleId,
  learnerHomeCards: [{ key: "kyc", order: 50, action: "self.profile", component: KycHomeCard }],
  jobs: [
    {
      // A self-signed institute whose free trial has ended without a paid plan is frozen:
      // nothing is deleted, admins can only choose a plan. Runs as each university's system actor.
      id: "onboarding.trial-freeze",
      every: "hour",
      async run(actor) {
        await freezeIfTrialOver(actor);
      },
    },
  ],
  seed,
};

export default onboarding;
