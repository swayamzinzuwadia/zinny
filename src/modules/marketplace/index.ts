import type { ZinnyModule } from "@/contracts/module";
import { MarketplaceDashboardCard } from "./components/dashboard-card";
import { LibraryHomeCard } from "./components/library";
import { handlers } from "./events";
import { seed } from "./seed";

/** marketplace: institutes sell recorded courses and lectures to independent learners and alumni. */
const marketplace: ZinnyModule = {
  id: "marketplace",
  eventHandlers: handlers,
  seed,
  learnerHomeCards: [{ key: "library", order: 50, action: "self.view_learning", component: LibraryHomeCard }],
  dashboardCards: [{ key: "marketplace-sales", order: 150, action: "course.update", component: MarketplaceDashboardCard }],
};

export default marketplace;
