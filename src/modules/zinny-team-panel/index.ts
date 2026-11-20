import type { ZinnyModule } from "@/contracts/module";
import { withTenant } from "@/server/core";
import { todayIST } from "./lib/format";
import { seed } from "./seed";
import { licenceEndRemindersFor, runBillingFor } from "./services/automation";
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
    {
      // Billing: renews licences set to renew automatically (and invoices them) when they
      // come within the renewal lead time, and sends payment reminders on the schedule in
      // the billing settings, then licence-end reminders at 30, 14, 7 and 1 days. Idempotent. On Vercel it runs from the daily cron.
      id: "zinny-team-panel.billing",
      every: "day",
      async run(actor) {
        if (!actor.universityId) return;
        const today = todayIST();
        await runBillingFor(actor, today);
        // After renewals, so a licence that just renewed is reminded about its new end date, not the old one.
        await licenceEndRemindersFor(actor, today);
      },
    },
  ],
  seed,
};

export default zinnyTeamPanel;
