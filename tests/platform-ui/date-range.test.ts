import { describe, expect, it } from "vitest";
import { presetRange, resolveRange } from "@/components/date-range";
import { reminderLevel } from "@/modules/zinny-team-panel/components/licence-reminder";

const today = "2026-11-19";

describe("date range presets", () => {
  it("maps each preset to from and to", () => {
    const pick = (k: Parameters<typeof presetRange>[0]) => {
      const r = presetRange(k, today);
      return [r.from, r.to];
    };
    expect(pick("today")).toEqual(["2026-11-19", "2026-11-19"]);
    expect(pick("last-7-days")).toEqual(["2026-11-13", "2026-11-19"]);
    expect(pick("this-month")).toEqual(["2026-11-01", "2026-11-19"]);
    expect(pick("last-month")).toEqual(["2026-10-01", "2026-10-31"]);
    expect(pick("last-3-months")).toEqual(["2026-08-20", "2026-11-19"]);
    expect(pick("this-year")).toEqual(["2026-01-01", "2026-11-19"]);
  });

  it("compares with the period before", () => {
    expect(presetRange("last-7-days", today).prev).toEqual({ from: "2026-11-06", to: "2026-11-12" });
    expect(presetRange("this-month", today).prev).toEqual({ from: "2026-10-01", to: "2026-10-19" });
    expect(presetRange("last-month", today).prev).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("reads custom ranges and falls back on bad input", () => {
    const c = resolveRange({ from: "2026-03-01", to: "2026-03-10" }, today);
    expect([c.key, c.from, c.to, c.days]).toEqual(["custom", "2026-03-01", "2026-03-10", 10]);
    expect(resolveRange({ from: "2026-03-10", to: "2026-03-01" }, today).from).toBe("2026-03-01");
    expect(resolveRange({ from: "2026-03-01", to: "2030-01-01" }, today).to).toBe(today);
    expect(resolveRange({ range: "nonsense" }, today).key).toBe("this-month");
    expect(resolveRange({ range: "today" }, today).key).toBe("today");
  });
});

describe("licence reminder levels", () => {
  it("steps at 30, 14, 7 and 1 days", () => {
    expect(reminderLevel(31)).toBeNull();
    expect(reminderLevel(30)?.threshold).toBe(30);
    expect(reminderLevel(15)?.threshold).toBe(30);
    expect(reminderLevel(14)?.threshold).toBe(14);
    expect(reminderLevel(7)).toMatchObject({ threshold: 7, urgent: true });
    expect(reminderLevel(1)?.threshold).toBe(1);
    expect(reminderLevel(-2)).toMatchObject({ ended: true });
  });
});
