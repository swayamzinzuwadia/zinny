import { describe, expect, it } from "vitest";
import {
  batchFillTakeaway,
  completionTakeaway,
  enrolmentsTakeaway,
  facultyTakeaway,
  revenueCourseTakeaway,
  revenueMonthTakeaway,
  type BatchFill,
  type FacultyLoad,
  type WeekPoint,
} from "@/modules/reports-board/lib/takeaways";

const weeks = (counts: number[]): WeekPoint[] =>
  counts.map((count, i) => ({ start: `2026-0${1 + Math.floor(i / 4)}-0${1 + (i % 4)}`, label: "", count, current: i === counts.length - 1 }));

describe("enrolment takeaways", () => {
  it("covers an empty chart, a record week, and ups and downs", () => {
    expect(enrolmentsTakeaway(weeks([0, 0, 0]))).toBe("No enrolments in the last 12 weeks.");
    expect(enrolmentsTakeaway(weeks([2, 1, 31]))).toBe("31 enrolments this week, the most in 12 weeks. 34 enrolments in all.");
    expect(enrolmentsTakeaway(weeks([2, 5, 3]))).toBe("3 enrolments this week, down from 5 last week.");
    expect(enrolmentsTakeaway(weeks([9, 1, 3]))).toBe("3 enrolments this week, up from 1 last week.");
    expect(enrolmentsTakeaway(weeks([4, 1, 1]))).toBe("1 enrolment this week, the same as last week.");
    expect(enrolmentsTakeaway(weeks([4, 4, 4]))).toBe("4 enrolments this week, the same as last week.");
  });
});

describe("completion takeaways", () => {
  const c = (title: string, enrolled: number, completed: number) => ({
    courseId: title, title, department: "CS", enrolled, completed, learning: enrolled - completed, rate: enrolled ? (completed / enrolled) * 100 : 0,
  });
  it("says when nothing is enrolled or completed yet", () => {
    expect(completionTakeaway([])).toBe("Nobody has enrolled yet, so there are no completions to show.");
    expect(completionTakeaway([c("A", 30, 0), c("B", 1, 0)])).toBe("No learner has completed a course yet. 31 learners are still learning.");
    expect(completionTakeaway([c("A", 1, 0)])).toBe("No learner has completed a course yet. 1 learner is still learning.");
  });
  it("names the leading course and the overall rate", () => {
    expect(completionTakeaway([c("Python Basics", 10, 4), c("Data Analytics", 10, 1)])).toBe(
      "Python Basics leads at 40% (4 of 10). 25% complete across all courses.",
    );
  });
});

describe("revenue takeaways", () => {
  const months = (paise: number[]) => paise.map((p, i) => ({ start: "", label: "", paise: p, current: i === paise.length - 1 }));
  it("compares this month with last month", () => {
    expect(revenueMonthTakeaway(months([0, 0]))).toBe("No revenue in the last 12 months.");
    expect(revenueMonthTakeaway(months([0, 5_300_000]))).toBe("₹53,000 so far this month, against nothing last month. ₹53,000 in the last 12 months.");
    expect(revenueMonthTakeaway(months([1_000_000, 1_200_000]))).toBe("₹12,000 so far this month, 20% up on last month's ₹10,000.");
    expect(revenueMonthTakeaway(months([1_000_000, 500_000]))).toBe("₹5,000 so far this month, 50% down on last month's ₹10,000.");
    expect(revenueMonthTakeaway(months([1_000_000, 1_000_000]))).toBe("₹10,000 so far this month, level with last month's ₹10,000.");
  });
  it("names the course that earns the most", () => {
    expect(revenueCourseTakeaway([])).toBe("No course has earned revenue in the last 12 months.");
    expect(revenueCourseTakeaway([{ courseId: "a", title: "Data Analytics", paise: 3_000_000 }])).toBe(
      "All revenue in the last 12 months came from Data Analytics: ₹30,000.",
    );
    expect(
      revenueCourseTakeaway([
        { courseId: "a", title: "Data Analytics", paise: 3_000_000 },
        { courseId: "b", title: "Python Basics", paise: 1_000_000 },
      ]),
    ).toBe("Data Analytics earns the most: ₹30,000, 75% of the last 12 months.");
  });
});

describe("faculty load takeaways", () => {
  const f = (name: string, thisWeek: number, batches: number, nextWeek = 0): FacultyLoad => ({ userId: name, name, batches, lastWeek: 0, thisWeek, nextWeek });
  it("names the busiest faculty member", () => {
    expect(facultyTakeaway([])).toBe("No faculty are assigned to batches yet.");
    expect(facultyTakeaway([f("Farah", 26, 4), f("Neel", 4, 1)])).toBe(
      "Farah teaches the most this week: 26 hours across 4 batches. 1 other faculty member teaches this week.",
    );
    expect(facultyTakeaway([f("Farah", 1.5, 1)])).toBe("Farah teaches the most this week: 1.5 hours across 1 batch.");
  });
  it("looks ahead when this week is empty", () => {
    expect(facultyTakeaway([f("Farah", 0, 0, 10)])).toBe("No classes are scheduled this week. Next week has 10 hours of teaching.");
    expect(facultyTakeaway([f("Farah", 0, 0, 0)])).toBe("No classes are scheduled this week or next.");
  });
});

describe("batch fill takeaways", () => {
  const b = (batch: string, taken: number, limit: number): BatchFill => ({
    batchId: batch, course: "Data Analytics", batch, taken, held: 0, limit, fill: (taken / limit) * 100, startsOn: null,
  });
  it("calls out full and nearly full batches", () => {
    expect(batchFillTakeaway([])).toBe("No batches are running or open for enrolment.");
    expect(batchFillTakeaway([b("Weekend", 3, 3), b("Morning", 8, 10)])).toBe(
      "Data Analytics · Weekend is full, and 1 more is at least 80% full.",
    );
    expect(batchFillTakeaway([b("Weekend", 3, 3), b("Morning", 2, 10)])).toBe("Data Analytics · Weekend is full. Every other batch has seats left.");
    expect(batchFillTakeaway([b("Weekend", 3, 3), b("Morning", 10, 10)])).toBe("2 batches are full. Every other batch has seats left.");
    expect(batchFillTakeaway([b("Morning", 4, 10), b("Evening", 1, 10)])).toBe(
      "Every batch has seats left. The fullest is Data Analytics · Morning at 40% (4 of 10).",
    );
    expect(batchFillTakeaway([b("Morning", 0, 10)])).toBe("No seats are taken yet in any running or open batch.");
  });
});
