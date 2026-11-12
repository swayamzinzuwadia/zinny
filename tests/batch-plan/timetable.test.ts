import { describe, expect, it } from "vitest";
import {
  annotateSessions,
  batchTimetable,
  classDates,
  expandSessions,
  formatDayRanges,
  parseDayRanges,
  type Override,
  type PlanDay,
  type PlanSection,
  type ScheduledBatch,
} from "@/server/services/schedule";

/** Mon–Fri 9–11, Monday 2 Nov 2026 to Friday 13 Nov 2026: ten class days. */
const batch = (over: Partial<ScheduledBatch> = {}): ScheduledBatch => ({
  batchId: "b1",
  batchName: "Weekday morning",
  courseId: "c1",
  courseTitle: "CA Final",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  slots: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00:00", endTime: "11:00:00" })),
  faculty: ["Farah Faculty"],
  ...over,
});

const section = (id: string, title: string, position: number, over: Partial<PlanSection> = {}): PlanSection => ({
  id,
  title,
  position,
  facultyUserId: `u-${id}`,
  facultyName: `${title} teacher`,
  ...over,
});
const DT = section("dt", "Direct tax", 0);
const GST = section("gst", "GST", 1);
const REV = section("rev", "Revision", 2);

const plan = (sectionId: string, numbers: number[], over: Partial<PlanDay> = {}): PlanDay[] => numbers.map((dayNumber) => ({ sectionId, dayNumber, ...over }));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const override = (o: Partial<Override> & Pick<Override, "date" | "kind">): Override => ({ newDate: null, startTime: null, endTime: null, note: null, ...o });

/** "Day 6 → 2026-11-09 GST" */
const rows = (t: ReturnType<typeof batchTimetable>) => t.days.map((d) => `${d.dayNumber} ${d.date} ${d.entries.flatMap((e) => e.sections.map((s) => s.title)).join("+") || "-"}`);
const codes = (t: ReturnType<typeof batchTimetable>) => t.problems.map((p) => p.code);

describe("day ranges", () => {
  it("reads ranges and single days, sorted and without repeats", () => {
    expect(parseDayRanges("1-5, 8, 10-12")).toEqual({ days: [1, 2, 3, 4, 5, 8, 10, 11, 12], error: null });
    expect(parseDayRanges("8, 1-3, 2").days).toEqual([1, 2, 3, 8]);
    expect(parseDayRanges("1 – 3; 7 to 9\n12").days).toEqual([1, 2, 3, 7, 8, 9, 12]);
    expect(parseDayRanges("Days 4-5").days).toEqual([4, 5]);
    expect(parseDayRanges("   ").days).toEqual([]);
  });
  it("says exactly what is wrong", () => {
    expect(parseDayRanges("1-5, abc").error).toBe(`"abc" isn't a day or a range of days. Write days like 1-5, 8, 10-12.`);
    expect(parseDayRanges("0-3").error).toBe("Day numbers start at 1.");
    expect(parseDayRanges("12-10").error).toBe(`"12-10" runs backwards. Write it as 10-12.`);
    expect(parseDayRanges("1-9999").error).toMatch(/Day 9999 is too far out/);
    expect(parseDayRanges("1-2-3").error).toMatch(/isn't a day or a range/);
    expect(parseDayRanges("3.5").error).toMatch(/isn't a day or a range/);
  });
  it("writes them back the same way", () => {
    expect(formatDayRanges([1, 2, 3, 4, 5, 8, 10, 11, 12])).toBe("1-5, 8, 10-12");
    expect(formatDayRanges([3, 1, 2, 2])).toBe("1-3");
    expect(formatDayRanges([])).toBe("");
  });
});

describe("Day N is the Nth class date", () => {
  it("numbers the distinct class dates in order", () => {
    const dates = classDates(batch());
    expect(dates).toHaveLength(10);
    expect(dates[0]).toBe("2026-11-02");
    expect(dates[5]).toBe("2026-11-09"); // Day 6 is the second Monday: weekends aren't class days
    expect(dates[9]).toBe("2026-11-13");
  });

  it("maps the plan onto dates", () => {
    const t = batchTimetable(batch(), [DT, GST], [...plan("dt", range(1, 6)), ...plan("gst", range(7, 10))]);
    expect(t.classDays).toBe(10);
    expect(t.lastPlannedDay).toBe(10);
    expect(rows(t).slice(4, 8)).toEqual(["5 2026-11-06 Direct tax", "6 2026-11-09 Direct tax", "7 2026-11-10 GST", "8 2026-11-11 GST"]);
    expect(t.days[0]).toMatchObject({ dayNumber: 1, weekday: 1, planned: true, shared: false });
    expect(t.days[0].entries[0]).toMatchObject({ startTime: "09:00:00", endTime: "11:00:00", kind: "regular", note: null });
    expect(t.days[6].entries[0].sections[0]).toMatchObject({ title: "GST", facultyName: "GST teacher", facultyUserId: "u-gst" });
    expect(t.problems).toEqual([]);
  });

  it("a cancelled class (a holiday) shifts every later day", () => {
    const days = [...plan("dt", range(1, 6)), ...plan("gst", range(7, 10))];
    const before = batchTimetable(batch(), [DT, GST], days);
    const after = batchTimetable(batch({ overrides: [override({ date: "2026-11-04", kind: "cancelled", note: "Diwali" })] }), [DT, GST], days);
    expect(before.days[2].date).toBe("2026-11-04");
    expect(after.classDays).toBe(9);
    expect(after.days.map((d) => d.date)).not.toContain("2026-11-04");
    expect(after.days[2]).toMatchObject({ dayNumber: 3, date: "2026-11-05" });
    // GST started on Tue 10 Nov; now Day 7 falls on Wed 11 Nov.
    expect(before.days[6].date).toBe("2026-11-10");
    expect(after.days[6]).toMatchObject({ dayNumber: 7, date: "2026-11-11" });
    expect(after.offDays).toEqual([{ date: "2026-11-04", weekday: 3, kind: "cancelled", movedTo: null, note: "Diwali" }]);
    // The plan still has ten days, the dates now only nine.
    expect(after.problems).toEqual([expect.objectContaining({ code: "beyond_dates", message: "Day 10 is planned but these dates only have 9 class days.", dayNumbers: [10] })]);
  });

  it("a rescheduled class keeps its place in the count but takes its new date and time", () => {
    const o = override({ date: "2026-11-04", kind: "rescheduled", newDate: "2026-11-07", startTime: "14:00", endTime: "16:00", note: "Moved to Saturday" });
    const t = batchTimetable(batch({ overrides: [o] }), [DT], plan("dt", range(1, 10)));
    expect(t.classDays).toBe(10);
    expect(t.days.slice(2, 6).map((d) => d.date)).toEqual(["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-09"]);
    expect(t.days[4]).toMatchObject({ dayNumber: 5, date: "2026-11-07", weekday: 6 });
    expect(t.days[4].entries[0]).toMatchObject({ kind: "rescheduled", startTime: "14:00", endTime: "16:00", note: "Moved to Saturday" });
    expect(t.offDays).toEqual([{ date: "2026-11-04", weekday: 3, kind: "moved", movedTo: "2026-11-07", note: "Moved to Saturday" }]);
    expect(t.problems).toEqual([]);
  });

  it("an extra class adds a day and pushes later days back", () => {
    const o = override({ date: "2026-11-07", kind: "extra", startTime: "10:00", endTime: "12:00", note: "Doubt clearing" });
    const days = [...plan("dt", range(1, 6)), ...plan("gst", range(7, 11))];
    const without = batchTimetable(batch(), [DT, GST], days);
    const withExtra = batchTimetable(batch({ overrides: [o] }), [DT, GST], days);
    expect(codes(without)).toEqual(["beyond_dates"]);
    expect(withExtra.classDays).toBe(11);
    expect(withExtra.days[5]).toMatchObject({ dayNumber: 6, date: "2026-11-07" });
    expect(withExtra.days[5].entries[0]).toMatchObject({ kind: "extra", note: "Doubt clearing" });
    expect(withExtra.days[6]).toMatchObject({ dayNumber: 7, date: "2026-11-09" });
    expect(withExtra.problems).toEqual([]);
  });

  it("an extra class on a day that already has one does not add a day", () => {
    const o = override({ date: "2026-11-03", kind: "extra", startTime: "14:00", endTime: "15:00" });
    const t = batchTimetable(batch({ overrides: [o] }), [DT], plan("dt", range(1, 10)));
    expect(t.classDays).toBe(10);
    expect(t.days[1].entries.map((e) => [e.startTime, e.kind, e.sections[0]?.title])).toEqual([
      ["09:00:00", "regular", "Direct tax"],
      ["14:00", "extra", "Direct tax"],
    ]);
  });

  it("a class moved or added outside the batch's dates still counts", () => {
    const moved = override({ date: "2026-11-13", kind: "rescheduled", newDate: "2026-11-16", startTime: "09:00", endTime: "11:00" });
    const early = override({ date: "2026-10-31", kind: "extra", startTime: "09:00", endTime: "11:00", note: "Orientation" });
    const t = batchTimetable(batch({ overrides: [moved, early] }), [DT], plan("dt", range(1, 11)));
    expect(t.classDays).toBe(11);
    expect(t.days[0]).toMatchObject({ dayNumber: 1, date: "2026-10-31" });
    expect(t.days[10]).toMatchObject({ dayNumber: 11, date: "2026-11-16" });
    // The same sessions the weekly view shows.
    expect(expandSessions([batch({ overrides: [moved, early] })], "2026-11-16", "2026-11-22").map((s) => s.date)).toEqual(["2026-11-16"]);
  });

  it("changed dates and weekly timings move the whole plan", () => {
    const days = plan("dt", range(1, 4));
    const later = batchTimetable(batch({ startDate: "2026-11-09", endDate: "2026-11-20" }), [DT], days);
    expect(later.days.slice(0, 4).map((d) => d.date)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"]);
    const weekend = batchTimetable(batch({ slots: [6, 7].map((weekday) => ({ weekday, startTime: "10:00", endTime: "13:00" })), endDate: "2026-11-30" }), [DT], days);
    expect(weekend.days.slice(0, 4).map((d) => d.date)).toEqual(["2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15"]);
    expect(weekend.days[0].entries[0]).toMatchObject({ startTime: "10:00", endTime: "13:00" });
  });

  it("stores nothing dated: the same plan gives the same days whatever the order of its rows", () => {
    const days = [...plan("gst", [4, 3]), ...plan("dt", [2, 1])];
    expect(rows(batchTimetable(batch(), [GST, DT], days)).slice(0, 4)).toEqual(["1 2026-11-02 Direct tax", "2 2026-11-03 Direct tax", "3 2026-11-04 GST", "4 2026-11-05 GST"]);
  });
});

describe("shared days", () => {
  const twoSessions = (over: Partial<ScheduledBatch> = {}) =>
    batch({
      slots: [1, 2, 3, 4, 5].flatMap((weekday) => [
        { weekday, startTime: "09:00:00", endTime: "11:00:00" },
        { weekday, startTime: "14:00:00", endTime: "16:00:00" },
      ]),
      ...over,
    });
  const day1 = (t: ReturnType<typeof batchTimetable>) => t.days[0].entries.map((e) => `${e.startTime.slice(0, 5)}-${e.endTime.slice(0, 5)} ${e.sections.map((s) => s.title).join("+") || "-"}`);

  it("one session, two sections: they share it", () => {
    const t = batchTimetable(batch(), [DT, GST], [...plan("dt", [1]), ...plan("gst", [1])]);
    expect(day1(t)).toEqual(["09:00-11:00 Direct tax+GST"]);
    expect(t.days[0].shared).toBe(true);
  });

  it("two sessions, two sections: paired in order of the sections", () => {
    const t = batchTimetable(twoSessions(), [DT, GST], [...plan("gst", [1]), ...plan("dt", [1])]);
    expect(day1(t)).toEqual(["09:00-11:00 Direct tax", "14:00-16:00 GST"]);
  });

  it("two sessions, three sections: the last session is shared", () => {
    const t = batchTimetable(twoSessions(), [DT, GST, REV], [...plan("dt", [1]), ...plan("gst", [1]), ...plan("rev", [1])]);
    expect(day1(t)).toEqual(["09:00-11:00 Direct tax", "14:00-16:00 GST+Revision"]);
  });

  it("two sessions, one section: it teaches both", () => {
    const t = batchTimetable(twoSessions(), [DT], plan("dt", [1]));
    expect(day1(t)).toEqual(["09:00-11:00 Direct tax", "14:00-16:00 Direct tax"]);
    expect(t.days[0].shared).toBe(false);
  });

  it("sections with their own times split one session", () => {
    const long = batch({ endDate: "2026-11-02", slots: [{ weekday: 1, startTime: "09:00:00", endTime: "13:00:00" }] });
    const t = batchTimetable(long, [DT, GST], [...plan("dt", [1], { startTime: "09:00", endTime: "11:00", topic: "Capital gains" }), ...plan("gst", [1], { startTime: "11:00", endTime: "13:00" })]);
    expect(day1(t)).toEqual(["09:00-11:00 Direct tax", "11:00-13:00 GST"]);
    expect(t.days[0].entries[0].sections[0].topic).toBe("Capital gains");
    expect(t.problems).toEqual([]);
  });

  it("a section with its own time takes its session; the others get the sessions left", () => {
    const t = batchTimetable(twoSessions(), [DT, GST, REV], [...plan("dt", [1]), ...plan("gst", [1], { startTime: "14:00", endTime: "15:00" }), ...plan("rev", [1])]);
    expect(day1(t)).toEqual(["09:00-11:00 Direct tax+Revision", "14:00-15:00 GST"]);
  });

  it("a session nobody is planned for stays on the timetable, empty", () => {
    const t = batchTimetable(twoSessions(), [DT], plan("dt", [1], { startTime: "09:00", endTime: "11:00" }));
    expect(day1(t)).toEqual(["09:00-11:00 Direct tax", "14:00-16:00 -"]);
  });

  it("a time outside the class is reported, and still shown", () => {
    const t = batchTimetable(batch(), [DT, GST], [...plan("dt", [1]), ...plan("gst", [1], { startTime: "14:00", endTime: "16:00" })]);
    expect(day1(t)).toEqual(["09:00-11:00 Direct tax", "14:00-16:00 GST"]);
    const p = t.problems.find((x) => x.code === "time_outside_class")!;
    expect(p.message).toBe("GST on Day 1 is set for 2 pm–4 pm, outside the class time (9 am–11 am).");
    expect(p.fix).toMatch(/Change the section's time/);
  });
});

describe("problems are reported, never thrown", () => {
  it("class days with nothing planned", () => {
    const t = batchTimetable(batch(), [DT, GST], [...plan("dt", range(1, 5)), ...plan("gst", [8, 10])]);
    const p = t.problems.find((x) => x.code === "unplanned_days")!;
    expect(p.message).toBe("Days 6–7 and 9 have nothing planned.");
    expect(p.dayNumbers).toEqual([6, 7, 9]);
    expect(p.fix).toMatch(/Add those days to a section/);
    expect(t.days[5]).toMatchObject({ planned: false });
    expect(t.days[5].entries).toEqual([expect.objectContaining({ startTime: "09:00:00", sections: [] })]);
    const one = batchTimetable(batch(), [DT], plan("dt", range(1, 9)));
    expect(one.problems.map((x) => x.message)).toEqual(["Day 10 has nothing planned."]);
  });

  it("planned days beyond the class days the dates allow", () => {
    const t = batchTimetable(batch({ endDate: "2026-12-09" }), [DT], plan("dt", range(1, 31)));
    expect(t.classDays).toBe(28);
    expect(t.problems).toEqual([
      expect.objectContaining({ code: "beyond_dates", message: "Days 29–31 are planned but these dates only have 28 class days.", dayNumbers: [29, 30, 31] }),
    ]);
    const single = batchTimetable(batch({ endDate: "2026-12-09" }), [DT], plan("dt", [...range(1, 28), 31]));
    expect(single.problems[0].message).toBe("Day 31 is planned but these dates only have 28 class days.");
    expect(single.problems[0].fix).toMatch(/Move the end date later/);
    expect(single.lastPlannedDay).toBe(31);
    expect(single.days).toHaveLength(28);
  });

  it("sections with no faculty, and sections with no days", () => {
    const t = batchTimetable(batch(), [DT, section("gst", "GST", 1, { facultyUserId: null, facultyName: null }), REV], [...plan("dt", range(1, 5)), ...plan("gst", range(6, 10))]);
    expect(t.problems.map((p) => [p.code, p.message, p.sectionId])).toEqual([
      ["section_without_faculty", "GST has no faculty.", "gst"],
      ["section_without_days", "Revision has no days yet.", "rev"],
    ]);
  });

  it("a visiting faculty member whose access ends before one of their days", () => {
    const visiting = section("gst", "GST", 1, { facultyName: "Vikram Visiting", facultyAccessEndsOn: "2026-11-10" });
    const t = batchTimetable(batch(), [DT, visiting], [...plan("dt", range(1, 6)), ...plan("gst", range(7, 10))]);
    const p = t.problems.find((x) => x.code === "faculty_access_ends")!;
    // Day 7 (Tue 10 Nov) is still inside their access; Days 8–10 are not.
    expect(p.dayNumbers).toEqual([8, 9, 10]);
    expect(p.message).toBe("Vikram Visiting's access ends on 10 Nov 2026, before 3 of their days in GST, starting with Day 8 (Wed, 11 Nov).");
    expect(p.fix).toMatch(/Extend their access/);
    const fine = batchTimetable(batch(), [DT, { ...visiting, facultyAccessEndsOn: "2026-11-13" }], [...plan("dt", range(1, 6)), ...plan("gst", range(7, 10))]);
    expect(codes(fine)).toEqual([]);
    const one = batchTimetable(batch(), [DT, { ...visiting, facultyAccessEndsOn: "2026-11-12" }], [...plan("dt", range(1, 6)), ...plan("gst", range(7, 10))]);
    expect(one.problems[0].message).toBe("Vikram Visiting's access ends on 12 Nov 2026, before Day 10 (Fri, 13 Nov) of GST.");
  });

  it("a plan written before there are any class days", () => {
    const t = batchTimetable(batch({ slots: [] }), [DT], plan("dt", range(1, 3)));
    expect(t.days).toEqual([]);
    expect(codes(t)).toEqual(["no_class_days"]);
    expect(t.lastPlannedDay).toBe(3);
  });

  it("a batch with no plan at all", () => {
    expect(batchTimetable(batch(), [], []).problems.map((p) => p.message)).toEqual(["This batch has no sections yet."]);
    expect(batchTimetable(batch(), [DT], []).problems.map((p) => p.message)).toEqual(["No days are planned yet."]);
    expect(batchTimetable(batch(), [], []).days).toHaveLength(10);
  });

  it("ignores plan rows of a section that isn't there", () => {
    const t = batchTimetable(batch(), [DT], [...plan("dt", range(1, 10)), ...plan("ghost", [1])]);
    expect(t.days[0].entries[0].sections.map((s) => s.title)).toEqual(["Direct tax"]);
    expect(t.problems).toEqual([]);
  });
});

describe("the weekly timetable carries the plan", () => {
  const b = batch();
  const t = batchTimetable(b, [DT, GST], [...plan("dt", range(1, 5), { topic: "Residential status" }), ...plan("gst", [5, 7])]);
  const week = (from: string, to: string, viewer?: string) => annotateSessions(expandSessions([b], from, to), "b1", t, viewer);

  it("adds day number, section, its faculty and the topic", () => {
    const s = week("2026-11-02", "2026-11-08");
    expect(s[0]).toMatchObject({ date: "2026-11-02", dayNumber: 1, section: "Direct tax", sectionFaculty: ["Direct tax teacher"], topic: "Residential status" });
    expect(s[4]).toMatchObject({ dayNumber: 5, section: "Direct tax and GST", sectionFaculty: ["Direct tax teacher", "GST teacher"] });
    // Everything the callers already rely on is unchanged.
    expect(s[0]).toMatchObject({ batchId: "b1", startTime: "09:00:00", endTime: "11:00:00", faculty: ["Farah Faculty"], kind: "regular" });
  });

  it("leaves a day with no plan to the batch's faculty", () => {
    const s = week("2026-11-09", "2026-11-15");
    expect(s[0]).toMatchObject({ date: "2026-11-09", dayNumber: 6, faculty: ["Farah Faculty"] });
    expect(s[0].section).toBeUndefined();
    expect(s[0].sectionFaculty).toBeUndefined();
    expect(s[1]).toMatchObject({ dayNumber: 7, section: "GST" });
  });

  it("marks the classes a faculty member teaches", () => {
    const s = week("2026-11-02", "2026-11-10", "u-gst");
    expect(s.map((x) => x.taughtByMe ?? null)).toEqual([false, false, false, false, true, null, true]);
  });

  it("leaves other batches' sessions alone", () => {
    const other = expandSessions([batch({ batchId: "b2" })], "2026-11-02", "2026-11-02");
    expect(annotateSessions(other, "b1", t)).toEqual(other);
  });
});
