import type { ZinnyModule } from "@/contracts/module";
import { lt, sql } from "drizzle-orm";
import { withTenant } from "@/server/core";
import { pruneGlobal } from "./auth";
import { handlers } from "./events";
import { idnOtpChallenges } from "./schema";
import { seed } from "./seed";

/** identity: invites, password reset, phone sign-in, sessions and the profile page. Brief: .claude/agents/identity.md */
const identity: ZinnyModule = {
  id: "identity",
  eventHandlers: handlers,
  jobs: [
    {
      id: "identity.housekeeping",
      every: "day",
      // Per university: phone codes older than a day. Once a day overall: ended sessions,
      // stale rate limits and long-expired reset and team links (global tables).
      run: async (actor) => {
        await withTenant(actor, (tx) =>
          tx.delete(idnOtpChallenges).where(lt(idnOtpChallenges.createdAt, sql`now() - interval '1 day'`)),
        );
        await pruneGlobal();
      },
    },
  ],
  seed,
};

export default identity;
