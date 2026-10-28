import { describe, expect, it } from "vitest";
import { describeSlots, expandSessions, findClashes, validateSlots, type ScheduledBatch } from "@/server/services/schedule";
import { financialYear, formatTime, isoWeekday, weekStart } from "@/server/lib/dates";
import { gstFor, splitGst } from "@/server/services/finance";

const batch = (over: Partial<ScheduledBatch>): ScheduledBatch => ({
  batchId: "b1",
  batchName: "Weekday morning",
  courseId: "c1",
  courseTitle: "Data Analytics",
  startDate: "2026-11-02",
  endDate: "2027-01-31",
  slots: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00:00", endTime: "11:00:00" })),
  ...over,
});

describe("calendar helpers", () => {
  it("knows weekdays and weeks", () => {
    expect(isoWeekday("2026-11-02")).toBe(1); // Monday
    expect(isoWeekday("2026-11-08")).toBe(7); // Sunday
    expect(weekStart("2026-11-05")).toBe("2026-11-02");
  });
  it("formats times like the PRD", () => {
    expect(formatTime("09:00:00")).toBe("9 am");
    expect(formatTime("19:30")).toBe("7:30 pm");
    expect(formatTime("12:00")).toBe("12 pm");
  });
  it("uses the Indian financial year", () => {
    expect(financialYear("2026-10-28")).toBe("26-27");
    expect(financialYear("2027-03-31")).toBe("26-27");
    expect(financialYear("2027-04-01")).toBe("27-28");
  });
  it("calculates and splits GST", () => {
    expect(gstFor(1_000_000, 1800)).toBe(180_000);
    expect(splitGst(180_001, true)).toEqual({ cgstPaise: 90_000, sgstPaise: 90_001, igstPaise: 0 });
    expect(splitGst(180_000, false)).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 180_000 });
  });
});

describe("timetable expansion", () => {
  it("builds the week from batch timings", () => {
    const s = expandSessions([batch({})], "2026-11-02", "2026-11-08");
    expect(s).toHaveLength(5);
    expect(s[0]).toMatchObject({ date: "2026-11-02", startTime: "09:00:00", courseTitle: "Data Analytics" });
  });

  it("respects batch start and end dates", () => {
    const s = expandSessions([batch({ startDate: "2026-11-04", endDate: "2026-11-05" })], "2026-11-02", "2026-11-08");
    expect(s.map((x) => x.date)).toEqual(["2026-11-04", "2026-11-05"]);
  });

  it("applies cancelled, moved and extra classes", () => {
    const s = expandSessions(
      [
        batch({
          overrides: [
            { date: "2026-11-03", kind: "cancelled", newDate: null, startTime: null, endTime: null, note: "Holiday" },
            { date: "2026-11-04", kind: "rescheduled", newDate: "2026-11-07", startTime: "10:00:00", endTime: "12:00:00", note: null },
            { date: "2026-11-08", kind: "extra", newDate: null, startTime: "10:00:00", endTime: "11:00:00", note: "Revision" },
          ],
        }),
      ],
      "2026-11-02",
      "2026-11-08",
    );
    expect(s.map((x) => `${x.date}:${x.kind}`)).toEqual([
      "2026-11-02:regular",
      "2026-11-05:regular",
      "2026-11-06:regular",
      "2026-11-07:rescheduled",
      "2026-11-08:extra",
    ]);
  });

  it("merges several courses in time order — the PRD page 6 example week", () => {
    const evening = batch({
      batchId: "b2",
      batchName: "Evening",
      courseTitle: "Digital Marketing",
      slots: [2, 4].map((weekday) => ({ weekday, startTime: "19:00:00", endTime: "21:00:00" })),
    });
    const weekend = batch({
      batchId: "b3",
      batchName: "Weekend",
      courseTitle: "Python Basics",
      startDate: "2026-11-07",
      slots: [6, 7].map((weekday) => ({ weekday, startTime: "10:00:00", endTime: "13:00:00" })),
    });
    const s = expandSessions([weekend, batch({}), evening], "2026-11-02", "2026-11-08");
    expect(s).toHaveLength(9);
    expect(s.filter((x) => x.date === "2026-11-03").map((x) => x.courseTitle)).toEqual(["Data Analytics", "Digital Marketing"]);
  });
});

describe("clash check", () => {
  it("flags overlapping timings on shared days", () => {
    const candidate = batch({ batchId: "x", slots: [{ weekday: 2, startTime: "10:00", endTime: "12:00" }] });
    const c = findClashes(candidate, [batch({})]);
    expect(c).toHaveLength(1);
    expect(c[0].when).toBe("Tue 9 am–11 am");
  });

  it("ignores back-to-back classes", () => {
    const candidate = batch({ batchId: "x", slots: [{ weekday: 2, startTime: "11:00", endTime: "12:00" }] });
    expect(findClashes(candidate, [batch({})])).toHaveLength(0);
  });

  it("ignores batches whose dates don't overlap", () => {
    const candidate = batch({ batchId: "x", startDate: "2027-02-01", endDate: "2027-03-01" });
    expect(findClashes(candidate, [batch({})])).toHaveLength(0);
  });

  it("ignores a weekday that never happens inside the overlap", () => {
    // Overlap is only Mon 2 Nov and Tue 3 Nov; the candidate meets on Friday.
    const candidate = batch({ batchId: "x", startDate: "2026-10-01", endDate: "2026-11-03", slots: [{ weekday: 5, startTime: "09:00", endTime: "10:00" }] });
    expect(findClashes(candidate, [batch({})])).toHaveLength(0);
  });
});

describe("slot validation and wording", () => {
  it("rejects bad slots", () => {
    expect(validateSlots([])).toMatch(/at least one/);
    expect(validateSlots([{ weekday: 1, startTime: "11:00", endTime: "09:00" }])).toMatch(/end after/);
    expect(
      validateSlots([
        { weekday: 1, startTime: "09:00", endTime: "11:00" },
        { weekday: 1, startTime: "10:00", endTime: "12:00" },
      ]),
    ).toMatch(/overlap on Mon/);
    expect(validateSlots([{ weekday: 1, startTime: "9:00", endTime: "11:00" }])).toBeNull();
  });

  it("describes timings the way the batch cards do", () => {
    expect(describeSlots(batch({}).slots)).toBe("Mon to Fri, 9 am to 11 am");
    expect(describeSlots([6, 7].map((weekday) => ({ weekday, startTime: "10:00", endTime: "13:00" })))).toBe("Sat and Sun, 10 am to 1 pm");
  });
});
