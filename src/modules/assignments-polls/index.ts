import type { ZinnyModule } from "@/contracts/module";
import { handlers } from "./events";
import { jobs } from "./jobs";

/** assignments-polls: assignments with files, grading, and course polls. Brief: .claude/agents/assignments-polls.md */
const assignmentsPolls: ZinnyModule = {
  id: "assignments-polls",
  eventHandlers: handlers,
  jobs,
};

export default assignmentsPolls;
