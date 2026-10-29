/**
 * Cross-module flow (wave 1 integration): class attendance.
 * A student joins a live class inside its window (live-classes) → marked present →
 * `attendance.marked` → XP for attendance (gamification) → the attendance report and the
 * faculty's "attendance today" dashboard data show it.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { reports } from "@/server/registry";
import { joinClass } from "@/modules/live-classes/join";
import { todaysClasses } from "@/modules/live-classes/overview";
import { attendanceReport } from "@/modules/live-classes/reports";
import { createRule } from "@/modules/gamification/rules";
import { gamXpLedger } from "@/modules/gamification/schema";
import { drainEvents, eventsOfType } from "../helpers/events";
import { ist, liveSetup, MON } from "../live-classes/helpers";

afterAll(closeDb);

describe("class attendance across modules", () => {
  it("join in the window → present → XP → attendance report and dashboard", async () => {
    const w = await liveSetup("Attendance Flow University", { students: 2 });
    await createRule(w.admin, { name: "Live class attended", trigger: "class-present", points: 15 });
    const [riya] = w.students;

    // live-classes: joining 5 minutes after the start marks Riya present and sends her to the meeting.
    const now = ist(MON, "09:05");
    expect(await joinClass(riya, w.batch.id, MON, null, now)).toMatchObject({ kind: "go", status: "present" });
    const marked = (await eventsOfType("attendance.marked", w.uni.id)).filter((e) => e.payload.userId === riya.userId);
    expect(marked.map((e) => e.payload)).toEqual([{ batchId: w.batch.id, date: MON, startTime: "09:00", userId: riya.userId, status: "present" }]);

    // gamification: 15 XP for the class, once, even if the event is delivered again.
    await drainEvents({ universityId: w.uni.id });
    await drainEvents({ universityId: w.uni.id });
    const xp = await systemDb().select().from(gamXpLedger).where(eq(gamXpLedger.userId, riya.userId));
    expect(xp.map((r) => [r.eventType, r.points])).toEqual([["attendance.marked", 15]]);

    // Dashboard card data for the faculty: today's class with one present.
    const today = await todaysClasses(w.faculty, ist(MON, "09:30"));
    const cls = today.classes.find((c) => c.batchId === w.batch.id);
    expect(cls).toMatchObject({ present: 1 });

    // Reports: the registered attendance report counts the class for Riya. The fixture's class is
    // in 2030, so the report runs with that day's clock (its `now` argument), after the class.
    expect(reports().some((r) => r.id === "live-classes.attendance")).toBe(true);
    const run = await attendanceReport(w.hod, { from: MON, to: MON, batchId: w.batch.id }, ist(MON, "12:00"));
    const row = run.rows.find((r) => r.student === riya.name);
    expect(row).toMatchObject({ present: 1 });
  });
});
