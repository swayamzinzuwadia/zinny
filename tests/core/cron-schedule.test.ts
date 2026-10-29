/**
 * Production cron schedule. vercel.json (the free Vercel preview) holds only the daily run,
 * because Vercel's Hobby plan refuses crons more frequent than once a day. The minute and hour
 * runs and the event safety net are scheduled outside Vercel (README, "Scheduled jobs").
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const crons = (JSON.parse(readFileSync(new URL("vercel.json", root), "utf8")) as { crons: { path: string; schedule: string }[] }).crons;

describe("Vercel cron schedule", () => {
  it("runs the daily jobs just after midnight in India (18:45 UTC = 00:15 IST)", () => {
    expect(crons).toEqual([{ path: "/api/jobs/run?every=day", schedule: "45 18 * * *" }]);
  });
  it("stays within Hobby's once-a-day limit", () => {
    for (const c of crons) expect(c.schedule.split(" ").slice(0, 2).every((f) => /^\d+$/.test(f)), c.path).toBe(true);
  });
  it("points at routes that exist, including the ones scheduled elsewhere", () => {
    for (const p of ["/api/jobs/run", "/api/jobs/events"]) expect(existsSync(new URL(`src/app${p}/route.ts`, root)), p).toBe(true);
  });
});
