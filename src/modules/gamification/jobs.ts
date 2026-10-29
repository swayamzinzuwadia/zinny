/**
 * Jobs (contracts.md section 5). Each runs once per university as its system actor.
 */
import type { Job } from "@/contracts/module";
import { closeEndedChallenges } from "./challenges";

export const jobs: Job[] = [
  {
    id: "gamification.close-challenges",
    every: "hour",
    run: async (actor) => {
      await closeEndedChallenges(actor);
    },
  },
];
