/** The DPDP numbers: breach clocks, request due dates, age, retention. Pure maths. */
import { describe, expect, it } from "vitest";
import {
  addDays,
  ageOn,
  breachDeadlines,
  countdownText,
  daysLeft,
  dueOnFor,
  isInactive,
  isMinor,
  noticeServed,
  MAX_RESPONSE_DAYS,
  REQUEST_SLA_DAYS,
} from "@/modules/privacy/lib/rules";
import { istToDate } from "@/modules/privacy/services/breaches";

const H = 3_600_000;

describe("breach deadlines (Rule 7: 72 hours from becoming aware)", () => {
  const detectedAt = new Date("2026-11-16T10:00:00Z");

  it("both clocks are due exactly 72 hours after detection", () => {
    const d = breachDeadlines({ detectedAt, boardReportAt: null, principalsNotifiedAt: null }, new Date("2026-11-17T10:00:00Z"));
    expect(d.board.due.toISOString()).toBe("2026-11-19T10:00:00.000Z");
    expect(d.principals.due.toISOString()).toBe("2026-11-19T10:00:00.000Z");
    expect(d.board.msLeft).toBe(48 * H);
    expect(d.board.overdue).toBe(false);
  });

  it("is overdue one millisecond after 72 hours, until done", () => {
    const at = new Date(detectedAt.getTime() + 72 * H + 1);
    const d = breachDeadlines({ detectedAt, boardReportAt: null, principalsNotifiedAt: new Date(detectedAt.getTime() + 10 * H) }, at);
    expect(d.board.overdue).toBe(true);
    expect(d.principals.overdue).toBe(false);
    expect(d.principals.done).toBe(true);
    expect(d.principals.doneLate).toBe(false);
  });

  it("a report filed after 72 hours counts as done, but late", () => {
    const d = breachDeadlines({ detectedAt, boardReportAt: new Date(detectedAt.getTime() + 80 * H), principalsNotifiedAt: null }, new Date(detectedAt.getTime() + 90 * H));
    expect(d.board.done).toBe(true);
    expect(d.board.overdue).toBe(false);
    expect(d.board.doneLate).toBe(true);
  });

  it("reads the countdown in days, hours and minutes", () => {
    expect(countdownText(53 * H + 20 * 60_000)).toBe("2 d 5 h left");
    expect(countdownText(5 * H + 7 * 60_000)).toBe("5 h 7 min left");
    expect(countdownText(41 * 60_000)).toBe("41 min left");
    expect(countdownText(-6 * H)).toBe("6 h 0 min overdue");
  });

  it("takes the time Zinny became aware in India time", () => {
    expect(istToDate("2026-11-16T15:30")?.toISOString()).toBe("2026-11-16T10:00:00.000Z");
    expect(istToDate("yesterday")).toBeNull();
  });
});

describe("request due dates (Rule 14)", () => {
  it("adds each kind's days, across months and years", () => {
    expect(dueOnFor("erasure", "2026-12-15")).toBe(addDays("2026-12-15", REQUEST_SLA_DAYS.erasure));
    expect(addDays("2026-12-15", 30)).toBe("2027-01-14");
    expect(dueOnFor("access", "2026-11-19")).toBe("2026-11-19");
    expect(daysLeft("2026-11-25", "2026-11-19")).toBe(6);
    expect(daysLeft("2026-11-18", "2026-11-19")).toBe(-1);
  });

  it("every promise is inside the 90-day ceiling", () => {
    for (const days of Object.values(REQUEST_SLA_DAYS)) expect(days).toBeLessThanOrEqual(MAX_RESPONSE_DAYS);
  });
});

describe("age", () => {
  it("turns 18 on the birthday, not the day before", () => {
    expect(ageOn("2008-11-19", "2026-11-18")).toBe(17);
    expect(ageOn("2008-11-19", "2026-11-19")).toBe(18);
    expect(isMinor("2008-11-20", "2026-11-19")).toBe(true);
    expect(isMinor("2008-11-19", "2026-11-19")).toBe(false);
  });
});

describe("retention", () => {
  const now = new Date("2026-11-19T00:00:00Z");
  it("is inactive only past the period", () => {
    expect(isInactive(new Date("2023-11-18T00:00:00Z"), 1095, now)).toBe(true);
    expect(isInactive(new Date("2024-01-01T00:00:00Z"), 1095, now)).toBe(false);
  });
  it("waits 48 hours after telling the person (Rule 8(2))", () => {
    expect(noticeServed(new Date(now.getTime() - 47 * H), now)).toBe(false);
    expect(noticeServed(new Date(now.getTime() - 48 * H), now)).toBe(true);
  });
});
