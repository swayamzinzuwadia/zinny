import type { ZinnyModule } from "@/contracts/module";
import { GuardianHomeCard } from "./components/guardian-card";
import { seed } from "./seed";
import { openRequestCount } from "./services/requests";
import { revokeAllSessions } from "@/server/auth/session";
import { retentionSweep } from "./services/retention";

/**
 * privacy: DPDP Act 2023 and DPDP Rules 2025. The privacy notice, consent records, the data
 * principal's rights (download, correction, erasure, nominee, grievance), verifiable parental
 * consent for learners under 18, the breach register, and retention. Brief and gaps:
 * docs/handoff/privacy.md; the obligation-by-obligation map: docs/compliance/dpdp.md.
 */
const privacy: ZinnyModule = {
  id: "privacy",
  learnerHomeCards: [{ key: "guardian-consent", order: 40, action: "self.profile", component: GuardianHomeCard }],
  dashboardCards: [
    {
      key: "privacy-requests",
      order: 90,
      action: "privacy.manage",
      component: () => null,
      async needsYou({ actor, uni }) {
        const { open, overdue } = await openRequestCount(actor);
        if (!open) return [];
        return [
          {
            key: "privacy-requests",
            text: `${open} privacy ${open === 1 ? "request" : "requests"} to answer`,
            detail: overdue ? `${overdue} past ${overdue === 1 ? "its" : "their"} due date` : "Personal data requests from your learners",
            href: `/${uni}/admin/settings/privacy`,
            link: "Answer requests",
            tone: overdue ? "danger" : "warn",
          },
        ];
      },
    },
  ],
  jobs: [
    {
      // Flags (or, if the institute chose so, anonymises) learners inactive past its retention period.
      id: "privacy.retention",
      every: "day",
      async run(actor) {
        const { erased } = await retentionSweep(actor);
        // As with an erasure an admin approves: an anonymised person is signed out everywhere, after the commit.
        for (const userId of erased) await revokeAllSessions(userId);
      },
    },
  ],
  seed,
};

export default privacy;
