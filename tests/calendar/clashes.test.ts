/**
 * Clash rules without a database: weekly clashes, one-off clashes from moved and extra
 * classes, the cap on one-off clashes, marking clashing classes on a timetable, and the wording.
 */
import { describe, expect, it } from "vitest";
import { clashLines, clashSentence } from "@/server/lib/clashes";
import { addDays } from "@/server/lib/dates";
import { MAX_ONE_OFF_CLASHES, findClashes, markClashes, expandSessions, type Override, type ScheduledBatch } from "@/server/services/schedule";

// 2026-11-02 is a Monday.
const batch = (over: Partial<ScheduledBatch>): ScheduledBatch => ({
  batchId: "a",
  batchName: "Weekday morning",
  courseId: "c1",
  courseTitle: "Data Analytics",
  startDate: "2026-11-02",
  endDate: "2027-01-29",
  slots: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "11:00" })),
  ...over,
});
const weekend = (over: Partial<ScheduledBatch> = {}) =>
  batch({ batchId: "b", batchName: "Weekend", courseId: "c2", courseTitle: "Python Basics", slots: [6, 7].map((weekday) => ({ weekday, startTime: "10:00", endTime: "13:00" })), ...over });
const extra = (date: string, startTime: string, endTime: string): Override => ({ date, kind: "extra", newDate: null, startTime, endTime, note: "Extra" });
const moved = (date: string, newDate: string, startTime: string, endTime: string): Override => ({ date, kind: "rescheduled", newDate, startTime, endTime, note: null });

describe("weekly clashes", () => {
  it("still names the weekday and time, once per weekday", () => {
    const c = findClashes(batch({ batchId: "x", courseId: "c3", slots: [{ weekday: 1, startTime: "10:00", endTime: "12:00" }] }), [batch({})]);
    expect(c).toEqual([{ batchId: "a", batchName: "Weekday morning", courseTitle: "Data Analytics", weekday: 1, when: "Mon 9 am–11 am" }]);
  });

  it("weekly batches that never meet together don't clash", () => {
    expect(findClashes(weekend(), [batch({})])).toEqual([]);
  });
});

describe("one-off clashes", () => {
  it("an extra class of the new batch on a weekday morning clashes on that date", () => {
    // The weekend batch adds an extra class on Wed 11 Nov at 10 am.
    const c = findClashes(weekend({ overrides: [extra("2026-11-11", "10:00", "12:00")] }), [batch({})]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ batchId: "a", date: "2026-11-11", weekday: 3 });
    expect(c[0].when).toBe("Wed, 11 Nov, 9 am–11 am");
  });

  it("a class the existing batch moved onto the new batch's time clashes on that date", () => {
    const existing = batch({ overrides: [moved("2026-11-06", "2026-11-07", "11:00", "12:00")] });
    const c = findClashes(weekend(), [existing]);
    expect(c.map((x) => x.when)).toEqual(["Sat, 7 Nov, 11 am–12 pm"]);
  });

  it("a moved or extra class at a free time, or outside the other batch's dates, doesn't clash", () => {
    expect(findClashes(weekend({ overrides: [extra("2026-11-11", "14:00", "15:00")] }), [batch({})])).toEqual([]);
    expect(findClashes(weekend({ overrides: [extra("2027-03-03", "09:00", "10:00")] }), [batch({})])).toEqual([]);
  });

  it("an extra class can clash even when the batches' dates never overlap", () => {
    const later = weekend({ startDate: "2027-03-06", endDate: "2027-04-30", overrides: [extra("2026-11-12", "09:30", "10:30")] });
    expect(findClashes(later, [batch({})]).map((x) => x.date)).toEqual(["2026-11-12"]);
  });

  it("reports at most a handful of one-off clashes per batch", () => {
    const many = Array.from({ length: 20 }, (_, i) => extra(addDays("2026-11-09", (i % 5) + Math.floor(i / 5) * 7), "09:00", "10:00"));
    const c = findClashes(weekend({ overrides: many }), [batch({})]);
    expect(c.filter((x) => x.date)).toHaveLength(MAX_ONE_OFF_CLASHES);
  });
});

describe("marking clashes on a timetable", () => {
  it("marks both classes that meet at the same time, and nothing else", () => {
    const ml = batch({ batchId: "m", batchName: "Morning", courseId: "c4", courseTitle: "Machine Learning", slots: [{ weekday: 1, startTime: "10:00", endTime: "12:00" }] });
    const sessions = markClashes(expandSessions([batch({}), ml, weekend()], "2026-11-02", "2026-11-08"));
    const clashing = sessions.filter((s) => s.clashesWith);
    expect(clashing.map((s) => `${s.date} ${s.courseTitle}`)).toEqual(["2026-11-02 Data Analytics", "2026-11-02 Machine Learning"]);
    expect(clashing[0].clashesWith![0]).toMatchObject({ batchId: "m", courseTitle: "Machine Learning" });
  });
});

describe("wording", () => {
  const weekly = (weekday: number, day: string) => ({ batchId: "a", batchName: "Morning batch", courseTitle: "CA Foundation", weekday, when: `${day} 9 am–11 am` });

  it("one sentence naming the other batch and when", () => {
    expect(clashSentence([weekly(1, "Mon")])).toBe("This batch clashes with CA Foundation – Morning batch on Mon, 9 am–11 am.");
    expect(clashSentence([1, 2, 3, 4, 5].map((d, i) => weekly(d, ["Mon", "Tue", "Wed", "Thu", "Fri"][i])))).toBe(
      "This batch clashes with CA Foundation – Morning batch on Mon to Fri, 9 am–11 am.",
    );
  });

  it("names several batches and keeps one-off dates", () => {
    const text = clashSentence(
      [weekly(1, "Mon"), { batchId: "b", batchName: "Weekend", courseTitle: "Python", weekday: 6, when: "Sat, 7 Nov, 10 am–1 pm", date: "2026-11-07" }],
      "Riya's place in this batch",
    );
    expect(text).toBe("Riya's place in this batch clashes with CA Foundation – Morning batch on Mon, 9 am–11 am and Python – Weekend on Sat, 7 Nov, 10 am–1 pm.");
    expect(clashLines([{ batchId: "b", batchName: "Weekend", courseTitle: "Python", weekday: 6, when: "Sat, 7 Nov, 10 am–1 pm", date: "2026-11-07" }])).toEqual([
      "Python (Weekend), Sat, 7 Nov, 10 am–1 pm",
    ]);
  });

  it("says nothing when nothing clashes", () => {
    expect(clashSentence([])).toBe("");
  });
});
