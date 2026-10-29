import type { ZinnyModule } from "@/contracts/module";
import { CourseLeaderboardTab, TopLearnersCard, XpHomeCard, XpHubSection } from "./components/slots";
import { handlers } from "./events";
import { jobs } from "./jobs";
import { seed } from "./seed";

/** gamification: XP rules, badges, challenges and leaderboards, driven by events. Brief: .claude/agents/gamification.md */
const gamification: ZinnyModule = {
  id: "gamification",
  eventHandlers: handlers,
  jobs,
  learnerCourseTabs: [{ key: "leaderboard", label: "Leaderboard", order: 600, action: "self.view_xp", component: CourseLeaderboardTab }],
  learnerHubSections: [{ key: "xp", order: 600, action: "self.view_xp", component: XpHubSection }],
  learnerHomeCards: [{ key: "xp", order: 600, action: "self.view_xp", component: XpHomeCard }],
  dashboardCards: [{ key: "top-learners", order: 600, action: "leaderboard.view", component: TopLearnersCard }],
  seed,
};

export default gamification;
