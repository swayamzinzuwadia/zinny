/** Scheduled jobs (contracts.md section 5). Each runs once per university as its system actor. */
import type { Job } from "@/contracts/module";
import { remindDueSoon } from "./service/assignments";
import { cleanStagedFiles } from "./service/files";
import { announceOpenedPolls } from "./service/polls";

export const jobs: Job[] = [
  {
    // The day before the due date, remind students who haven't handed in. Also removes uploads nobody saved.
    id: "assignments-polls.daily",
    every: "day",
    async run(actor) {
      await remindDueSoon(actor);
      await cleanStagedFiles(actor);
    },
  },
  {
    // Tells students about polls whose opening time has passed.
    id: "assignments-polls.announce-polls",
    every: "hour",
    async run(actor) {
      await announceOpenedPolls(actor);
    },
  },
];
