/** certificates jobs (contracts.md section 5). */
import type { Job } from "@/contracts/module";
import { runExpiry } from "./service/expiry";

export const jobs: Job[] = [
  {
    id: "certificates.expiry",
    every: "day",
    run: async (actor) => {
      await runExpiry(actor);
    },
  },
];
