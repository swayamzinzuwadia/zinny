import { describe, expect, it } from "vitest";
import type { DomainEvent } from "@/contracts/events";
import { describeTrigger, TRIGGERS } from "@/modules/gamification/catalog";
import { conditionMet, normalise } from "@/modules/gamification/engine";
import { addDays, dateIn, displayName, isIsoDate, longestAttendanceStreak, periodStart, rankRows, weekStart } from "@/modules/gamification/util";

const ev = (type: string, payload: Record<string, unknown>) =>
  ({ id: "e1", universityId: "u1", type, payload, actorUserId: null, occurredAt: new Date("2026-10-29T10:00:00Z") }) as unknown as DomainEvent;
const user = "11111111-1111-4111-8111-111111111111";
const batch = "22222222-2222-4222-8222-222222222222";

describe("name display", () => {
  it("shows first name and initial, or the full name", () => {
    expect(displayName("Riya Sharma", "first_initial")).toBe("Riya S.");
    expect(displayName("  Meera   Anand Nair ", "first_initial")).toBe("Meera N.");
    expect(displayName("Zoya", "first_initial")).toBe("Zoya");
    expect(displayName("riya sharma", "first_initial")).toBe("riya S.");
    expect(displayName("Riya  Sharma", "full")).toBe("Riya Sharma");
  });
});

describe("ranking", () => {
  it("gives ties the same rank and skips the next", () => {
    const rows = rankRows([
      { userId: "e", name: "Eve", points: 0 },
      { userId: "b", name: "Bob", points: 30 },
      { userId: "a", name: "Ann", points: 50 },
      { userId: "c", name: "Cat", points: 30 },
      { userId: "d", name: "Dan", points: 30 },
      { userId: "f", name: "Fay", points: 10 },
    ]);
    expect(rows.map((r) => `${r.rank} ${r.name}`)).toEqual(["1 Ann", "2 Bob", "2 Cat", "2 Dan", "5 Fay", "6 Eve"]);
  });

  it("everyone tied at zero shares first place", () => {
    expect(rankRows([{ userId: "x", name: "X", points: 0 }, { userId: "y", name: "Y", points: 0 }]).map((r) => r.rank)).toEqual([1, 1]);
  });
});

describe("dates and periods", () => {
  it("starts weeks on Monday and months on the 1st", () => {
    expect(weekStart("2026-10-29")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sunday
    expect(periodStart("2026-10-29", "week")).toBe("2026-10-26");
    expect(periodStart("2026-10-29", "month")).toBe("2026-10-01");
    expect(periodStart("2026-10-29", "all")).toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("uses the university's time zone for the day", () => {
    const lateEvening = new Date("2026-10-29T20:00:00Z"); // 01:30 on the 30th in India
    expect(dateIn("Asia/Kolkata", lateEvening)).toBe("2026-10-30");
    expect(dateIn("UTC", lateEvening)).toBe("2026-10-29");
  });

  it("rejects impossible dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("29-10-2026")).toBe(false);
  });
});

describe("attendance streaks", () => {
  const week = (start: string, statuses: string[]) => statuses.map((status, i) => ({ date: addDays(start, i), status }));
  it("counts weeks in a row with every marked class attended", () => {
    const marks = [
      ...week("2026-10-05", ["present", "late"]),
      ...week("2026-10-12", ["present"]),
      ...week("2026-10-19", ["present", "present"]),
      ...week("2026-10-26", ["late"]),
    ];
    expect(longestAttendanceStreak(marks)).toBe(4);
  });

  it("an absence or a week with no class breaks the run", () => {
    expect(longestAttendanceStreak([...week("2026-10-05", ["present"]), ...week("2026-10-12", ["present", "absent"]), ...week("2026-10-19", ["present"])])).toBe(1);
    expect(longestAttendanceStreak([...week("2026-10-05", ["present"]), ...week("2026-10-19", ["present"]), ...week("2026-10-26", ["present"])])).toBe(2);
    expect(longestAttendanceStreak([])).toBe(0);
  });
});

describe("reading events", () => {
  it("normalises each source event and drops malformed ones", () => {
    expect(normalise(ev("lesson.completed", { userId: user, courseId: "c1", lessonId: "l1" }))).toMatchObject({ kind: "lesson", subjectKey: "l1", courseId: null });
    expect(normalise(ev("attendance.marked", { userId: user, batchId: batch, date: "2026-10-29", startTime: "09:00:00", status: "late" }))).toMatchObject({
      kind: "class",
      subjectKey: `${batch}|2026-10-29|09:00`,
      date: "2026-10-29",
      status: "late",
    });
    expect(normalise(ev("attendance.marked", { userId: user, batchId: batch, date: "yesterday", startTime: "09:00", status: "present" }))).toBeNull();
    expect(normalise(ev("lesson.completed", { userId: "someone", courseId: null, lessonId: "l1" }))).toBeNull();
    expect(normalise(ev("lesson.completed", { userId: user, lessonId: "" }))).toBeNull();
    expect(normalise(ev("enquiry.received", { userId: user }))).toBeNull();
  });

  it("checks conditions, and never pays for an absence", () => {
    const a = (p: Record<string, unknown>, type = "test.submitted") => normalise(ev(type, { userId: user, testId: "t", assignmentId: "a", batchId: batch, date: "2026-10-29", startTime: "09:00", ...p }))!;
    expect(conditionMet({ condition: "passed", minScore: null }, a({ passed: true, scorePercent: 40 }))).toBe(true);
    expect(conditionMet({ condition: "min_score", minScore: 90 }, a({ passed: true, scorePercent: 89.9 }))).toBe(false);
    expect(conditionMet({ condition: "min_score", minScore: 90 }, a({ passed: true, scorePercent: 90 }))).toBe(true);
    expect(conditionMet({ condition: "none", minScore: null }, a({ status: "absent" }, "attendance.marked"))).toBe(false);
    expect(conditionMet({ condition: "present", minScore: null }, a({ status: "late" }, "attendance.marked"))).toBe(false);
    expect(conditionMet({ condition: "present_or_late", minScore: null }, a({ status: "late" }, "attendance.marked"))).toBe(true);
    expect(conditionMet({ condition: "on_time", minScore: null }, a({ late: false }, "assignment.submitted"))).toBe(true);
    expect(conditionMet({ condition: "on_time", minScore: null }, a({ late: true }, "assignment.submitted"))).toBe(false);
  });

  it("describes every trigger in plain words", () => {
    expect(describeTrigger({ eventType: "test.submitted", condition: "min_score", minScore: 90 })).toBe("Scoring at least 90% on a test");
    for (const t of TRIGGERS) expect(describeTrigger({ eventType: t.event, condition: t.condition, minScore: 50 })).not.toMatch(/N%/);
  });
});
