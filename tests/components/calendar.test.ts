import { describe, expect, it } from "vitest";
import { addDays, addMonths, clockValue, longDay, minuteSteps, monthCells, parseClock, showClock, showDay, startOfWeek } from "@/components/calendar";

describe("calendar", () => {
  it("lays a month out from Monday, with blanks before the 1st", () => {
    // 1 November 2026 is a Sunday, so six blanks come first.
    const cells = monthCells(2026, 10);
    expect(cells.slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(cells.at(-1)).toBe("2026-11-30");
    expect(cells).toHaveLength(36);
  });

  it("knows leap years", () => {
    expect(monthCells(2028, 1).at(-1)).toBe("2028-02-29");
    expect(monthCells(2026, 1).at(-1)).toBe("2026-02-28");
  });

  it("moves across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });

  it("stops at a shorter month's last day", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("starts weeks on Monday", () => {
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26");
    expect(startOfWeek("2026-11-02")).toBe("2026-11-02");
  });

  it("writes dates for people", () => {
    expect(showDay("2026-11-02")).toBe("2 Nov 2026");
    expect(longDay("2026-11-02")).toBe("Monday, 2 November 2026");
    expect(showDay("")).toBe("");
  });
});

describe("clock", () => {
  it.each([
    ["00:00", "12:00 AM"],
    ["00:05", "12:05 AM"],
    ["09:30", "9:30 AM"],
    ["12:00", "12:00 PM"],
    ["14:30", "2:30 PM"],
    ["23:55", "11:55 PM"],
  ])("shows %s as %s and reads it back", (value, shown) => {
    expect(showClock(value)).toBe(shown);
    expect(clockValue(parseClock(value)!)).toBe(value);
  });

  it("is empty without a time", () => {
    expect(showClock("")).toBe("");
    expect(parseClock("")).toBeNull();
  });

  it("keeps a saved minute that falls between the steps", () => {
    expect(minuteSteps()).toHaveLength(12);
    expect(minuteSteps(10)).toHaveLength(12);
    expect(minuteSteps(33)).toEqual([0, 5, 10, 15, 20, 25, 30, 33, 35, 40, 45, 50, 55]);
  });
});
