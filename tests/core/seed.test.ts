import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import type { SeedContext, ZinnyModule } from "@/contracts/module";
import { setTestModules } from "@/server/registry";
import { seedDemo } from "@/db/seed";

afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

describe("contracts section 6: seeds", () => {
  it("runs the core seed, then each module's seed in alphabetical order with the core seed's ids", async () => {
    const calls: { id: string; ctx: SeedContext }[] = [];
    const mod = (id: ZinnyModule["id"]): ZinnyModule => ({ id, seed: async (ctx) => void calls.push({ id, ctx }) });
    setTestModules([mod("website-builder"), mod("assessments"), mod("gamification")]);
    const quiet = console.log;
    console.log = () => {};
    try {
      await seedDemo();
    } finally {
      console.log = quiet;
    }
    expect(calls.map((c) => c.id)).toEqual(["assessments", "gamification", "website-builder"]);
    const { ctx } = calls[0];
    expect(ctx.universitySlug).toBe("demo");
    expect(ctx.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.systemActor.universityId).toBe(ctx.universityId);
    expect(Object.keys(ctx.ids.departments).sort()).toEqual(["CS", "MKT"]);
    expect(Object.keys(ctx.ids.courses).sort()).toEqual(["Data Analytics", "Digital Marketing", "Machine Learning Foundations", "Python Basics"]);
    expect(ctx.ids.batches["Data Analytics / Weekday morning"]).toBeTruthy();
    expect(ctx.ids.users["riya@demo.edu"]).toBeTruthy();
    expect(ctx.ids.users["zara@zinny.demo"]).toBeTruthy();
    expect(ctx.ids.enrolments["riya@demo.edu / Python Basics"]).toBeTruthy();
    const hema = await ctx.actorFor("hema@demo.edu");
    expect(hema.universityId).toBe(ctx.universityId);
    expect(hema.assignments.some((a) => a.role === "hod")).toBe(true);
  });
});
