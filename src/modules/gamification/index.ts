import type { ZinnyModule } from "@/contracts/module";
import { handlers } from "./events";
import { jobs } from "./jobs";

/** gamification: XP rules, badges, challenges and leaderboards, driven by events. Brief: .claude/agents/gamification.md */
const gamification: ZinnyModule = {
  id: "gamification",
  eventHandlers: handlers,
  jobs,
};

export default gamification;
