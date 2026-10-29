import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { notifications } from "@/db/schema";
import { todayFor, withTenant } from "@/server/core";
import { cancelChallenge, closeEndedChallenges, createChallenge, getChallenge, listChallenges } from "@/modules/gamification/challenges";
import { myXpPage } from "@/modules/gamification/learner";
import { createRule } from "@/modules/gamification/rules";
import { gamChallenges, gamChallengeWinners } from "@/modules/gamification/schema";
import { addDays } from "@/modules/gamification/util";
import gamification from "@/modules/gamification";
import { fakeId, world, type World } from "./world";

let w: World;
let today: string;
beforeAll(async () => {
  w = await world("Challenges University");
  today = await withTenant(w.sys, (tx) => todayFor(tx));
  await createRule(w.admin, { name: "Lesson", trigger: "lesson", points: 10 });
});
afterAll(closeDb);

const input = (scope: string, extra: Partial<Parameters<typeof createChallenge>[1]> = {}) => ({
  title: "Lesson sprint",
  scope,
  metric: "lessons_completed",
  target: 2,
  startDate: addDays(today, -1),
  endDate: addDays(today, 5),
  ...extra,
});

/** Move a challenge into the past (tests can't wait for the calendar). */
const backdate = (id: string, startDate: string, endDate: string) =>
  systemDb().update(gamChallenges).set({ startDate, endDate }).where(eq(gamChallenges.id, id));

describe("challenges: who may set them", () => {
  it("an admin can set one for any batch or course", async () => {
    await expect(createChallenge(w.admin, input(`course:${w.course2.id}`))).resolves.toMatchObject({ scope: "course", courseId: w.course2.id, batchId: null });
  });

  it("a HOD can set one for their department's batches and courses only", async () => {
    await expect(createChallenge(w.hod, input(`batch:${w.batch.id}`))).resolves.toMatchObject({
      scope: "batch",
      batchId: w.batch.id,
      courseId: w.course.id,
      departmentId: w.dept.id,
    });
    await expect(createChallenge(w.hod, input(`batch:${w.batch2.id}`))).rejects.toThrow(/access/);
  });

  it("faculty and students can't set challenges", async () => {
    await expect(createChallenge(w.faculty, input(`batch:${w.batch.id}`))).rejects.toThrow(/access/);
    await expect(createChallenge(await w.student("Challenge Student"), input(`batch:${w.batch.id}`))).rejects.toThrow(/access/);
  });

  it("explains what is wrong with a challenge", async () => {
    const at = `batch:${w.batch.id}`;
    await expect(createChallenge(w.admin, input(at, { endDate: addDays(today, -3), startDate: addDays(today, -1) }))).rejects.toThrow(/on or after the start/);
    await expect(createChallenge(w.admin, input(at, { startDate: addDays(today, -9), endDate: addDays(today, -2) }))).rejects.toThrow(/already passed/);
    await expect(createChallenge(w.admin, input(at, { metric: "attendance_streak_weeks" }))).rejects.toThrow(/counts/);
    await expect(createChallenge(w.admin, input(at, { target: 0 }))).rejects.toThrow(/whole number/);
    await expect(createChallenge(w.admin, input(at, { title: "Hi" }))).rejects.toThrow(/title/);
    await expect(createChallenge(w.admin, input("batch:nope"))).rejects.toThrow(/batch or course/);
    await expect(createChallenge(w.admin, input(at, { startDate: "2026-02-30" }))).rejects.toThrow(/start date/);
  });
});

describe("challenges: progress and winners", () => {
  it("show live progress for every student, finishers first in the order they finished", async () => {
    const c = await createChallenge(w.hod, input(`batch:${w.batch.id}`, { title: "Two lessons" }));
    const a = await w.enrolled("Riya Sharma", [w.batch.id]);
    const b = await w.enrolled("Kabir Mehta", [w.batch.id]);
    const idle = await w.enrolled("Aditi Rao", [w.batch.id]);
    const lesson = (userId: string) => w.send("lesson.completed", { userId, courseId: w.course.id, lessonId: fakeId() });
    await lesson(b.id);
    await lesson(a.id);
    await lesson(a.id); // Riya reaches 2 first
    await lesson(b.id); // then Kabir
    await w.drain();
    const view = await getChallenge(w.faculty, c.id);
    expect(view.status).toBe("active");
    expect(view.rows.map((r) => [r.userId, r.value, r.position])).toEqual([
      [a.id, 2, 1],
      [b.id, 2, 2],
      [idle.id, 0, null],
    ]);
    expect(view.winners).toEqual([]); // not over yet

    const mine = await myXpPage(b.actor);
    expect(mine.challenges.find((x) => x.id === c.id)).toMatchObject({ value: 2, finished: true, position: 2, status: "active" });
    const list = await listChallenges(w.faculty);
    expect(list.active.find((x) => x.id === c.id)).toMatchObject({ members: 3, finished: 2 });
  });

  it("freeze winners when they end, tell them once, and ignore later activity", async () => {
    await createRule(w.admin, { name: "Class", trigger: "class-attended", points: 15 });
    const c = await createChallenge(w.admin, input(`course:${w.course.id}`, { title: "January classes", metric: "classes_attended", target: 2 }));
    await backdate(c.id, "2020-01-01", "2020-01-31");
    const fast = await w.enrolled("Ishaan Gupta", [w.batch.id]);
    const slow = await w.enrolled("Meera Nair", [w.batchB.id]);
    const late = await w.enrolled("Rohan Das", [w.batch.id]);
    const mark = (userId: string, batchId: string, date: string) => w.send("attendance.marked", { batchId, date, startTime: "09:00", userId, status: "present" });
    await mark(fast.id, w.batch.id, "2020-01-06");
    await mark(fast.id, w.batch.id, "2020-01-07");
    await mark(slow.id, w.batchB.id, "2020-01-06");
    await mark(slow.id, w.batchB.id, "2020-01-08");
    await mark(late.id, w.batch.id, "2020-01-06");
    await mark(late.id, w.batch.id, "2020-02-03"); // after the end: doesn't count
    await w.drain();

    const ended = await getChallenge(w.admin, c.id);
    expect(ended.status).toBe("ended");
    expect(ended.winners.map((r) => r.userId)).toEqual([fast.id, slow.id]);

    const first = await closeEndedChallenges(w.sys);
    expect(first.closed).toBeGreaterThanOrEqual(1);
    const second = await closeEndedChallenges(w.sys);
    expect(second.closed).toBe(0);
    const frozen = await systemDb().select().from(gamChallengeWinners).where(eq(gamChallengeWinners.challengeId, c.id));
    expect(frozen.sort((p, q) => p.position - q.position).map((x) => [x.userId, x.position])).toEqual([
      [fast.id, 1],
      [slow.id, 2],
    ]);
    const notes = await systemDb()
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, fast.id), eq(notifications.kind, "gamification.challenge_won")));
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("You finished the January classes challenge");
    expect(notes[0].body).toBe("You were 1st of 2 to attend 2 live classes.");

    // A mark that arrives after the challenge closed doesn't change the winners.
    await mark(late.id, w.batch.id, "2020-01-09");
    await w.drain();
    expect((await getChallenge(w.admin, c.id)).winners.map((r) => r.userId)).toEqual([fast.id, slow.id]);
  });

  it("can be cancelled before they end, by the people who manage them", async () => {
    const c = await createChallenge(w.hod, input(`batch:${w.batch.id}`, { title: "Short lived" }));
    await expect(cancelChallenge(w.faculty, c.id)).rejects.toThrow(/access/);
    await expect(cancelChallenge(w.hodMkt, c.id)).rejects.toThrow(/access/);
    await expect(cancelChallenge(w.hod, c.id)).resolves.toMatchObject({ cancelledAt: expect.any(Date) });
    expect((await getChallenge(w.hod, c.id)).status).toBe("cancelled");
    await backdate(c.id, "2020-03-01", "2020-03-02");
    await closeEndedChallenges(w.sys);
    const [row] = await systemDb().select().from(gamChallenges).where(eq(gamChallenges.id, c.id));
    expect(row.closedAt).toBeNull();
  });

  it("are visible to staff only within their reach", async () => {
    const mkt = await createChallenge(w.hodMkt, input(`batch:${w.batch2.id}`, { title: "Marketing only" }));
    expect((await listChallenges(w.hod)).active.map((c) => c.id)).not.toContain(mkt.id);
    expect((await listChallenges(w.admin)).active.map((c) => c.id)).toContain(mkt.id);
    await expect(getChallenge(w.faculty, mkt.id)).rejects.toThrow(/access/);
    await expect(listChallenges(await w.student("Nosy Student"))).rejects.toThrow(/access/);
  });

  it("are closed by the hourly job", () => {
    expect(gamification.jobs?.map((j) => [j.id, j.every])).toEqual([["gamification.close-challenges", "hour"]]);
  });
});
