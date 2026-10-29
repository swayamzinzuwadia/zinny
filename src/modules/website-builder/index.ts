import type { ZinnyModule } from "@/contracts/module";
import { MyProfileCard, WebsiteCard } from "./components/dashboard-cards";
import { housekeeping } from "./jobs";
import { enquiriesReport } from "./reports";

/**
 * website-builder: each university's public website (/site/<uni>) and the Website section of
 * the admin panel: institute profile, faculty profiles, the home page builder, testimonials,
 * reviews, enquiries, gallery, videos, blog and team. Brief: .claude/agents/website-builder.md
 */
const websiteBuilder: ZinnyModule = {
  id: "website-builder",
  dashboardCards: [
    // Not in the reserved list (contracts.md section 3); orders 700+ are unused. See the handoff.
    { key: "website", order: 700, action: "website.manage", component: WebsiteCard },
    { key: "my-profile-page", order: 710, action: "self.profile", component: MyProfileCard },
  ],
  reports: [enquiriesReport],
  jobs: [housekeeping],
  // Loaded only when seeding: it carries the demo copy and draws the placeholder images.
  seed: async (ctx) => (await import("./seed")).seed(ctx),
};

export default websiteBuilder;
