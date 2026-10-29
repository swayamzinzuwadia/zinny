import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { domainEventDeliveries, domainEvents } from "@/db/schema";
import type { DomainEvent } from "@/contracts/events";
import { todayFor, withTenant } from "@/server/core";
import { processEvent } from "@/modules/gamification/engine";
import { applyRuleToPast, createRule, setRuleActive } from "@/modules/gamification/rules";
import { gamActivity, gamXpLedger } from "@/modules/gamification/schema";
import { eventsOfType } from "../helpers/events";
import { makeUniversity, makeUser } from "../fixtures";
import { fakeId, world, type World } from "./world";

let w: World;
let today: string;

beforeAll(async () => {
  w = await world("Awarding University");
  today = await withTenant(w.sys, (tx) => todayFor(tx));
});
afterAll(closeDb);

const ledger = (userId: string, ruleId?: string) =>
  systemDb()
    .select()
    .from(gamXpLedger)
    .where(and(eq(gamXpLedger.userId, userId), ruleId ? eq(gamXpLedger.ruleId, ruleId) : undefined));

const xpOf = async (userId: string, ruleId?: string) => (await ledger(userId, ruleId)).reduce((n, r) => n + r.points, 0);

async function eventRow(id: string): Promise<DomainEvent> {
  const [e] = await systemDb().select().from(domainEvents).where(eq(domainEvents.id, id));
  return e as unknown as DomainEvent;
}

describe("awarding XP from events", () => {
  it("awards a matching rule, records it in the ledger and emits xp.awarded", async () => {
    const rule = await createRule(w.admin, { name: "Lesson finished", trigger: "lesson", points: 10 });
    const s = await w.enrolled("Riya Sharma", [w.batch.id]);
    const eventId = await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await w.drain();

    const rows = await ledger(s.id, rule.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ points: 10, reason: "Lesson finished", sourceEventId: eventId, courseId: w.course.id, batchId: w.batch.id, departmentId: w.dept.id, awardDate: today });
    const awarded = (await eventsOfType("xp.awarded", w.uni.id)).filter((e) => (e.payload as { userId: string }).userId === s.id);
    expect(awarded.map((e) => e.payload)).toEqual([{ userId: s.id, points: 10, reason: "Lesson finished", sourceEventId: eventId }]);
    await setRuleActive(w.admin, rule.id, false);
  });

  it("awards once when the same event is delivered twice", async () => {
    const rule = await createRule(w.admin, { name: "Passed a test", trigger: "test-passed", points: 50 });
    const s = await w.enrolled("Kabir Mehta", [w.batch.id]);
    const eventId = await w.send("test.submitted", {
      attemptId: fakeId(),
      testId: fakeId(),
      userId: s.id,
      courseId: w.course.id,
      batchId: w.batch.id,
      scorePercent: 72,
      passed: true,
    });
    await w.drain();
    // At-least-once delivery: forget that it was delivered, then deliver it again.
    await systemDb().delete(domainEventDeliveries).where(eq(domainEventDeliveries.eventId, eventId));
    const again = await w.drain();
    expect(again.delivered).toBeGreaterThan(0);
    // And straight through the engine a third time.
    const third = await withTenant(w.sys, async (tx) => processEvent(tx, w.sys, await eventRow(eventId)));
    expect(third.awards).toEqual([]);

    expect(await ledger(s.id, rule.id)).toHaveLength(1);
    const awarded = (await eventsOfType("xp.awarded", w.uni.id)).filter((e) => (e.payload as { sourceEventId: string }).sourceEventId === eventId);
    expect(awarded).toHaveLength(1);
    const activity = await systemDb().select().from(gamActivity).where(eq(gamActivity.sourceEventId, eventId));
    expect(activity).toHaveLength(1);
    await setRuleActive(w.admin, rule.id, false);
  });

  it("awards a lesson, test or class once per rule, even from separate events", async () => {
    const rule = await createRule(w.admin, { name: "Lesson again", trigger: "lesson", points: 5 });
    const s = await w.enrolled("Aditi Rao", [w.batch.id]);
    const lessonId = fakeId();
    await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId });
    await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId });
    await w.drain();
    expect(await ledger(s.id, rule.id)).toHaveLength(1);
    await setRuleActive(w.admin, rule.id, false);
  });

  it("holds the daily cap per rule, per student, per day", async () => {
    const rule = await createRule(w.admin, { name: "Class attended", trigger: "class-attended", points: 15, dailyCap: 2 });
    const s = await w.enrolled("Ishaan Gupta", [w.batch.id]);
    const mark = (date: string, startTime: string) => w.send("attendance.marked", { batchId: w.batch.id, date, startTime, userId: s.id, status: "present" });
    for (const t of ["09:00", "11:00", "13:00", "15:00"]) await mark("2030-11-04", t);
    await mark("2030-11-05", "09:00");
    await w.drain();
    const rows = await ledger(s.id, rule.id);
    expect(rows.filter((r) => r.awardDate === "2030-11-04")).toHaveLength(2);
    expect(rows.filter((r) => r.awardDate === "2030-11-05")).toHaveLength(1);
    // The class date is the day it counts for, not the day it was marked.
    expect(await xpOf(s.id, rule.id)).toBe(45);
    await setRuleActive(w.admin, rule.id, false);
  });

  it("holds the daily cap when several deliveries run at the same time", async () => {
    const rule = await createRule(w.admin, { name: "Busy day", trigger: "lesson", points: 10, dailyCap: 3 });
    const s = await w.enrolled("Meera Nair", [w.batch.id]);
    for (let i = 0; i < 8; i++) await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await Promise.all([w.drain(), w.drain(), w.drain(), w.drain()]);
    await w.drain();
    expect(await ledger(s.id, rule.id)).toHaveLength(3);
    await setRuleActive(w.admin, rule.id, false);
  });

  it("never lets a department rule award students for another department's courses", async () => {
    const cs = await createRule(w.hod, { name: "CS lesson", trigger: "lesson", points: 7, departmentId: w.dept.id });
    const everyone = await createRule(w.admin, { name: "Any lesson", trigger: "lesson", points: 1 });
    const both = await w.enrolled("Rohan Das", [w.batch.id, w.batch2.id]);
    const mktOnly = await w.enrolled("Sneha Patil", [w.batch2.id]);
    await w.send("lesson.completed", { userId: both.id, courseId: w.course2.id, lessonId: fakeId() });
    await w.send("lesson.completed", { userId: mktOnly.id, courseId: w.course2.id, lessonId: fakeId() });
    await w.drain();
    expect(await ledger(both.id, cs.id)).toHaveLength(0);
    expect(await ledger(mktOnly.id, cs.id)).toHaveLength(0);
    expect(await ledger(mktOnly.id, everyone.id)).toHaveLength(1);

    await w.send("lesson.completed", { userId: both.id, courseId: w.course.id, lessonId: fakeId() });
    // A test with no course or batch belongs to no department: only university-wide rules apply.
    const loose = await createRule(w.hod, { name: "CS any test", trigger: "test-any", points: 3, departmentId: w.dept.id });
    await w.send("test.submitted", { attemptId: fakeId(), testId: fakeId(), userId: both.id, courseId: null, batchId: null, scorePercent: 90, passed: true });
    await w.drain();
    expect(await xpOf(both.id, cs.id)).toBe(7);
    expect(await ledger(both.id, loose.id)).toHaveLength(0);
    for (const r of [cs, everyone, loose]) await setRuleActive(w.admin, r.id, false);
  });

  it("checks each rule's condition", async () => {
    const passed = await createRule(w.admin, { name: "Pass", trigger: "test-passed", points: 50 });
    const ninety = await createRule(w.admin, { name: "Ninety", trigger: "test-score", minScore: 90, points: 25 });
    const present = await createRule(w.admin, { name: "On time", trigger: "class-present", points: 15 });
    const onTime = await createRule(w.admin, { name: "Submitted on time", trigger: "assignment-on-time", points: 20 });
    const graded = await createRule(w.admin, { name: "Graded 80", trigger: "assignment-score", minScore: 80, points: 30 });
    const done = await createRule(w.admin, { name: "Course done", trigger: "course-completed", points: 200 });
    const s = await w.enrolled("Arjun Singh", [w.batch.id]);
    const test = (scorePercent: number, ok: boolean) =>
      w.send("test.submitted", { attemptId: fakeId(), testId: fakeId(), userId: s.id, courseId: w.course.id, batchId: null, scorePercent, passed: ok });
    await test(35, false);
    await test(75, true);
    await test(90, true);
    for (const [startTime, status] of [["09:00", "present"], ["10:00", "late"], ["11:00", "absent"]] as const) {
      await w.send("attendance.marked", { batchId: w.batch.id, date: "2030-11-06", startTime, userId: s.id, status });
    }
    await w.send("assignment.submitted", { submissionId: fakeId(), assignmentId: fakeId(), userId: s.id, batchId: w.batch.id, late: true });
    await w.send("assignment.submitted", { submissionId: fakeId(), assignmentId: fakeId(), userId: s.id, batchId: w.batch.id, late: false });
    await w.send("assignment.graded", { submissionId: fakeId(), assignmentId: fakeId(), userId: s.id, batchId: w.batch.id, scorePercent: 79.5 });
    await w.send("assignment.graded", { submissionId: fakeId(), assignmentId: fakeId(), userId: s.id, batchId: w.batch.id, scorePercent: 80 });
    await w.send("enrolment.completed", { enrolmentId: s.enrolments[w.batch.id], userId: s.id, courseId: w.course.id, batchId: w.batch.id });
    await w.drain();

    expect(await ledger(s.id, passed.id)).toHaveLength(2);
    expect(await ledger(s.id, ninety.id)).toHaveLength(1);
    expect(await ledger(s.id, present.id)).toHaveLength(1);
    expect(await ledger(s.id, onTime.id)).toHaveLength(1);
    expect(await ledger(s.id, graded.id)).toHaveLength(1);
    expect(await ledger(s.id, done.id)).toHaveLength(1);
    // A test without a batch still lands on the student's batch board.
    expect((await ledger(s.id, ninety.id))[0].batchId).toBe(w.batch.id);
    for (const r of [passed, ninety, present, onTime, graded, done]) await setRuleActive(w.admin, r.id, false);
  });

  it("awards nothing from a rule that is turned off", async () => {
    const rule = await createRule(w.admin, { name: "Paused", trigger: "lesson", points: 10 });
    await setRuleActive(w.admin, rule.id, false);
    const s = await w.enrolled("Zoya Khan", [w.batch.id]);
    await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await w.drain();
    expect(await ledger(s.id, rule.id)).toHaveLength(0);
  });

  it("ignores people outside the university and malformed payloads", async () => {
    const rule = await createRule(w.admin, { name: "Strict", trigger: "lesson", points: 10 });
    const outsider = await makeUser("Out Sider");
    await w.send("lesson.completed", { userId: outsider.id, courseId: w.course.id, lessonId: fakeId() });
    const s = await w.enrolled("Tara Iyer", [w.batch.id]);
    await w.send("lesson.completed", { userId: s.id, courseId: "not-a-uuid", lessonId: fakeId() });
    const r = await w.drain();
    expect(r.failed).toBe(0);
    expect(await ledger(outsider.id)).toHaveLength(0);
    // An unknown course is no department and no batch, but a university-wide rule still counts it.
    expect((await ledger(s.id, rule.id)).map((x) => x.courseId)).toEqual([null]);
    await setRuleActive(w.admin, rule.id, false);
  });

  it("never applies another university's rules", async () => {
    const other = await world("Other Awarding University");
    const theirs = await createRule(other.admin, { name: "Theirs", trigger: "lesson", points: 99 });
    const s = await w.enrolled("Neil Joshi", [w.batch.id]);
    await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await w.drain();
    expect(await ledger(s.id, theirs.id)).toHaveLength(0);
    const uni = await makeUniversity("Unused");
    expect(uni.id).not.toBe(w.uni.id);
  });

  it("moves a student's XP to their new batch when they switch", async () => {
    const { requestSwitch, decideSwitch } = await import("@/server/services/enrolment");
    const rule = await createRule(w.admin, { name: "Switch lesson", trigger: "lesson", points: 10 });
    const s = await w.enrolled("Diya Kapoor", [w.batch.id]);
    await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await w.drain();
    expect((await ledger(s.id, rule.id))[0].batchId).toBe(w.batch.id);

    const req = await requestSwitch(s.actor, { enrolmentId: s.enrolments[w.batch.id], toBatchId: w.batchB.id, acknowledgeClash: true });
    if (req.status !== "requested") throw new Error("switch not requested");
    expect((await decideSwitch(w.hod, req.requestId, { approve: true })).status).toBe("approved");
    await w.drain();
    expect((await ledger(s.id, rule.id))[0].batchId).toBe(w.batchB.id);
    // New activity lands on the new batch too.
    await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await w.drain();
    expect((await ledger(s.id, rule.id)).map((r) => r.batchId)).toEqual([w.batchB.id, w.batchB.id]);
    await setRuleActive(w.admin, rule.id, false);
  });
});

describe("applying a rule to past activity", () => {
  it("replays past events through the same path: awards once, within caps, and runs again safely", async () => {
    const s = await w.enrolled("Vikram Late", [w.batch.id]);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push(await w.send("assignment.submitted", { submissionId: fakeId(), assignmentId: fakeId(), userId: s.id, batchId: w.batch.id, late: false }));
    await w.send("assignment.submitted", { submissionId: fakeId(), assignmentId: fakeId(), userId: s.id, batchId: w.batch.id, late: true });
    await w.drain(); // delivered before the rule existed: nothing to award yet

    const rule = await createRule(w.admin, { name: "On time, retro", trigger: "assignment-on-time", points: 20, dailyCap: 2 });
    expect(await ledger(s.id, rule.id)).toHaveLength(0);
    const first = await applyRuleToPast(w.admin, rule.id);
    expect(first.awards).toBeGreaterThanOrEqual(2);
    expect(first.failed).toBe(0);
    expect(await ledger(s.id, rule.id)).toHaveLength(2); // the cap holds for past days too
    const second = await applyRuleToPast(w.admin, rule.id);
    expect(second.awards).toBe(0);
    expect(await ledger(s.id, rule.id)).toHaveLength(2);
    const awarded = (await eventsOfType("xp.awarded", w.uni.id)).filter((e) => ids.includes((e.payload as { sourceEventId: string }).sourceEventId));
    expect(awarded).toHaveLength(2);
    await setRuleActive(w.admin, rule.id, false);
  });

  it("refuses a rule that is off, and a HOD can't apply a university-wide rule", async () => {
    const rule = await createRule(w.admin, { name: "Retro all", trigger: "lesson", points: 1 });
    await expect(applyRuleToPast(w.hod, rule.id)).rejects.toThrow(/whole university/);
    const own = await createRule(w.hod, { name: "Retro CS", trigger: "lesson", points: 1, departmentId: w.dept.id });
    await expect(applyRuleToPast(w.hod, own.id)).resolves.toMatchObject({ failed: 0 });
    await expect(applyRuleToPast(w.hodMkt, own.id)).rejects.toThrow(/access/);
    await setRuleActive(w.admin, rule.id, false);
    await expect(applyRuleToPast(w.admin, rule.id)).rejects.toThrow(/Turn the rule on/);
    await setRuleActive(w.admin, own.id, false);
  });
});
