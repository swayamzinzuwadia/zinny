import type { ZinnyModule } from "@/contracts/module";
import { ContinueLearningCard } from "./components/continue-card";
import { CurriculumTab } from "./components/curriculum-tab";
import { LessonsTab } from "./components/lessons-tab";
import { handlers, jobs } from "./events";
import { reports } from "./reports";
import { seed } from "./seed";

/**
 * content-progress: curriculum, lesson player, progress and course completion.
 * Brief: .claude/agents/content-progress.md
 */
const contentProgress: ZinnyModule = {
  id: "content-progress",
  adminCourseTabs: [
    // Everyone who can see the course reads its curriculum; content.manage holders edit it.
    { key: "curriculum", label: "Curriculum", order: 100, action: "course.view", component: CurriculumTab },
  ],
  learnerCourseTabs: [{ key: "lessons", label: "Lessons", order: 100, action: "self.learn", component: LessonsTab }],
  learnerHomeCards: [{ key: "continue-learning", order: 100, action: "self.learn", component: ContinueLearningCard }],
  reports,
  eventHandlers: handlers,
  jobs,
  seed,
};

export default contentProgress;
