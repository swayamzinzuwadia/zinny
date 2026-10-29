import { randomUUID } from "node:crypto";
import { afterAll, describe, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { courses, departments } from "@/db/schema";
import {
  gamActivity,
  gamBadgeAwards,
  gamBadges,
  gamChallenges,
  gamChallengeWinners,
  gamSettings,
  gamXpLedger,
  gamXpRules,
} from "@/modules/gamification/schema";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeUser, uniqueCode } from "../fixtures";

afterAll(closeDb);

type Uni = { id: string };

const rule = async (uni: Uni) =>
  (await systemDb().insert(gamXpRules).values({ universityId: uni.id, name: "Lesson", eventType: "lesson.completed", points: 10 }).returning())[0];
const badge = async (uni: Uni) =>
  (await systemDb().insert(gamBadges).values({ universityId: uni.id, name: "Star", icon: "star", metric: "xp", threshold: 10 }).returning())[0];
const challenge = async (uni: Uni) => {
  const [d] = await systemDb().insert(departments).values({ universityId: uni.id, code: uniqueCode(), name: "Dept" }).returning();
  const [c] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: d.id, title: "Course" }).returning();
  return (
    await systemDb()
      .insert(gamChallenges)
      .values({ universityId: uni.id, departmentId: d.id, scope: "course", courseId: c.id, title: "Sprint", metric: "xp", target: 10, startDate: "2030-01-01", endDate: "2030-01-31" })
      .returning()
  )[0];
};

describe("gamification tables are isolated per university", () => {
  it("gam_settings", () =>
    // One row per university: the second makeRow call is for B's insert attempt, which must fail anyway.
    expectTenantIsolated(gamSettings, (uni) => ({ universityId: uni.id, nameDisplay: "full" as const })));

  it("gam_xp_rules", () => expectTenantIsolated(gamXpRules, (uni) => ({ universityId: uni.id, name: "Lesson", eventType: "lesson.completed" as const, points: 10 })));

  it("gam_xp_ledger", () =>
    expectTenantIsolated(gamXpLedger, async (uni) => ({
      universityId: uni.id,
      userId: (await makeUser("Ledger Student")).id,
      ruleId: (await rule(uni)).id,
      sourceEventId: randomUUID(),
      eventType: "lesson.completed",
      dedupeKey: `lesson:${randomUUID()}`,
      points: 10,
      reason: "Lesson",
      awardDate: "2030-01-01",
      occurredAt: new Date(),
    })));

  it("gam_activity", () =>
    expectTenantIsolated(gamActivity, async (uni) => ({
      universityId: uni.id,
      userId: (await makeUser("Activity Student")).id,
      sourceEventId: randomUUID(),
      kind: "lesson" as const,
      subjectKey: randomUUID(),
      activityDate: "2030-01-01",
      occurredAt: new Date(),
    })));

  it("gam_badges", () => expectTenantIsolated(gamBadges, (uni) => ({ universityId: uni.id, name: "Star", icon: "star", metric: "xp" as const, threshold: 10 })));

  it("gam_badge_awards", () =>
    expectTenantIsolated(gamBadgeAwards, async (uni) => ({
      universityId: uni.id,
      badgeId: (await badge(uni)).id,
      userId: (await makeUser("Badge Student")).id,
      value: 10,
    })));

  it("gam_challenges", () =>
    expectTenantIsolated(gamChallenges, async (uni) => {
      const c = await challenge(uni);
      return { ...c, id: undefined, createdAt: undefined };
    }));

  it("gam_challenge_winners", () =>
    expectTenantIsolated(gamChallengeWinners, async (uni) => ({
      universityId: uni.id,
      challengeId: (await challenge(uni)).id,
      userId: (await makeUser("Winner")).id,
      position: 1,
      value: 10,
      reachedAt: new Date(),
    })));
});
