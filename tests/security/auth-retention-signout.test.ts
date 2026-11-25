/**
 * AUTH-10: when the retention job anonymises an inactive learner, every session they still
 * have ends too, the same as when an admin approves an erasure request.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import { systemActorFor } from "@/server/actor";
import { createSession, listSessions } from "@/server/auth/session";
import privacy from "@/modules/privacy";
import { retentionSweep, saveRetentionSettings } from "@/modules/privacy/services/retention";
import { instituteWithStudent } from "../privacy/helpers";

afterAll(closeDb);

const client = { ip: "10.0.0.9", userAgent: "Mozilla/5.0 (Macintosh) Chrome/141.0" };
const DAY = 86_400_000;

describe("retention anonymising", () => {
  it("reports who it erased, and the daily job signs them out everywhere", async () => {
    const { admin, uni, studentUser } = await instituteWithStudent("Retention Signout");
    await saveRetentionSettings(admin, { inactiveDays: 365, retentionAction: "anonymise", grievanceName: "", grievanceEmail: "" });
    await createSession(studentUser.id, "password", client);
    const now = Date.now();

    // First pass flags; a pass before the 48-hour notice erases nobody.
    expect((await retentionSweep(systemActorFor(uni.id), new Date(now + 400 * DAY))).flagged).toBe(1);
    expect((await retentionSweep(systemActorFor(uni.id), new Date(now + 400 * DAY + 3_600_000))).erased).toEqual([]);
    expect((await listSessions(studentUser.id)).length).toBeGreaterThan(0);

    // The job itself, once the notice has passed.
    const job = privacy.jobs!.find((j) => j.id === "privacy.retention")!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now + 403 * DAY);
    try {
      await job.run(systemActorFor(uni.id));
    } finally {
      vi.useRealTimers();
    }
    expect(await listSessions(studentUser.id, new Date(now))).toEqual([]);
  });
});
