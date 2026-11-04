/** The recorded batch marketplace buyers sit in isn't a class: no leaderboard or challenge is set for it. */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { listChallenges } from "@/modules/gamification/challenges";
import { staffLeaderboard } from "@/modules/gamification/leaderboards";
import { buyRecordings, setupCourse } from "../fixtures";

afterAll(closeDb);

describe("batch pickers on Leaderboard and Challenges", () => {
  it("leave the recorded batch out, and keep the course's real batches", async () => {
    const c = await setupCourse({ name: "Recorded Pickers U", pricePaise: 400_000 });
    const { recordedBatchId } = await buyRecordings(await c.student("Buyer"), c.batch.id);

    const board = await staffLeaderboard(c.admin);
    const offered = board.groups.flatMap((g) => g.options.map((o) => o.scope.id));
    expect(offered).toContain(c.batch.id);
    expect(offered).not.toContain(recordedBatchId);

    const scopes = (await listChallenges(c.admin)).scopes.flatMap((g) => g.options.map((o) => o.value));
    expect(scopes).toContain(`batch:${c.batch.id}`);
    expect(scopes).not.toContain(`batch:${recordedBatchId}`);
  });
});
