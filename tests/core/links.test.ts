/** Wave 1 integration: Join links carry the class's start time, and the hero's Join follows the 15-minute window. */
import { describe, expect, it } from "vitest";
import { JOIN_OPENS_MINUTES, joinPath, joinWindowOpen } from "@/server/lib/links";
import { JOIN_OPENS_MINUTES as LIVE_CLASSES_RULE } from "@/modules/live-classes/time";

describe("joinPath", () => {
  it("adds ?start=HH:MM so a batch with two classes in a day joins the right one", () => {
    expect(joinPath("demo", "b1", "2026-10-29", "18:30:00")).toBe("/demo/learn/join/b1/2026-10-29?start=18:30");
    expect(joinPath("demo", "b1", "2026-10-29", "09:00")).toBe("/demo/learn/join/b1/2026-10-29?start=09:00");
  });

  it("leaves the start out when there isn't a valid one", () => {
    expect(joinPath("demo", "b1", "2026-10-29")).toBe("/demo/learn/join/b1/2026-10-29");
    expect(joinPath("demo", "b1", "2026-10-29", "soon")).toBe("/demo/learn/join/b1/2026-10-29");
  });
});

describe("joinWindowOpen", () => {
  const s = { date: "2026-10-29", startTime: "10:00", endTime: "11:30" };
  const at = (h: number, m: number) => h * 60 + m;

  it("matches live-classes' window rule", () => {
    expect(JOIN_OPENS_MINUTES).toBe(LIVE_CLASSES_RULE);
  });

  it("opens 15 minutes before the start and closes at the end", () => {
    expect(joinWindowOpen(s, "2026-10-29", at(9, 44))).toBe(false);
    expect(joinWindowOpen(s, "2026-10-29", at(9, 45))).toBe(true);
    expect(joinWindowOpen(s, "2026-10-29", at(11, 29))).toBe(true);
    expect(joinWindowOpen(s, "2026-10-29", at(11, 30))).toBe(false);
  });

  it("is closed on any other day", () => {
    expect(joinWindowOpen(s, "2026-10-28", at(10, 0))).toBe(false);
  });
});
