import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { notifications } from "@/db/schema";
import { createBadge, listBadges, setBadgeActive, updateBadge } from "@/modules/gamification/badges";
import { createRule } from "@/modules/gamification/rules";
import { gamBadgeAwards } from "@/modules/gamification/schema";
import { addDays, weekStart } from "@/modules/gamification/util";
import { fakeId, world, type World } from "./world";

let w: World;
beforeAll(async () => {
  w = await world("Badges University");
  await createRule(w.admin, { name: "Lesson", trigger: "lesson", points: 10 });
  await createRule(w.admin, { name: "Pass", trigger: "test-passed", points: 50 });
});
afterAll(closeDb);

const awardsOf = (userId: string, badgeId?: string) =>
  systemDb()
    .select()
    .from(gamBadgeAwards)
    .where(and(eq(gamBadgeAwards.userId, userId), badgeId ? eq(gamBadgeAwards.badgeId, badgeId) : undefined));

const badgeNotes = (userId: string) =>
  systemDb()
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.kind, "gamification.badge")));

const pass = (w: World, userId: string) =>
  w.send("test.submitted", { attemptId: fakeId(), testId: fakeId(), userId, courseId: w.course.id, batchId: w.batch.id, scorePercent: 80, passed: true });

describe("badges", () => {
  it("are awarded once, with a notification", async () => {
    const { badge } = await createBadge(w.admin, { name: "First test passed", icon: "check", metric: "tests_passed", threshold: 1 });
    const s = await w.enrolled("Riya Sharma", [w.batch.id]);
    await pass(w, s.id);
    await w.drain();
    await pass(w, s.id);
    await w.drain();
    expect(await awardsOf(s.id, badge.id)).toHaveLength(1);
    const notes = (await badgeNotes(s.id)).filter((n) => (n.data as { badgeId: string }).badgeId === badge.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("You earned the First test passed badge");
  });

  it("go straight away to students who already qualify when created", async () => {
    const s = await w.enrolled("Kabir Mehta", [w.batch.id]);
    for (let i = 0; i < 3; i++) await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await w.drain();
    const { badge, awarded } = await createBadge(w.admin, { name: "Three lessons", icon: "book", metric: "lessons_completed", threshold: 3 });
    expect(awarded).toBeGreaterThanOrEqual(1);
    expect(await awardsOf(s.id, badge.id)).toHaveLength(1);
  });

  it("can count XP", async () => {
    const { badge } = await createBadge(w.admin, { name: "100 XP", icon: "star", metric: "xp", threshold: 100 });
    const s = await w.enrolled("Aditi Rao", [w.batch.id]);
    await pass(w, s.id); // 50
    await w.drain();
    expect(await awardsOf(s.id, badge.id)).toHaveLength(0);
    await pass(w, s.id); // 100
    await w.drain();
    expect(await awardsOf(s.id, badge.id)).toHaveLength(1);
  });

  it("count a four-week attendance streak, and an absence breaks it", async () => {
    const { badge } = await createBadge(w.admin, { name: "Regular", icon: "flame", metric: "attendance_streak_weeks", threshold: 4 });
    const steady = await w.enrolled("Ishaan Gupta", [w.batch.id]);
    const patchy = await w.enrolled("Meera Nair", [w.batch.id]);
    const monday = weekStart("2030-11-04");
    for (let week = 0; week < 4; week++) {
      for (const day of [0, 2]) {
        const date = addDays(monday, week * 7 + day);
        await w.send("attendance.marked", { batchId: w.batch.id, date, startTime: "09:00", userId: steady.id, status: day === 2 ? "late" : "present" });
        await w.send("attendance.marked", { batchId: w.batch.id, date, startTime: "09:00", userId: patchy.id, status: week === 2 && day === 2 ? "absent" : "present" });
      }
    }
    await w.drain();
    expect(await awardsOf(steady.id, badge.id)).toHaveLength(1);
    expect(await awardsOf(patchy.id, badge.id)).toHaveLength(0);
    // Corrected to present: the latest mark counts, so the streak is whole again.
    await w.send("attendance.marked", { batchId: w.batch.id, date: addDays(monday, 16), startTime: "09:00", userId: patchy.id, status: "present" });
    await w.drain();
    expect(await awardsOf(patchy.id, badge.id)).toHaveLength(1);
  });

  it("for a department count only that department's activity", async () => {
    const { badge } = await createBadge(w.hodMkt, { name: "Marketer", icon: "target", metric: "lessons_completed", threshold: 2, departmentId: w.mkt.id });
    const s = await w.enrolled("Rohan Das", [w.batch.id, w.batch2.id]);
    await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await w.send("lesson.completed", { userId: s.id, courseId: w.course2.id, lessonId: fakeId() });
    await w.drain();
    expect(await awardsOf(s.id, badge.id)).toHaveLength(0);
    await w.send("lesson.completed", { userId: s.id, courseId: w.course2.id, lessonId: fakeId() });
    await w.drain();
    expect(await awardsOf(s.id, badge.id)).toHaveLength(1);
  });

  it("lowering a target or turning a badge back on awards newly qualifying students; nothing is taken back", async () => {
    const { badge } = await createBadge(w.admin, { name: "Ten lessons", icon: "book", metric: "lessons_completed", threshold: 10 });
    const s = await w.enrolled("Sneha Patil", [w.batch.id]);
    for (let i = 0; i < 4; i++) await w.send("lesson.completed", { userId: s.id, courseId: w.course.id, lessonId: fakeId() });
    await w.drain();
    expect(await awardsOf(s.id, badge.id)).toHaveLength(0);
    await setBadgeActive(w.admin, badge.id, false);
    const lowered = await updateBadge(w.admin, badge.id, { name: "Four lessons", icon: "book", threshold: 4 });
    expect(lowered.awarded).toBe(0); // off: nobody gets it yet
    const on = await setBadgeActive(w.admin, badge.id, true);
    expect(on.awarded).toBeGreaterThanOrEqual(1);
    expect(await awardsOf(s.id, badge.id)).toHaveLength(1);
    await updateBadge(w.admin, badge.id, { name: "Four lessons", icon: "book", threshold: 40 });
    expect(await awardsOf(s.id, badge.id)).toHaveLength(1);
  });
});

describe("badges: permissions", () => {
  it("a HOD can't create a university-wide badge but can for their department", async () => {
    await expect(createBadge(w.hod, { name: "All", icon: "star", metric: "xp", threshold: 10 })).rejects.toThrow(/Only an institute admin/);
    await expect(createBadge(w.hod, { name: "CS star", icon: "star", metric: "xp", threshold: 10, departmentId: w.dept.id })).resolves.toMatchObject({
      badge: { departmentId: w.dept.id },
    });
    await expect(createBadge(w.hod, { name: "MKT star", icon: "star", metric: "xp", threshold: 10, departmentId: w.mkt.id })).rejects.toThrow(/access/);
  });

  it("faculty and students can't create or change badges", async () => {
    await expect(createBadge(w.faculty, { name: "Mine", icon: "star", metric: "xp", threshold: 10, departmentId: w.dept.id })).rejects.toThrow(/access/);
    const { badges } = await listBadges(w.admin);
    await expect(setBadgeActive(w.faculty, badges[0].id, false)).rejects.toThrow();
    await expect(listBadges(await w.student("Badge Student"))).rejects.toThrow(/access/);
  });

  it("faculty can view badges, read only", async () => {
    const { badges } = await listBadges(w.faculty);
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.every((b) => !b.canManage && (b.departmentId === null || b.departmentId === w.dept.id))).toBe(true);
  });

  it("explains what is wrong with a badge", async () => {
    await expect(createBadge(w.admin, { name: "Bad icon", icon: "skull", metric: "xp", threshold: 10 })).rejects.toThrow(/icons/);
    await expect(createBadge(w.admin, { name: "Bad metric", icon: "star", metric: "logins", threshold: 10 })).rejects.toThrow(/counts/);
    await expect(createBadge(w.admin, { name: "Zero", icon: "star", metric: "xp", threshold: 0 })).rejects.toThrow(/whole number/);
  });
});
