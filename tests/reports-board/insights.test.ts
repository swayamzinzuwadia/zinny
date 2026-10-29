import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { enrolments } from "@/db/schema";
import { loadActor } from "@/server/actor";
import { markEnrolmentCompleted } from "@/server/core";
import { ForbiddenError } from "@/server/errors";
import { createBatch } from "@/server/services/batches";
import { canOpenInsights, loadInsights, teachersAt } from "@/modules/reports-board/insights";
import { addDays, todayIn, weekStart, zonedInstant } from "@/modules/reports-board/lib/dates";
import { person, slots } from "../fixtures";
import { setupReports, type ReportsWorld } from "./setup";

afterAll(closeDb);

/** A Thursday. This week runs from Monday 26 Oct; 12 weeks go back to 10 Aug. */
const NOW = new Date("2026-10-29T06:00:00Z");

let w: ReportsWorld;
beforeAll(async () => {
  w = await setupReports("Insights University");
  // Kabir finishes Data Analytics; Ishaan's seat is being paid for right now.
  const [kabir] = await systemDb().select().from(enrolments).where(eq(enrolments.userId, w.students.s2.userId));
  await markEnrolmentCompleted(w.admin, kabir.id);
  await systemDb()
    .update(enrolments)
    .set({ holdExpiresAt: new Date(Date.now() + 60 * 60_000) })
    .where(eq(enrolments.userId, w.students.s4.userId));
});

describe("who can open Insights", () => {
  it("lets in admins, Board / Owner and Heads of Department", async () => {
    for (const a of [w.admin, w.board, w.hod, w.mehul]) {
      expect(canOpenInsights(a)).toBe(true);
      await expect(loadInsights(a, NOW)).resolves.toBeTruthy();
    }
  });

  it("keeps out faculty, Accounts & Fees and students", async () => {
    for (const a of [w.faculty, w.accounts, w.studentOnly]) {
      expect(canOpenInsights(a)).toBe(false);
      await expect(loadInsights(a, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("enrolments, completion and revenue", () => {
  it("counts enrolments per week for the last 12 weeks, marking this week", async () => {
    const data = await loadInsights(w.admin, NOW);
    expect(data.today).toBe("2026-10-29");
    expect(data.weekOf).toBe("2026-10-26");
    expect(data.enrolmentsByWeek).toHaveLength(12);
    expect(data.enrolmentsByWeek[0].start).toBe("2026-08-10");
    expect(data.enrolmentsByWeek.filter((x) => x.current).map((x) => x.start)).toEqual(["2026-10-26"]);
    const byWeek = Object.fromEntries(data.enrolmentsByWeek.filter((x) => x.count).map((x) => [x.start, x.count]));
    // Kabir paid at 00:15 on Friday 2 Oct in India, so his week is 28 Sep; Meera's Sunday 25 Oct belongs to 19 Oct.
    expect(byWeek).toEqual({ "2026-09-14": 1, "2026-09-28": 1, "2026-10-05": 1, "2026-10-19": 3 });
    expect(data.stats.enrolmentsThisWeek).toBe(0);
  });

  it("works out completion per course from enrolment status", async () => {
    const data = await loadInsights(w.admin, NOW);
    expect(data.completion.map((c) => [c.title, c.enrolled, c.completed, c.learning, c.rate])).toEqual([
      ["Data Analytics", 4, 1, 3, 25],
      ["Digital Marketing", 2, 0, 2, 0],
    ]);
    expect(data.stats.completionRate).toBeCloseTo((1 / 6) * 100);
    expect(data.stats.activeLearners).toBe(4); // Riya, Aditi, the =HYPERLINK student and Meera
  });

  it("shows revenue before GST, per month and per course, without refunded orders", async () => {
    for (const a of [w.admin, w.board]) {
      const { revenue, stats } = await loadInsights(a, NOW);
      expect(revenue).not.toBeNull();
      expect(revenue!.byMonth).toHaveLength(12);
      expect(revenue!.byMonth[11]).toMatchObject({ start: "2026-10-01", current: true, paise: 2 * 10_000_00 });
      expect(revenue!.byMonth[10]).toMatchObject({ start: "2026-09-01", current: false, paise: 10_000_00 });
      expect(revenue!.byMonth[0].start).toBe("2025-11-01");
      expect(revenue!.byCourse).toEqual([{ courseId: w.course.id, title: "Data Analytics", paise: 3 * 10_000_00 }]);
      expect(stats.revenueThisMonthPaise).toBe(2 * 10_000_00);
    }
  });

  it("hides revenue from a Head of Department and keeps them to their department", async () => {
    const data = await loadInsights(w.hod, NOW);
    expect(data.revenue).toBeNull();
    expect(data.stats.revenueThisMonthPaise).toBeNull();
    expect(data.scopeLabel).toBe("Computer Science");
    expect(data.wholeUniversity).toBe(false);
    expect(data.completion.map((c) => c.title)).toEqual(["Data Analytics"]);
    expect(data.enrolmentsByWeek.reduce((n, x) => n + x.count, 0)).toBe(4);
    expect(data.batchFill.map((b) => b.course)).toEqual(["Data Analytics"]);

    const mkt = await loadInsights(w.mehul, NOW);
    expect(mkt.scopeLabel).toBe("Marketing");
    expect(mkt.completion.map((c) => c.title)).toEqual(["Digital Marketing"]);
    expect(mkt.enrolmentsByWeek.reduce((n, x) => n + x.count, 0)).toBe(2);
  });

  it("shows seats taken against the limit for running and upcoming batches", async () => {
    const data = await loadInsights(w.admin, NOW);
    expect(data.scopeLabel).toBe("the whole university");
    expect(data.batchFill.map((b) => [b.course, b.batch, b.taken, b.held, b.limit])).toEqual([
      ["Data Analytics", "Weekday morning", 3, 1, 20],
      ["Digital Marketing", "Evening", 2, 0, 25],
    ]);
    expect(data.batchFill[0].fill).toBe(15);
    expect(data.batchFill[0].startsOn).toBe("2030-11-04");
    expect(data.stats.openBatches).toBe(2);
  });
});

describe("faculty load", () => {
  it("adds up scheduled hours per faculty member for last, this and next week", async () => {
    const today = todayIn("Asia/Kolkata");
    const monday = weekStart(today);
    const csFaculty = await loadActor(w.facultyUserId, w.uni.id);
    expect(csFaculty).toBeTruthy();
    // Vikram is a visiting member whose access ends at the start of next week.
    const vikramEnds = zonedInstant(addDays(monday, 7), "00:00", "Asia/Kolkata");
    const vikram = await person("Vikram Visiting", "visiting_faculty", { universityId: w.uni.id, departmentId: w.cs.id });
    const running = { startDate: addDays(today, -60), endDate: addDays(today, 60), courseId: w.course.id, seatLimit: 10 };
    await createBatch(w.hod, { ...running, name: "Running weekdays", slots: slots([1, 2, 3, 4, 5], "07:00", "09:00"), faculty: [{ userId: w.facultyUserId, role: "permanent_faculty" }] });
    await createBatch(w.hod, { ...running, name: "Running Saturday", slots: slots([6], "14:00", "17:00"), faculty: [{ userId: w.facultyUserId, role: "permanent_faculty" }] });
    await createBatch(w.hod, {
      ...running,
      name: "Running evenings",
      slots: slots([2, 4], "18:00", "20:00"),
      faculty: [{ userId: vikram.user.id, role: "visiting_faculty", endsAt: vikramEnds }],
    });
    await createBatch(w.mehul, {
      ...running,
      courseId: w.dm.id,
      name: "Running marketing",
      slots: slots([1], "10:00", "11:30"),
      faculty: [{ userId: w.neelUserId, role: "permanent_faculty" }],
    });

    const data = await loadInsights(w.admin);
    const by = Object.fromEntries(data.facultyLoad.map((f) => [f.name, f]));
    expect(by["Faculty Farah"]).toMatchObject({ lastWeek: 13, thisWeek: 13, nextWeek: 13, batches: 2 });
    expect(by["Vikram Visiting"]).toMatchObject({ lastWeek: 4, thisWeek: 4, nextWeek: 0, batches: 1 });
    expect(by["Neel Faculty"]).toMatchObject({ lastWeek: 1.5, thisWeek: 1.5, nextWeek: 1.5, batches: 1 });
    expect(data.facultyLoad[0].name).toBe("Faculty Farah");

    // A HOD sees only their own department's faculty.
    const hod = await loadInsights(w.hod);
    expect(hod.facultyLoad.map((f) => f.name).sort()).toEqual(["Faculty Farah", "Vikram Visiting"]);
  });
});

describe("who teaches a session", () => {
  const at = (iso: string) => new Date(iso);
  const a = (userId: string, startsAt: string, endsAt: string | null = null, revokedAt: string | null = null) => ({
    userId, batchId: "b", startsAt: at(startsAt), endsAt: endsAt ? at(endsAt) : null, revokedAt: revokedAt ? at(revokedAt) : null,
  });
  const who = (list: ReturnType<typeof a>[], when: string) => teachersAt(list, at(when)).map((x) => x.userId);

  it("credits whoever was assigned when the class starts, across a handover", () => {
    const list = [a("old", "2026-01-01T00:00:00Z", null, "2026-10-28T00:00:00Z"), a("new", "2026-10-28T00:00:00Z")];
    expect(who(list, "2026-10-27T04:00:00Z")).toEqual(["old"]);
    expect(who(list, "2026-10-29T04:00:00Z")).toEqual(["new"]);
  });

  it("stops at a visiting faculty member's end date", () => {
    expect(who([a("visit", "2026-10-01T00:00:00Z", "2026-11-02T00:00:00Z")], "2026-11-03T04:00:00Z")).toEqual([]);
  });

  it("credits the first people assigned when a running batch was set up late", () => {
    const list = [a("first", "2026-10-28T00:00:00Z"), a("second", "2026-10-28T00:00:00Z"), a("later", "2026-11-15T00:00:00Z")];
    expect(who(list, "2026-10-20T04:00:00Z").sort()).toEqual(["first", "second"]);
    // Someone who had already left by the time they were recorded gets nothing.
    expect(who([a("gone", "2026-10-28T00:00:00Z", "2026-10-28T00:00:00Z")], "2026-10-20T04:00:00Z")).toEqual([]);
  });
});
