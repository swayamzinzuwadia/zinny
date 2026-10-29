import type { ZinnyModule } from "@/contracts/module";
import { CurriculumTab } from "./components/curriculum-tab";

/** content-progress: curriculum, lesson player, progress and course completion. Brief: .claude/agents/content-progress.md */
const contentProgress: ZinnyModule = {
  id: "content-progress",
  adminCourseTabs: [
    // Moved from the core course page by foundation-lock; content-progress owns it from here.
    { key: "curriculum", label: "Curriculum", order: 100, action: "course.view", component: CurriculumTab },
  ],
};

export default contentProgress;
