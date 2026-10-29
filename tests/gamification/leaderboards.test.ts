import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { todayFor, withTenant } from "@/server/core";
import { staffLeaderboard, topLearners } from "@/modules/gamification/leaderboards";
import { learnerBoard, myXpPage, myXpSummary } from "@/modules/gamification/learner";
import { createRule } from "@/modules/gamification/rules";
import { getNameDisplay, setNameDisplay } from "@/modules/gamification/settings";
import { addDays } from "@/modules/gamification/util";
import { fakeId, world, type World } from "./world";

let w: World;
let today: string;
let riya: Awaited<ReturnType<World["enrolled"]>>;
let kabir: Awaited<ReturnType<World["enrolled"]>>;
let aditi: Awaited<ReturnType<World["enrolled"]>>;
let ishaan: Awaited<ReturnType<World["enrolled"]>>;
let meera: Awaited<ReturnType<World["enrolled"]>>;
let rohan: Awaited<ReturnType<World["enrolled"]>>;

beforeAll(async () => {
  w = await world("Leaderboard University");
  today = await withTenant(w.sys, (tx) => todayFor(tx));
  await createRule(w.admin, { name: "Lesson", trigger: "lesson", points: 10 });
  await createRule(w.admin, { name: "Class", trigger: "class-attended", points: 15 });
  riya = await w.enrolled("Riya Sharma", [w.batch.id]);
  kabir = await w.enrolled("Kabir Mehta", [w.batch.id]);
  aditi = await w.enrolled("Aditi Rao", [w.batch.id]);
  ishaan = await w.enrolled("Ishaan Gupta", [w.batch.id]);
  meera = await w.enrolled("Meera Nair", [w.batch.id]); // earns nothing
  rohan = await w.enrolled("Rohan Das", [w.batchB.id, w.batch2.id]);
  const lessons = async (userId: string, n: number, courseId = w.course.id) => {
    for (let i = 0; i < n; i++) await w.send("lesson.completed", { userId, courseId, lessonId: fakeId() });
  };
  await lessons(riya.id, 5); // 50
  await lessons(kabir.id, 3); // 30
  await lessons(aditi.id, 3); // 30
  await lessons(ishaan.id, 1); // 10
  // A class long ago: all time only.
  await w.send("attendance.marked", { batchId: w.batch.id, date: "2020-01-06", startTime: "09:00", userId: ishaan.id, status: "present" });
  await lessons(rohan.id, 2); // 20, in the other CS batch
  await lessons(rohan.id, 4, w.course2.id); // 40, in Marketing
  await w.drain();
});
afterAll(closeDb);

describe("leaderboards", () => {
  it("rank by XP, highest first; ties share a rank and the next rank skips", async () => {
    const board = await staffLeaderboard(w.admin, { scope: `batch:${w.batch.id}`, period: "week" });
    expect(board.rows.map((r) => [r.name, r.points, r.rank])).toEqual([
      ["Riya Sharma", 50, 1],
      ["Aditi Rao", 30, 2],
      ["Kabir Mehta", 30, 2],
      ["Ishaan Gupta", 10, 4],
      ["Meera Nair", 0, 5],
    ]);
    expect(board.totals).toEqual({ points: 120, earners: 4 });
  });

  it("count only the chosen period", async () => {
    const all = await staffLeaderboard(w.admin, { scope: `batch:${w.batch.id}`, period: "all" });
    expect(all.rows.map((r) => [r.name, r.points, r.rank])).toEqual([
      ["Riya Sharma", 50, 1],
      ["Aditi Rao", 30, 2],
      ["Kabir Mehta", 30, 2],
      ["Ishaan Gupta", 25, 4],
      ["Meera Nair", 0, 5],
    ]);
    const month = await staffLeaderboard(w.admin, { scope: `batch:${w.batch.id}`, period: "month" });
    expect(month.rows.find((r) => r.userId === ishaan.id)?.points).toBe(10);
  });

  it("by course add up every batch of the course, and nothing from other courses", async () => {
    const board = await staffLeaderboard(w.admin, { scope: `course:${w.course.id}`, period: "all" });
    expect(board.rows.find((r) => r.userId === rohan.id)?.points).toBe(20);
    expect(board.rows).toHaveLength(6);
    const mkt = await staffLeaderboard(w.admin, { scope: `course:${w.course2.id}`, period: "all" });
    expect(mkt.rows.map((r) => [r.userId, r.points])).toEqual([[rohan.id, 40]]);
  });

  it("show students' names the way the university chose; staff always see full names", async () => {
    expect(await getNameDisplay(w.admin)).toBe("first_initial");
    const before = await learnerBoard(riya.actor, { batchId: w.batch.id });
    expect(before.rows.map((r) => r.name)).toEqual(["Riya S.", "Aditi R.", "Kabir M.", "Ishaan G.", "Meera N."]);
    expect(before.me).toMatchObject({ userId: riya.id, rank: 1, points: 50 });

    await setNameDisplay(w.admin, "full");
    const after = await learnerBoard(riya.actor, { batchId: w.batch.id });
    expect(after.rows.map((r) => r.name)).toEqual(["Riya Sharma", "Aditi Rao", "Kabir Mehta", "Ishaan Gupta", "Meera Nair"]);

    await setNameDisplay(w.admin, "first_initial");
    const staff = await staffLeaderboard(w.hod, { scope: `batch:${w.batch.id}` });
    expect(staff.rows[0].name).toBe("Riya Sharma");
  });

  it("only an institute admin chooses how names show", async () => {
    await expect(setNameDisplay(w.hod, "full")).rejects.toThrow(/access/);
    await expect(setNameDisplay(w.faculty, "full")).rejects.toThrow(/access/);
    await expect(setNameDisplay(w.admin, "nickname")).rejects.toThrow(/Choose full name/);
    await expect(setNameDisplay(w.admin, "first_initial")).resolves.toBe("first_initial");
  });
});

describe("leaderboards: who sees which", () => {
  it("a learner sees the boards of their own batches and courses only", async () => {
    const course = await learnerBoard(rohan.actor, { batchId: w.batchB.id, board: "course" });
    expect(course.board).toBe("course");
    expect(course.rows.length).toBe(6);
    await expect(learnerBoard(riya.actor, { batchId: w.batch2.id })).rejects.toThrow(/batches you're in/);
    await expect(learnerBoard(w.faculty, { batchId: w.batch.id })).rejects.toThrow(/access/);
  });

  it("faculty see their batches' boards only; asking for another department's falls back", async () => {
    const board = await staffLeaderboard(w.faculty, { scope: `course:${w.course2.id}` });
    const offered = board.groups.flatMap((g) => g.options.map((o) => o.scope.id));
    expect(offered).not.toContain(w.course2.id);
    expect(offered).not.toContain(w.batch2.id);
    expect(offered).toContain(w.batch.id);
    expect(board.selected?.scope.id).not.toBe(w.course2.id);
  });

  it("a HOD sees their own department's boards only", async () => {
    const board = await staffLeaderboard(w.hodMkt, { scope: `batch:${w.batch.id}` });
    const offered = board.groups.flatMap((g) => g.options.map((o) => o.scope.id));
    expect(offered.sort()).toEqual([w.batch2.id, w.course2.id].sort());
    expect(board.selected?.scope.id).not.toBe(w.batch.id);
  });

  it("students can't open the staff leaderboard", async () => {
    await expect(staffLeaderboard(riya.actor)).rejects.toThrow(/access/);
  });

  it("top learners on the dashboard are narrowed to what the viewer reaches", async () => {
    const all = await topLearners(w.admin, { period: "all" });
    expect(all.rows[0]).toMatchObject({ userId: rohan.id, points: 60, rank: 1 });
    const mkt = await topLearners(w.hodMkt, { period: "all" });
    expect(mkt.rows.map((r) => [r.userId, r.points])).toEqual([[rohan.id, 40]]);
    const fac = await topLearners(w.faculty, { period: "all" });
    // Farah teaches both CS batches: she sees Rohan's CS XP, never his Marketing XP.
    expect(fac.rows.find((r) => r.userId === rohan.id)?.points).toBe(20);
    expect(fac.rows[0]).toMatchObject({ userId: riya.id, points: 50 });
    await expect(topLearners(riya.actor)).rejects.toThrow(/access/);
  });
});

describe("the learner's own XP", () => {
  it("adds up total, this week and this month, and ranks every batch", async () => {
    const page = await myXpPage(ishaan.actor);
    expect(page).toMatchObject({ total: 25, week: 10, month: 10, period: "all" });
    expect(page.boards).toEqual([expect.objectContaining({ rank: 4, of: 5, points: 25 })]);
    expect(page.recent.map((r) => r.points).sort()).toEqual([10, 15]);
    const summary = await myXpSummary(rohan.actor);
    expect(summary.total).toBe(60);
    expect(summary.ranks.map((r) => r.points).sort()).toEqual([20, 40]);
    expect(summary.best).toMatchObject({ rank: 1 });
  });

  it("is only for students", async () => {
    await expect(myXpPage(w.admin)).rejects.toThrow(/access/);
    await expect(myXpSummary(w.faculty)).rejects.toThrow(/access/);
    expect(addDays(today, 0)).toBe(today);
  });
});
