/**
 * Wave 1 integration: vercel.json schedules every cron route the modules rely on
 * (live-classes and payments need the hourly run, notifications-delivery the minute run).
 * Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const crons = (JSON.parse(readFileSync(new URL("vercel.json", root), "utf8")) as { crons: { path: string; schedule: string }[] }).crons;

describe("production cron schedule", () => {
  it("runs the event safety net and every job frequency", () => {
    expect(crons.map((c) => c.path).sort()).toEqual(
      ["/api/jobs/events", "/api/jobs/run?every=day", "/api/jobs/run?every=hour", "/api/jobs/run?every=minute"].sort(),
    );
  });
  it("points at routes that exist", () => {
    for (const c of crons) {
      const dir = c.path.split("?")[0];
      expect(existsSync(new URL(`src/app${dir}/route.ts`, root)), c.path).toBe(true);
    }
  });
  it("uses the right frequency for each path", () => {
    const at = (p: string) => crons.find((c) => c.path === p)!.schedule.split(" ");
    expect(at("/api/jobs/events")).toEqual(["*", "*", "*", "*", "*"]);
    expect(at("/api/jobs/run?every=minute")).toEqual(["*", "*", "*", "*", "*"]);
    expect(at("/api/jobs/run?every=hour").slice(1)).toEqual(["*", "*", "*", "*"]);
    // Once a day, just after midnight in India (18:45 UTC = 00:15 IST), so date-based jobs see the new day.
    expect(at("/api/jobs/run?every=day")).toEqual(["45", "18", "*", "*", "*"]);
  });
});
