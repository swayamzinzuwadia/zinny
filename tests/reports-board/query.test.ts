import { describe, expect, it } from "vitest";
import {
  addMonths,
  financialYearStart,
  formatRange,
  isDate,
  monthEnd,
  weekStart,
  zonedInstant,
} from "@/modules/reports-board/lib/dates";
import { downloadName, parseQuery, presetRange, reportParams, resolveRange, toSearchParams } from "@/modules/reports-board/lib/query";

describe("dates", () => {
  it("checks real calendar dates", () => {
    expect(isDate("2026-02-28")).toBe(true);
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026-2-3")).toBe(false);
    expect(isDate("'; drop table")).toBe(false);
  });

  it("knows weeks, months and the Indian financial year", () => {
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sunday → Monday before
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-01");
    expect(addMonths("2026-11-30", 2)).toBe("2027-01-01");
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
    expect(financialYearStart("2026-03-31")).toBe("2025-04-01");
    expect(financialYearStart("2026-04-01")).toBe("2026-04-01");
  });

  it("finds the instant a local time happens, across time zones", () => {
    expect(zonedInstant("2026-10-29", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-10-29T03:30:00.000Z");
    expect(zonedInstant("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedInstant("2026-12-01", "09:00", "Europe/London").toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });

  it("writes ranges for people", () => {
    expect(formatRange("2026-09-30", "2026-10-29")).toBe("30 Sept to 29 Oct 2026");
    expect(formatRange("2025-12-01", "2026-01-31")).toBe("1 Dec 2025 to 31 Jan 2026");
  });
});

describe("the URL choice", () => {
  it("defaults to the last 30 days and page 1", () => {
    const q = parseQuery({});
    expect(q).toMatchObject({ reportId: null, range: "30d", page: 1 });
    expect(presetRange("30d", "2026-10-29")).toEqual({ from: "2026-09-30", to: "2026-10-29" });
  });

  it("reads filters and custom dates, and writes them back", () => {
    const q = parseQuery({ report: "reports-board.enrolments", from: "2026-04-01", to: "2026-09-30", dept: "d", course: ["c", "x"], page: "3" });
    expect(q).toMatchObject({ range: "custom", from: "2026-04-01", to: "2026-09-30", departmentId: "d", courseId: "c", page: 3 });
    expect(toSearchParams(q).toString()).toBe("report=reports-board.enrolments&range=custom&from=2026-04-01&to=2026-09-30&dept=d&course=c&page=3");
    expect(toSearchParams({ ...q, range: "7d", page: 1 }).toString()).toBe("report=reports-board.enrolments&range=7d&dept=d&course=c");
  });

  it("ignores junk pages and presets", () => {
    expect(parseQuery({ page: "-2", range: "forever" })).toMatchObject({ page: 1, range: "30d" });
    expect(parseQuery({ page: "2.5" }).page).toBe(1);
  });

  it("resolves every preset relative to the university's today", () => {
    const today = "2026-10-29";
    expect(presetRange("7d", today)).toEqual({ from: "2026-10-23", to: today });
    expect(presetRange("month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(presetRange("last-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("fy", today)).toEqual({ from: "2026-04-01", to: today });
    expect(presetRange("last-fy", today)).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(presetRange("last-month", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("explains a bad custom range", () => {
    const at = (from: string | null, to: string | null) => resolveRange({ range: "custom", from, to }, "2026-10-29");
    expect(at("2026-04-01", "2026-09-30")).toEqual({ from: "2026-04-01", to: "2026-09-30" });
    expect(at("2026-04-01", null)).toEqual({ error: "Pick both a start date and an end date." });
    expect(at("2026-09-30", "2026-04-01")).toMatchObject({ error: expect.stringContaining("after the end date") });
    expect(at("2026-02-30", "2026-04-01")).toMatchObject({ error: expect.stringContaining("real calendar dates") });
    expect(at("2010-01-01", "2026-01-01")).toMatchObject({ error: "Pick a date range of five years or less." });
  });

  it("passes only the filters a report declares", () => {
    const q = parseQuery({ report: "x", dept: "d", course: "c", batch: "b" });
    expect(reportParams(["dateRange", "batch"], q, { from: "2026-01-01", to: "2026-01-31" })).toEqual({
      from: "2026-01-01",
      to: "2026-01-31",
      batchId: "b",
    });
    expect(reportParams(["course"], q, { from: "2026-01-01", to: "2026-01-31" })).toEqual({ courseId: "c" });
  });

  it("names downloads after the report and range", () => {
    expect(downloadName("Live class attendance", { from: "2026-09-30", to: "2026-10-29" }, "xlsx")).toBe(
      "live-class-attendance-2026-09-30-to-2026-10-29.xlsx",
    );
    expect(downloadName("Ünïcode / ₹ report", null, "csv")).toBe("unicode-report.csv");
  });
});
