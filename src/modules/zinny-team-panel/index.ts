import type { ZinnyModule } from "@/contracts/module";
import { withTenant } from "@/server/core";
import { todayIST } from "./lib/format";
import { seed } from "./seed";
import { syncAlertsFor } from "./services/licences";
import { planNames } from "./services/plans";

/** zinny-team-panel: the Zinny team panel under /platform. Brief: .claude/agents/zinny-team-panel.md */
const zinnyTeamPanel: ZinnyModule = {
  id: "zinny-team-panel",
  jobs: [
    {
      // Licence warnings: 90% of a cap, 30 days before the end date. Runs once per
      // university as its system actor, under row-level security.
      id: "zinny-team-panel.licence-alerts",
      every: "hour",
      async run(actor) {
        const universityId = actor.universityId;
        if (!universityId) return;
        // Plans are Zinny's own table, outside row-level security, so their names are read first.
        const names = await planNames().catch(() => ({}));
        await withTenant(actor, (tx) => syncAlertsFor(tx, actor, universityId, todayIST(), names));
      },
    },
  ],
  seed,
};

export default zinnyTeamPanel;
