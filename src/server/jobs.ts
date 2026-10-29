/**
 * Core's own scheduled jobs (contracts.md section 5). They run through the same
 * runner as module jobs: once per university, as that university's system actor.
 */
import type { Job } from "@/contracts/module";
import { facultyExpiryAlerts } from "./services/batches";
import { expireStaleHolds } from "./services/enrolment";
import { withTenant } from "./tenant";

export const CORE_JOBS: Job[] = [
  {
    // Release seat holds that ran out, and warn HODs about visiting faculty whose
    // access ends before their batch does. Formerly /api/jobs/daily.
    id: "core.daily-housekeeping",
    every: "day",
    async run(actor) {
      await withTenant(actor, (tx) => expireStaleHolds(tx));
      await facultyExpiryAlerts(actor, 14);
    },
  },
];
