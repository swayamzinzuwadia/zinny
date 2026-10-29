import { describe, expect, it } from "vitest";
import {
  addDays,
  canJoinAt,
  formatDay,
  hhmm,
  isClockTime,
  isIsoDate,
  localParts,
  percent,
  pickSession,
  relativeDay,
  relativeDayInline,
  safeMeetingUrl,
  sessionState,
  sessionWindow,
  startsIn,
  statusForJoin,
  weekStart,
  zonedInstant,
} from "@/modules/live-classes/time";

const IST = "Asia/Kolkata";
const at = (iso: string) => new Date(iso);

describe("live-classes time rules", () => {
  it("turns a wall-clock time in the university's zone into the right instant", () => {
    expect(zonedInstant("2030-11-04", "09:00", IST).toISOString()).toBe("2030-11-04T03:30:00.000Z");
    expect(zonedInstant("2030-11-04", "00:10", IST).toISOString()).toBe("2030-11-03T18:40:00.000Z");
    // Daylight saving: New York is UTC-4 in July and UTC-5 in December.
    expect(zonedInstant("2030-07-01", "09:00", "America/New_York").toISOString()).toBe("2030-07-01T13:00:00.000Z");
    expect(zonedInstant("2030-12-02", "09:00", "America/New_York").toISOString()).toBe("2030-12-02T14:00:00.000Z");
    expect(localParts(at("2030-11-04T03:30:00Z"), IST)).toMatchObject({ date: "2030-11-04", time: "09:00" });
  });

  it("the join window opens 15 minutes before the start and closes at the end", () => {
    const w = sessionWindow({ date: "2030-11-04", startTime: "09:00", endTime: "11:00" }, IST);
    expect(sessionState(w, at("2030-11-04T03:14:59Z"))).toBe("upcoming"); // 8:44:59 am
    expect(sessionState(w, at("2030-11-04T03:15:00Z"))).toBe("open"); // 8:45 am
    expect(sessionState(w, at("2030-11-04T03:30:00Z"))).toBe("live"); // 9:00 am
    expect(sessionState(w, at("2030-11-04T05:29:59Z"))).toBe("live"); // 10:59:59 am
    expect(sessionState(w, at("2030-11-04T05:30:00Z"))).toBe("ended"); // 11:00 am
    expect(canJoinAt(w, at("2030-11-04T03:14:59Z"))).toBe(false);
    expect(canJoinAt(w, at("2030-11-04T03:15:00Z"))).toBe(true);
    expect(canJoinAt(w, at("2030-11-04T05:30:00Z"))).toBe(false);
  });

  it("joining up to 10 minutes after the start is present; later is late", () => {
    const w = sessionWindow({ date: "2030-11-04", startTime: "09:00", endTime: "11:00" }, IST);
    expect(statusForJoin(w, at("2030-11-04T03:20:00Z"))).toBe("present"); // 8:50, early
    expect(statusForJoin(w, at("2030-11-04T03:40:00Z"))).toBe("present"); // 9:10 exactly
    expect(statusForJoin(w, at("2030-11-04T03:40:01Z"))).toBe("late"); // 9:10:01
    expect(statusForJoin(w, at("2030-11-04T05:00:00Z"))).toBe("late"); // 10:30
  });

  it("a class that runs past midnight ends the next day", () => {
    const w = sessionWindow({ date: "2030-11-04", startTime: "23:00", endTime: "01:00" }, IST);
    expect(w.endsAt.getTime() - w.startsAt.getTime()).toBe(2 * 3600_000);
  });

  it("picks the right class when a batch has two on one day", () => {
    const day = [
      { date: "2030-11-04", startTime: "09:00", endTime: "10:00", id: "a" },
      { date: "2030-11-04", startTime: "15:00", endTime: "16:00", id: "b" },
    ];
    expect(pickSession(day, at("2030-11-04T03:20:00Z"), IST)?.id).toBe("a"); // 8:50 → morning open
    expect(pickSession(day, at("2030-11-04T06:00:00Z"), IST)?.id).toBe("b"); // 11:30 → next to open
    expect(pickSession(day, at("2030-11-04T12:00:00Z"), IST)?.id).toBe("b"); // 5:30 pm → last of day
    expect(pickSession(day, at("2030-11-04T12:00:00Z"), IST, "09:00")?.id).toBe("a");
    expect(pickSession(day, at("2030-11-04T12:00:00Z"), IST, "12:00")).toBeNull();
    expect(pickSession([], at("2030-11-04T12:00:00Z"), IST)).toBeNull();
  });

  it("follows only web links", () => {
    expect(safeMeetingUrl("https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(safeMeetingUrl("  http://zoom.us/j/1  ")).toBe("http://zoom.us/j/1");
    expect(safeMeetingUrl("javascript:alert(1)")).toBeNull();
    expect(safeMeetingUrl("data:text/html,hi")).toBeNull();
    expect(safeMeetingUrl("meet.google.com/abc")).toBeNull();
    expect(safeMeetingUrl("")).toBeNull();
    expect(safeMeetingUrl(null)).toBeNull();
  });

  it("validates dates and times strictly", () => {
    expect(isIsoDate("2030-11-04")).toBe(true);
    expect(isIsoDate("2030-02-30")).toBe(false);
    expect(isIsoDate("2030-11-4")).toBe(false);
    expect(isIsoDate("../../etc")).toBe(false);
    expect(isClockTime("09:00")).toBe(true);
    expect(isClockTime("24:00")).toBe(false);
    expect(hhmm("9:00:00")).toBe("09:00");
  });

  it("percentages, weeks and labels", () => {
    expect(percent(3, 4)).toBe(75);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBeNull();
    expect(weekStart("2030-11-09")).toBe("2030-11-04");
    expect(weekStart("2030-11-04")).toBe("2030-11-04");
    expect(addDays("2030-12-31", 1)).toBe("2031-01-01");
    expect(relativeDay("2030-11-04", "2030-11-04")).toBe("Today");
    expect(relativeDay("2030-11-05", "2030-11-04")).toBe("Tomorrow");
    expect(relativeDayInline("2030-11-04", "2030-11-04")).toBe("today");
    expect(relativeDayInline("2030-11-09", "2030-11-04")).toMatch(/^on Sat, 9 Nov$/);
    expect(formatDay("2030-11-09")).toMatch(/Sat.*9 Nov/);
    expect(startsIn(45 * 60_000)).toBe("in 45 min");
    expect(startsIn(80 * 60_000)).toBe("in 1 h 20 min");
  });
});
