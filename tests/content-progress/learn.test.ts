import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { enrolments } from "@/db/schema";
import { verifyLocal } from "@/contracts/storage";
import { holdSeat } from "@/server/services/enrolment";
import { addDays } from "@/modules/content-progress/lib/dates";
import { learnerFileResponse, videoProgressResponse } from "@/modules/content-progress/http";
import {
  continueLearning,
  learnerOutline,
  lessonFileUrl,
  lessonForLearner,
  markLessonComplete,
  recordLessonOpened,
  reportVideoProgress,
} from "@/modules/content-progress/learn";
import { contentCourseProgress } from "@/modules/content-progress/schema";
import { setTextContent, storeContent, updateLesson } from "@/modules/content-progress/service";
import { finishUpload, startUpload, uploadPart } from "@/modules/content-progress/uploads";
import { makePdf } from "@/modules/content-progress/lib/pdf";
import { setupLearning, tempStorage, today } from "./helpers";

let restore: () => void;
beforeAll(() => {
  restore = tempStorage();
});
afterAll(async () => {
  restore();
  await closeDb();
});

async function uploadPdf(ctx: Awaited<ReturnType<typeof setupLearning>>, lessonId: string) {
  const body = makePdf("Notes", [{ heading: "Hello", text: "World" }]);
  const u = await startUpload(ctx.hod, { lessonId, fileName: "notes.pdf", size: body.length });
  await uploadPart(ctx.hod, u.uploadId, 0, body);
  await finishUpload(ctx.hod, u.uploadId);
}

const fileRequest = (lessonId: string) => new Request(`http://localhost/demo/learn/lessons/${lessonId}/file`);

/** The signed URL in a redirect is valid for the stored file. */
function signedKey(location: string) {
  const u = new URL(location, "http://localhost");
  const key = decodeURIComponent(u.pathname.replace(/^\/api\/storage\//, ""));
  expect(verifyLocal(key, Number(u.searchParams.get("exp")), u.searchParams.get("name") ?? "", u.searchParams.get("sig") ?? "")).toBe(true);
  return key;
}

describe("who can open lessons", () => {
  it("an actively enrolled student opens lessons and their files", async () => {
    const ctx = await setupLearning({ name: "Open U", lessons: [{ title: "Notes", kind: "pdf" }, { title: "Read", kind: "text" }] });
    await uploadPdf(ctx, ctx.lessons[0].id);
    const s = await ctx.enrolled("Student Sita");
    const view = await lessonForLearner(s.actor, ctx.lessons[0].id);
    expect(view).toMatchObject({ locked: false, content: { kind: "pdf" }, next: { id: ctx.lessons[1].id }, prev: null });
    const res = await learnerFileResponse(s.actor, ctx.lessons[0].id, fileRequest(ctx.lessons[0].id));
    expect(res.status).toBe(302);
    expect(signedKey(res.headers.get("location")!)).toMatch(new RegExp(`^${ctx.uni.id}/content-progress/lessons/${ctx.lessons[0].id}/`));
  });

  it("a student who isn't enrolled in the course can't open its lessons, mark them or get their files", async () => {
    const ctx = await setupLearning({ name: "Not Enrolled U", lessons: [{ title: "Notes", kind: "pdf" }] });
    await uploadPdf(ctx, ctx.lessons[0].id);
    const outsider = await ctx.student("Outsider Om");
    await expect(lessonForLearner(outsider, ctx.lessons[0].id)).rejects.toThrow(/aren't enrolled/);
    await expect(markLessonComplete(outsider, ctx.lessons[0].id)).rejects.toThrow(/aren't enrolled/);
    await expect(lessonFileUrl(outsider, ctx.lessons[0].id)).rejects.toThrow(/aren't enrolled/);
    const res = await learnerFileResponse(outsider, ctx.lessons[0].id, fileRequest(ctx.lessons[0].id));
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
  });

  it("a held (unpaid), cancelled or ended enrolment doesn't open lessons; a completed one may review them", async () => {
    const ctx = await setupLearning({ name: "Statuses U", lessons: [{ title: "Read", kind: "text" }, { title: "More", kind: "text" }] });
    const s = await ctx.enrolled("Student Sia");
    for (const status of ["held", "cancelled", "ended"] as const) {
      await systemDb().update(enrolments).set({ status }).where(eq(enrolments.id, s.enrolmentId));
      await expect(lessonForLearner(s.actor, ctx.lessons[0].id)).rejects.toThrow(/aren't enrolled/);
      await expect(markLessonComplete(s.actor, ctx.lessons[0].id)).rejects.toThrow(/aren't enrolled/);
    }
    await systemDb().update(enrolments).set({ status: "completed" }).where(eq(enrolments.id, s.enrolmentId));
    await expect(lessonForLearner(s.actor, ctx.lessons[0].id)).resolves.toMatchObject({ locked: false });
  });

  it("a locked drip lesson shows when it opens, but not its content, and can't be completed or downloaded", async () => {
    const ctx = await setupLearning({
      name: "Drip U",
      startedDaysAgo: 3,
      lessons: [
        { title: "Open now", kind: "text" },
        { title: "Week 2", kind: "pdf", drip: { mode: "after_start", days: 7 } },
        { title: "Fixed", kind: "text" },
      ],
    });
    await uploadPdf(ctx, ctx.lessons[1].id);
    await updateLesson(ctx.hod, ctx.lessons[2].id, { drip: { mode: "on_date", date: addDays(today(), 30) } });
    const s = await ctx.enrolled("Student Sam");
    const locked = await lessonForLearner(s.actor, ctx.lessons[1].id);
    expect(locked).toMatchObject({ locked: true, unlockOn: addDays(ctx.start, 7), content: null });
    await expect(markLessonComplete(s.actor, ctx.lessons[1].id)).rejects.toThrow(`This lesson opens on ${addDays(ctx.start, 7)}.`);
    await expect(lessonFileUrl(s.actor, ctx.lessons[1].id)).rejects.toThrow(/opens on/);
    expect((await learnerFileResponse(s.actor, ctx.lessons[1].id, fileRequest(ctx.lessons[1].id))).status).toBe(409);
    const fixed = await lessonForLearner(s.actor, ctx.lessons[2].id);
    expect(fixed).toMatchObject({ locked: true, unlockOn: addDays(today(), 30) });
    const { outline } = await learnerOutline(s.actor, s.enrolmentId);
    expect(outline.lessons.map((l) => l.state)).toEqual(["open", "locked", "locked"]);
    // The day it opens, it opens.
    await updateLesson(ctx.hod, ctx.lessons[1].id, { drip: { mode: "after_start", days: 3 } });
    await expect(lessonForLearner(s.actor, ctx.lessons[1].id)).resolves.toMatchObject({ locked: false });
    expect((await learnerFileResponse(s.actor, ctx.lessons[1].id, fileRequest(ctx.lessons[1].id))).status).toBe(302);
  });

  it("lessons without content are hidden from students", async () => {
    const ctx = await setupLearning({ name: "Hidden U", lessons: [{ title: "Done", kind: "text" }, { title: "Draft", kind: "text", empty: true }] });
    const s = await ctx.enrolled("Student Sara");
    await expect(lessonForLearner(s.actor, ctx.lessons[1].id)).rejects.toThrow(/Lesson not found/);
    expect((await learnerOutline(s.actor, s.enrolmentId)).outline.lessons.map((l) => l.title)).toEqual(["Done"]);
  });

  it("staff without a learner role, and other universities, can't use the learner routes", async () => {
    const ctx = await setupLearning({ name: "Learner Only U" });
    const other = await setupLearning({ name: "Other Tenant U" });
    const stranger = await other.enrolled("Other Student");
    await expect(lessonForLearner(ctx.hod, ctx.lessons[0].id)).rejects.toThrow(/access/);
    await expect(lessonForLearner(stranger.actor, ctx.lessons[0].id)).rejects.toThrow(/not found/);
    await expect(learnerOutline(stranger.actor, (await ctx.enrolled("Mine")).enrolmentId)).rejects.toThrow(/not found/);
  });

  it("text is sanitised again when shown, whatever was stored", async () => {
    const ctx = await setupLearning({ name: "Resanitise U", lessons: [{ title: "Read", kind: "text" }] });
    await storeContent(ctx.hod, ctx.lessons[0].id, { content: { html: '<p>Hi</p><script>alert(1)</script><a href="javascript:x">x</a>' }, action: "test.raw" });
    const s = await ctx.enrolled("Student Sana");
    const view = await lessonForLearner(s.actor, ctx.lessons[0].id);
    expect(view.content).toEqual({ kind: "text", html: "<p>Hi</p><a>x</a>" });
  });
});

describe("progress", () => {
  it("course % counts required lessons only; optional lessons don't count", async () => {
    const ctx = await setupLearning({
      name: "Optional U",
      lessons: [
        { title: "Required one", kind: "text" },
        { title: "Optional", kind: "text", optional: true },
        { title: "Required two", kind: "text" },
      ],
    });
    const s = await ctx.enrolled("Student Opt");
    const opt = await markLessonComplete(s.actor, ctx.lessons[1].id);
    expect(opt).toMatchObject({ lessonCompleted: true, coursePercent: 0, courseCompleted: false });
    expect(await markLessonComplete(s.actor, ctx.lessons[0].id)).toMatchObject({ coursePercent: 50 });
    const last = await markLessonComplete(s.actor, ctx.lessons[2].id);
    expect(last).toMatchObject({ coursePercent: 100, courseCompleted: true });
    // Making the optional lesson required doesn't undo a completion, but the percentage follows the rule.
    const [row] = await systemDb().select().from(contentCourseProgress).where(eq(contentCourseProgress.enrolmentId, s.enrolmentId));
    expect(row).toMatchObject({ percent: 100, completedRequired: 2, totalRequired: 2 });
  });

  it("emits lesson.completed once per lesson and course.progress when the percentage changes", async () => {
    const { eventsOfType } = await import("../helpers/events");
    const ctx = await setupLearning({ name: "Events U", lessons: [{ title: "Lesson A", kind: "text" }, { title: "Lesson B", kind: "text" }, { title: "Lesson C", kind: "text" }] });
    const s = await ctx.enrolled("Student Ev");
    await markLessonComplete(s.actor, ctx.lessons[0].id);
    expect(await markLessonComplete(s.actor, ctx.lessons[0].id)).toMatchObject({ lessonCompleted: false });
    const lessons = (await eventsOfType("lesson.completed", ctx.uni.id)).filter((e) => (e.payload as { userId: string }).userId === s.userId);
    expect(lessons.map((e) => e.payload)).toEqual([{ userId: s.userId, courseId: ctx.course.id, lessonId: ctx.lessons[0].id }]);
    const progress = (await eventsOfType("course.progress", ctx.uni.id)).filter((e) => (e.payload as { userId: string }).userId === s.userId);
    expect(progress.map((e) => e.payload)).toEqual([{ userId: s.userId, courseId: ctx.course.id, enrolmentId: s.enrolmentId, percent: 33 }]);
  });

  it("at 100% the enrolment completes through core, and enrolment.completed is emitted once", async () => {
    const { drainEvents, eventsOfType } = await import("../helpers/events");
    const ctx = await setupLearning({ name: "Complete U", lessons: [{ title: "Lesson A", kind: "text" }, { title: "Lesson B", kind: "link" }] });
    const s = await ctx.enrolled("Student Done");
    await markLessonComplete(s.actor, ctx.lessons[0].id);
    const r = await markLessonComplete(s.actor, ctx.lessons[1].id);
    expect(r).toMatchObject({ coursePercent: 100, courseCompleted: true });
    await drainEvents();
    await markLessonComplete(s.actor, ctx.lessons[1].id);
    await drainEvents();
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.id, s.enrolmentId));
    expect(e.status).toBe("completed");
    const done = (await eventsOfType("enrolment.completed", ctx.uni.id)).filter((x) => (x.payload as { enrolmentId: string }).enrolmentId === s.enrolmentId);
    expect(done).toHaveLength(1);
    const [row] = await systemDb().select().from(contentCourseProgress).where(eq(contentCourseProgress.enrolmentId, s.enrolmentId));
    expect(row.completedAt).not.toBeNull();
  });

  it("completion fires exactly once even when the last two lessons complete at the same moment", async () => {
    const { drainEvents, eventsOfType } = await import("../helpers/events");
    const ctx = await setupLearning({
      name: "Race U",
      lessons: [{ title: "Lesson A", kind: "text" }, { title: "Lesson B", kind: "text" }, { title: "Lesson C", kind: "text" }],
    });
    const students = await Promise.all(["Racer One", "Racer Two", "Racer Three", "Racer Four"].map((n) => ctx.enrolled(n)));
    for (const s of students) await markLessonComplete(s.actor, ctx.lessons[0].id);
    // The last two lessons, at once, for every student, while events are being delivered.
    const results = await Promise.all([
      ...students.flatMap((s) => [markLessonComplete(s.actor, ctx.lessons[1].id), markLessonComplete(s.actor, ctx.lessons[2].id)]),
      drainEvents(),
    ]);
    await drainEvents();
    const outcomes = results.slice(0, students.length * 2) as Awaited<ReturnType<typeof markLessonComplete>>[];
    // For each student, exactly one of the two calls saw 100%.
    for (let i = 0; i < students.length; i++) {
      const pair = [outcomes[i * 2], outcomes[i * 2 + 1]];
      expect(pair.map((p) => p.coursePercent).sort((a, b) => a - b)).toEqual([66, 100]);
    }
    const done = await eventsOfType("enrolment.completed", ctx.uni.id);
    expect(done).toHaveLength(students.length);
    expect(new Set(done.map((d) => (d.payload as { enrolmentId: string }).enrolmentId))).toEqual(new Set(students.map((s) => s.enrolmentId)));
    const statuses = await systemDb().select({ status: enrolments.status }).from(enrolments).where(and(eq(enrolments.batchId, ctx.batch.id)));
    expect(statuses.every((x) => x.status === "completed")).toBe(true);
  });

  it("curriculum changes recount progress: removing the last required lesson completes students who did the rest", async () => {
    const { deleteLesson } = await import("@/modules/content-progress/service");
    const { eventsOfType } = await import("../helpers/events");
    const ctx = await setupLearning({ name: "Recount U", lessons: [{ title: "Lesson A", kind: "text" }, { title: "Lesson B", kind: "text" }] });
    const s = await ctx.enrolled("Student Rec");
    expect(await markLessonComplete(s.actor, ctx.lessons[0].id)).toMatchObject({ coursePercent: 50 });
    await updateLesson(ctx.hod, ctx.lessons[1].id, { required: false });
    let [row] = await systemDb().select().from(contentCourseProgress).where(eq(contentCourseProgress.enrolmentId, s.enrolmentId));
    expect(row.percent).toBe(100);
    const [e] = await systemDb().select().from(enrolments).where(eq(enrolments.id, s.enrolmentId));
    expect(e.status).toBe("completed");
    await deleteLesson(ctx.hod, ctx.lessons[1].id);
    [row] = await systemDb().select().from(contentCourseProgress).where(eq(contentCourseProgress.enrolmentId, s.enrolmentId));
    expect(row.percent).toBe(100);
    expect((await eventsOfType("enrolment.completed", ctx.uni.id))).toHaveLength(1);
  });

  it("adding a required lesson lowers active students' percentage", async () => {
    const { addLesson } = await import("@/modules/content-progress/service");
    const ctx = await setupLearning({ name: "Add Lesson U", lessons: [{ title: "Lesson A", kind: "text" }, { title: "Lesson B", kind: "text" }, { title: "Lesson C", kind: "text" }, { title: "Lesson D", kind: "text" }] });
    const s = await ctx.enrolled("Student Add");
    await markLessonComplete(s.actor, ctx.lessons[0].id);
    await markLessonComplete(s.actor, ctx.lessons[1].id);
    const l = await addLesson(ctx.hod, ctx.course.id, ctx.section.id, { title: "Lesson E", kind: "text" });
    await setTextContent(ctx.hod, l.id, "<p>New</p>");
    const [row] = await systemDb().select().from(contentCourseProgress).where(eq(contentCourseProgress.enrolmentId, s.enrolmentId));
    expect(row).toMatchObject({ percent: 40, completedRequired: 2, totalRequired: 5 });
  });

  it("progress belongs to the learner: re-enrolling later counts lessons already done", async () => {
    const ctx = await setupLearning({ name: "Re-enrol U", lessons: [{ title: "Lesson A", kind: "text" }, { title: "Lesson B", kind: "text" }] });
    const s = await ctx.enrolled("Student Back");
    await markLessonComplete(s.actor, ctx.lessons[0].id);
    await systemDb().update(enrolments).set({ status: "cancelled" }).where(eq(enrolments.id, s.enrolmentId));
    const again = await holdSeat(s.actor, { batchId: ctx.batch.id, acknowledgeClash: true });
    const { drainEvents } = await import("../helpers/events");
    await drainEvents();
    const id = (again as { enrolmentId: string }).enrolmentId;
    const [row] = await systemDb().select().from(contentCourseProgress).where(eq(contentCourseProgress.enrolmentId, id));
    expect(row.percent).toBe(50);
  });
});

describe("video progress", () => {
  it("adds up the parts watched and completes the lesson at 90%", async () => {
    const ctx = await setupLearning({ name: "Video U", lessons: [{ title: "Watch", kind: "video", minutes: 2 }, { title: "Read", kind: "text" }] });
    const s = await ctx.enrolled("Student Vid");
    await expect(markLessonComplete(s.actor, ctx.lessons[0].id)).rejects.toThrow(/watched 90%/);
    const first = await reportVideoProgress(s.actor, ctx.lessons[0].id, { ranges: [[0, 15]], duration: 100, position: 15 });
    // The first report can't add more than the allowance (20 s of slack); the video is 2 min (staff duration floor: 60 s).
    expect(first).toMatchObject({ completed: false, percent: 15 });
    // Pretend time passed, so the next report's time is plausible.
    const { contentLessonProgress } = await import("@/modules/content-progress/schema");
    const back = new Date(Date.now() - 120_000);
    await systemDb().update(contentLessonProgress).set({ updatedAt: back }).where(eq(contentLessonProgress.lessonId, ctx.lessons[0].id));
    const second = await reportVideoProgress(s.actor, ctx.lessons[0].id, { ranges: [[10, 92]], duration: 100, position: 92 });
    expect(second).toMatchObject({ completed: true, percent: 100, lessonCompleted: true, coursePercent: 50 });
  });

  it("a forged report of the whole video in one go doesn't complete it", async () => {
    const ctx = await setupLearning({ name: "Forged U", lessons: [{ title: "Watch", kind: "video", minutes: 30 }] });
    const s = await ctx.enrolled("Student Skip");
    const r1 = await reportVideoProgress(s.actor, ctx.lessons[0].id, { ranges: [[0, 1800]], duration: 1800, position: 1800 });
    expect(r1.completed).toBe(false);
    const r2 = await reportVideoProgress(s.actor, ctx.lessons[0].id, { ranges: [[0, 1800]], duration: 1800, position: 1800 });
    expect(r2.completed).toBe(false);
    expect(r2.percent).toBeLessThan(10);
    // A short duration claim can't be used either: the staff-set duration is the floor.
    const r3 = await reportVideoProgress(s.actor, ctx.lessons[0].id, { ranges: [[0, 10]], duration: 10, position: 10 });
    expect(r3.completed).toBe(false);
  });

  it("the progress route takes JSON from the same site only and checks enrolment", async () => {
    const ctx = await setupLearning({ name: "Video Route U", lessons: [{ title: "Watch", kind: "video", minutes: 2 }] });
    const s = await ctx.enrolled("Student Route");
    const url = `http://localhost/demo/learn/lessons/${ctx.lessons[0].id}/progress`;
    const body = JSON.stringify({ ranges: [[0, 5]], duration: 120, position: 5 });
    const ok = await videoProgressResponse(s.actor, ctx.lessons[0].id, new Request(url, { method: "POST", body, headers: { origin: "http://localhost", host: "localhost" } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ completed: false });
    const cross = await videoProgressResponse(s.actor, ctx.lessons[0].id, new Request(url, { method: "POST", body, headers: { origin: "https://evil.example", host: "localhost" } }));
    expect(cross.status).toBe(403);
    const bad = await videoProgressResponse(s.actor, ctx.lessons[0].id, new Request(url, { method: "POST", body: "{nope", headers: { host: "localhost" } }));
    expect(bad.status).toBe(422);
    const outsider = await ctx.student("Outsider Vid");
    expect((await videoProgressResponse(outsider, ctx.lessons[0].id, new Request(url, { method: "POST", body }))).status).toBe(403);
  });
});

describe("continue learning", () => {
  it("shows each active course's next unfinished lesson, most recently studied first", async () => {
    const ctx = await setupLearning({ name: "Continue U", lessons: [{ title: "Lesson A", kind: "text" }, { title: "Lesson B", kind: "text" }, { title: "Lesson C", kind: "text", drip: { mode: "after_start", days: 400 } }] });
    const s = await ctx.enrolled("Student Cont");
    let items = await continueLearning(s.actor);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ next: { id: ctx.lessons[0].id }, percent: 0 });
    await markLessonComplete(s.actor, ctx.lessons[0].id);
    await recordLessonOpened(s.actor, ctx.lessons[1].id);
    items = await continueLearning(s.actor);
    expect(items[0]).toMatchObject({ next: { id: ctx.lessons[1].id, started: true }, percent: 33 });
    await markLessonComplete(s.actor, ctx.lessons[1].id);
    items = await continueLearning(s.actor);
    expect(items[0]).toMatchObject({ next: null, nextUnlock: { id: ctx.lessons[2].id } });
  });

  it("a locked lesson opened by URL isn't recorded as the current lesson", async () => {
    const ctx = await setupLearning({ name: "Opened U", lessons: [{ title: "Lesson A", kind: "text", drip: { mode: "after_start", days: 400 } }] });
    const s = await ctx.enrolled("Student Peek");
    expect(await recordLessonOpened(s.actor, ctx.lessons[0].id)).toEqual({ recorded: false });
  });
});
