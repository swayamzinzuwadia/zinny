import type { ZinnyModule } from "@/contracts/module";
import { MarketplaceCourseTab } from "./components/course-tab";
import { MarketplaceDashboardCard } from "./components/dashboard-card";
import { LibraryHomeCard } from "./components/library";
import { handlers } from "./events";
import { seed } from "./seed";

/** marketplace: institutes sell recorded courses, lectures and combos to every learner on Zinny. */
const marketplace: ZinnyModule = {
  id: "marketplace",
  eventHandlers: handlers,
  seed,
  adminCourseTabs: [{ key: "marketplace", label: "Marketplace", order: 150, action: "course.update", component: MarketplaceCourseTab }],
  learnerHomeCards: [{ key: "library", order: 50, action: "self.view_learning", component: LibraryHomeCard }],
  dashboardCards: [{ key: "marketplace-sales", order: 150, action: "course.update", component: MarketplaceDashboardCard }],
};

export default marketplace;
