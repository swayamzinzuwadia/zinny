import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { universities } from "@/db/schema";
import assessments from "@/modules/assessments";
import { assessAttempts, assessQuestions, assessTests } from "@/modules/assessments/schema";
import { setTestModules } from "@/server/registry";
import { seedDemo } from "@/db/seed";
import { eventsOfType } from "../helpers/events";

afterAll(async () => {
  setTestModules([]);
  await closeDb();
});

describe("assessments: demo seed", () => {
  it("adds a 40-question Data Analytics pool, a quiz, a mock test and graded attempts", async () => {
    setTestModules([assessments], { only: true });
    const quiet = console.log;
    console.log = () => {};
    try {
      await seedDemo();
    } finally {
      console.log = quiet;
    }
    const [demo] = await systemDb().select().from(universities).where(eq(universities.slug, "demo"));
    const qs = await systemDb().select().from(assessQuestions).where(eq(assessQuestions.universityId, demo.id));
    expect(qs).toHaveLength(40);
    expect(new Set(qs.map((q) => q.type))).toEqual(new Set(["single", "multiple", "true_false", "numeric", "short"]));
    const tests = await systemDb().select().from(assessTests).where(eq(assessTests.universityId, demo.id));
    expect(tests.map((t) => t.kind)).toEqual(expect.arrayContaining(["quiz", "mock_test", "series"]));
    expect(tests.every((t) => t.status === "published")).toBe(true);
    const attempts = await systemDb().select().from(assessAttempts).where(eq(assessAttempts.universityId, demo.id));
    expect(attempts.filter((a) => a.status === "graded").length).toBeGreaterThanOrEqual(5);
    expect(attempts.some((a) => a.status === "awaiting_grading")).toBe(true);
    expect(attempts.some((a) => a.status === "in_progress")).toBe(true);
    const events = await eventsOfType("test.submitted", demo.id);
    expect(events.length).toBe(attempts.filter((a) => a.status === "graded").length);
  });
});
