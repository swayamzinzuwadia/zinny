import { describe, expect, it } from "vitest";
import { RECORDED_BATCH_LABEL, batchLabel, isRecordedBatch, isRecordedSpan } from "@/server/lib/recorded-batch";

describe("recorded batch display", () => {
  it("spots the recorded batch by its flag or its placeholder dates", () => {
    expect(isRecordedSpan("2000-01-01", "2099-12-31")).toBe(true);
    expect(isRecordedSpan("2026-11-09", "2027-02-07")).toBe(false);
    expect(isRecordedBatch({ recorded: true })).toBe(true);
    expect(isRecordedBatch({ startDate: "2000-01-01", endDate: "2099-12-31" })).toBe(true);
    expect(isRecordedBatch({ recorded: false, startDate: "2026-11-09", endDate: "2027-02-07" })).toBe(false);
  });

  it("names it Recorded lessons, whatever it was called", () => {
    expect(batchLabel({ name: "Marketplace buyers", recorded: true })).toBe(RECORDED_BATCH_LABEL);
    expect(batchLabel({ name: "Weekday evening", recorded: false })).toBe("Weekday evening");
  });
});
