import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { domainEventDeliveries } from "@/db/schema";
import type { SeedContext } from "@/contracts/module";
import { seedDemo } from "@/db/seed";
import { setTestModules } from "@/server/registry";
import gamification from "@/modules/gamification";
import { listChallenges } from "@/modules/gamification/challenges";
import { myXpPage } from "@/modules/gamification/learner";
import { staffLeaderboard } from "@/modules/gamification/leaderboards";
import { listRules } from "@/modules/gamification/rules";
import { gamBadgeAwards, gamXpLedger } from "@/modules/gamification/schema";

let ctx: SeedContext;

beforeAll(async () => {
  setTestModules([gamification], { only: true });
  const quiet = console.log;
  console.log = () => {};
  try {
    ctx = await seedDemo();
  } finally {
    console.log = quiet;
  }
}, 180_000);
afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

describe("gamification demo seed", () => {
  it("sets up default rules, including a department rule for each HOD and one turned off", async () => {
    const { rules } = await listRules(await ctx.actorFor("asha@demo.edu"));
    expect(rules.length).toBeGreaterThanOrEqual(9);
    expect(rules.filter((r) => r.departmentId === ctx.ids.departments.CS)).toHaveLength(1);
    expect(rules.filter((r) => r.departmentId === ctx.ids.departments.MKT)).toHaveLength(1);
    expect(rules.filter((r) => !r.active)).toHaveLength(1);
  });

  it("gives seeded students XP and badges, so leaderboards aren't empty", async () => {
    const ledger = await systemDb().select().from(gamXpLedger).where(eq(gamXpLedger.universityId, ctx.universityId));
    expect(new Set(ledger.map((l) => l.userId)).size).toBeGreaterThanOrEqual(10);
    const awards = await systemDb().select().from(gamBadgeAwards).where(eq(gamBadgeAwards.universityId, ctx.universityId));
    expect(awards.length).toBeGreaterThan(5);

    const board = await staffLeaderboard(await ctx.actorFor("hema@demo.edu"), { scope: `batch:${ctx.ids.batches["Python Basics / Weekend"]}`, period: "all" });
    expect(board.rows.length).toBe(5);
    expect(board.rows[0].points).toBeGreaterThan(0);

    const riya = await myXpPage(await ctx.actorFor("riya@demo.edu"));
    expect(riya.total).toBeGreaterThan(0);
    expect(riya.boards.length).toBe(3);
    expect(riya.badges.some((b) => b.earnedAt)).toBe(true);
  });

  it("delivers the seed's events without failures, and the drain after it awards nothing twice", async () => {
    const failed = await systemDb().select().from(domainEventDeliveries).where(eq(domainEventDeliveries.universityId, ctx.universityId));
    expect(failed.filter((d) => d.lastError)).toEqual([]);
    const ledger = await systemDb().select().from(gamXpLedger).where(eq(gamXpLedger.universityId, ctx.universityId));
    expect(new Set(ledger.map((l) => `${l.sourceEventId}|${l.ruleId}|${l.userId}`)).size).toBe(ledger.length);
  });

  it("has running, upcoming and ended challenges, the ended one with frozen winners", async () => {
    const list = await listChallenges(await ctx.actorFor("asha@demo.edu"));
    expect(list.active.length).toBeGreaterThanOrEqual(2);
    expect(list.upcoming.length).toBeGreaterThanOrEqual(1);
    const ended = list.ended.find((c) => c.title === "Marketing kickoff");
    expect(ended?.closedAt).toBeTruthy();
    expect(ended?.finished).toBeGreaterThan(0);
  });
});
