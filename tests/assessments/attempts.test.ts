import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { courses } from "@/db/schema";
import { assessAttemptItems, assessAttempts, assessProctorEvents, assessTests } from "@/modules/assessments/schema";
import {
  attemptResult,
  closeExpiredAttempts,
  gradeItem,
  gradingQueue,
  paperFor,
  recordProctorEvent,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from "@/modules/assessments/attempts";
import { myResults, myTests } from "@/modules/assessments/learner";
import { staffAttempt, testResults } from "@/modules/assessments/results";
import { createTest, setPublished, updateProctoring, updateSettings } from "@/modules/assessments/manage";
import { systemActorFor } from "@/server/actor";
import { drainEvents, eventsOfType } from "../helpers/events";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, uniqueCode } from "../fixtures";
import { PROCTOR, quiz, single, world, type World } from "./setup";

afterAll(closeDb);

/** Answers every item of a paper: right when `right`, otherwise wrong. */
async function answerAll(w: World, actor: World["riya"], attemptId: string, right: boolean) {
  const res = await paperFor(actor, attemptId);
  if (res.state !== "in_progress") throw new Error("not in progress");
  const items = await systemDb().select().from(assessAttemptItems).where(eq(assessAttemptItems.attemptId, attemptId));
  for (const p of res.paper.items) {
    const it = items.find((i) => i.id === p.id)!;
    const ans = it.answer as { option?: string; options?: string[]; value?: number };
    const wrong = p.options.find((o) => o.id !== ans.option)?.id;
    const raw =
      it.type === "numeric" ? { value: right ? ans.value : -999 } : it.type === "short" ? { text: "My answer" } : it.type === "multiple" ? { options: right ? ans.options : [p.options[0].id] } : { option: right ? ans.option : wrong };
    await saveAnswer(actor, attemptId, p.id, raw);
  }
  void w;
}

/** Moves an attempt's end time into the past, as if the student ran out of time. */
async function expire(attemptId: string, msAgo = 60_000) {
  await systemDb().update(assessAttempts).set({ endsAt: new Date(Date.now() - msAgo) }).where(eq(assessAttempts.id, attemptId));
}

describe("assessments integrity: correct answers never reach the browser early", () => {
  it("the paper has no answers or explanations, and the result follows 'when answers are shown'", async () => {
    const w = await world("Integrity Answers U");
    const { test } = await quiz(w, [single("Which is right?"), { type: "numeric", prompt: "How many rows?", value: 7319.25, tolerance: 0, explanation: "Count them." }]);
    const { attemptId } = await startAttempt(w.riya, test.id);
    const res = await paperFor(w.riya, attemptId);
    expect(res.state).toBe("in_progress");
    const json = JSON.stringify(res);
    expect(json).not.toMatch(/"answer"|"explanation"|"correct|"guide"|Bravo is right|Count them|7319/);
    // Each paper item has exactly the safe fields.
    if (res.state === "in_progress") {
      for (const item of res.paper.items) expect(Object.keys(item).sort()).toEqual(["id", "marks", "negativeMarks", "options", "position", "prompt", "response", "type"]);
    }
    // Saving answers echoes nothing about correctness.
    const save = await saveAnswer(w.riya, attemptId, (res as { paper: { items: { id: string }[] } }).paper.items[0].id, null);
    expect(JSON.stringify(save)).not.toMatch(/correct|answer/);

    await submitAttempt(w.riya, attemptId);
    const after = await attemptResult(w.riya, attemptId);
    expect(after.items?.[0].explanation).toBe("Bravo is right.");
    expect(after.items?.some((i) => i.correctValue?.value === 7319.25)).toBe(true);
  });

  it("'never' keeps answers hidden after submitting; the score is still shown", async () => {
    const w = await world("Integrity Never U");
    const { test } = await quiz(w, [single("Hidden answer?")]);
    await updateSettings(w.hod, test.id, { title: "SQL basics", kind: "quiz", instructions: "", passPercent: 40, showAnswers: "never", allBatches: true, batchIds: [] });
    const { attemptId } = await startAttempt(w.riya, test.id);
    await answerAll(w, w.riya, attemptId, true);
    await submitAttempt(w.riya, attemptId);
    const r = await attemptResult(w.riya, attemptId);
    expect(r.items).toBeNull();
    expect(r.answersHidden).toBe("never");
    expect(r.attempt.scorePercent).toBe(100);
    expect(JSON.stringify(r)).not.toMatch(/Bravo is right|"answer"|correctOptionIds/);
  });

  it("'after the window closes' hides answers until the close time, then shows them", async () => {
    const w = await world("Integrity Close U");
    const { test } = await quiz(w, [single("Later answer?")], { proctoring: { closesAt: "2099-01-01T10:00" } });
    await updateSettings(w.hod, test.id, { title: "SQL basics", kind: "quiz", instructions: "", passPercent: 40, showAnswers: "after_close", allBatches: true, batchIds: [] });
    const { attemptId } = await startAttempt(w.riya, test.id);
    await submitAttempt(w.riya, attemptId);
    const before = await attemptResult(w.riya, attemptId);
    expect(before.items).toBeNull();
    expect(before.answersHidden).toBe("until_close");
    expect(JSON.stringify(before)).not.toMatch(/Bravo is right/);
    await systemDb().update(assessTests).set({ closesAt: new Date(Date.now() - 1000) }).where(eq(assessTests.id, test.id));
    const after = await attemptResult(w.riya, attemptId);
    expect(after.items?.[0].explanation).toBe("Bravo is right.");
  });
});

describe("assessments integrity: the server's end time", () => {
  it("answers sent after the end time are refused and the attempt is submitted", async () => {
    const w = await world("Integrity Time U");
    const { test } = await quiz(w, [single("Timed question")], { proctoring: { timeLimitMinutes: 10 } });
    const { attemptId } = await startAttempt(w.riya, test.id);
    const res = await paperFor(w.riya, attemptId);
    if (res.state !== "in_progress") throw new Error("expected in progress");
    const ends = new Date(res.paper.endsAt!).getTime();
    expect(ends - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(ends - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    const itemId = res.paper.items[0].id;
    await expect(saveAnswer(w.riya, attemptId, itemId, { option: res.paper.items[0].options[1].id })).resolves.toMatchObject({ ok: true });

    await expire(attemptId);
    const late = await saveAnswer(w.riya, attemptId, itemId, { option: res.paper.items[0].options[0].id });
    expect(late).toMatchObject({ ok: false, submitted: true });
    const [row] = await systemDb().select().from(assessAttempts).where(eq(assessAttempts.id, attemptId));
    expect(row.status).toBe("graded");
    expect(row.submitReason).toBe("time_up");
    // The late answer didn't replace the saved one: option 1 (Bravo) was right.
    expect(row.scorePercent).toBe(100);
    // And nothing more can be saved.
    await expect(saveAnswer(w.riya, attemptId, itemId, null)).resolves.toMatchObject({ ok: false, submitted: true });
  });

  it("the attempt never runs past the test's close time", async () => {
    const w = await world("Integrity Window U");
    const { test } = await quiz(w, [single("Window question")], { proctoring: { timeLimitMinutes: 120 } });
    const closes = new Date(Date.now() + 5 * 60_000);
    await systemDb().update(assessTests).set({ closesAt: closes }).where(eq(assessTests.id, test.id));
    const { attemptId } = await startAttempt(w.riya, test.id);
    const [row] = await systemDb().select().from(assessAttempts).where(eq(assessAttempts.id, attemptId));
    expect(row.endsAt!.getTime()).toBe(closes.getTime());
  });

  it("the job submits attempts whose time ran out, even if the student closed the tab", async () => {
    const w = await world("Integrity Job U");
    const { test } = await quiz(w, [single("Job question")], { proctoring: { timeLimitMinutes: 5 } });
    const { attemptId } = await startAttempt(w.riya, test.id);
    await expire(attemptId);
    const closed = await closeExpiredAttempts(systemActorFor(w.uni.id));
    expect(closed).toBe(1);
    const [row] = await systemDb().select().from(assessAttempts).where(eq(assessAttempts.id, attemptId));
    expect(row).toMatchObject({ status: "graded", submitReason: "time_up", scorePercent: 0 });
    expect(row.submittedAt!.getTime()).toBeLessThanOrEqual(Date.now() - 50_000);
  });

  it("a test that hasn't opened or has closed can't be started", async () => {
    const w = await world("Integrity Open U");
    const { test } = await quiz(w, [single("Future question")], { proctoring: { opensAt: "2099-01-01T10:00" } });
    await expect(startAttempt(w.riya, test.id)).rejects.toThrow(/hasn't opened/);
    await systemDb().update(assessTests).set({ opensAt: null, closesAt: new Date(Date.now() - 1000) }).where(eq(assessTests.id, test.id));
    await expect(startAttempt(w.riya, test.id)).rejects.toThrow(/has closed/);
  });
});

describe("assessments integrity: the attempt limit", () => {
  it("can't be exceeded, even with two tabs starting at the same moment", async () => {
    const w = await world("Integrity Limit U");
    const { test } = await quiz(w, [single("Limit question")], { proctoring: { attemptLimit: 1 } });
    const tabs = await Promise.allSettled([startAttempt(w.riya, test.id), startAttempt(w.riya, test.id), startAttempt(w.riya, test.id)]);
    const ok = tabs.filter((t) => t.status === "fulfilled").map((t) => (t as PromiseFulfilledResult<{ attemptId: string }>).value.attemptId);
    // Every tab that got through got the same attempt.
    expect(new Set(ok).size).toBe(1);
    const rows = await systemDb().select().from(assessAttempts).where(eq(assessAttempts.testId, test.id));
    expect(rows).toHaveLength(1);
    await submitAttempt(w.riya, ok[0]);
    await expect(startAttempt(w.riya, test.id)).rejects.toThrow(/already taken/);
  });

  it("allows retakes up to the limit, one at a time", async () => {
    const w = await world("Integrity Retake U");
    const { test } = await quiz(w, [single("Retake question")], { proctoring: { attemptLimit: 2 } });
    const first = await startAttempt(w.riya, test.id);
    expect(await startAttempt(w.riya, test.id)).toEqual({ attemptId: first.attemptId, resumed: true });
    await submitAttempt(w.riya, first.attemptId);
    const second = await startAttempt(w.riya, test.id);
    expect(second.attemptId).not.toBe(first.attemptId);
    await submitAttempt(w.riya, second.attemptId);
    await expect(startAttempt(w.riya, test.id)).rejects.toThrow(/all 2 attempts/);
    const r = await attemptResult(w.riya, second.attemptId);
    expect(r).toMatchObject({ attemptsUsed: 2, canRetake: false });
  });
});

describe("assessments integrity: students only see their own batches' tests", () => {
  it("a student never sees or starts a test for a batch they aren't in", async () => {
    const w = await world("Integrity Batch U");
    const { test: eveningOnly } = await quiz(w, [single("Evening question")], { by: w.neil, allBatches: false, batchIds: [w.evening.id], title: "Evening quiz" });
    const { test: courseWide } = await quiz(w, [single("Course question")], { title: "Course quiz" });
    const riyas = await myTests(w.riya);
    expect(riyas.tests.map((t) => t.title)).toEqual(["Course quiz"]);
    await expect(startAttempt(w.riya, eveningOnly.id)).rejects.toThrow(/Test not found/);
    const taras = await myTests(w.tara);
    expect(taras.tests.map((t) => t.title).sort()).toEqual(["Course quiz", "Evening quiz"]);
    // Not in the course at all.
    expect((await myTests(w.outsider)).tests).toEqual([]);
    await expect(startAttempt(w.outsider, courseWide.id)).rejects.toThrow(/Test not found/);
  });

  it("drafts are invisible to students", async () => {
    const w = await world("Integrity Draft U");
    const t = await createTest(w.hod, { kind: "quiz", title: "Draft quiz", courseId: w.course.id, allBatches: true, batchIds: [] });
    expect((await myTests(w.riya)).tests).toEqual([]);
    await expect(startAttempt(w.riya, t.id)).rejects.toThrow(/Test not found/);
  });

  it("a student can't read, answer or submit someone else's attempt", async () => {
    const w = await world("Integrity Other U");
    const { test } = await quiz(w, [single("Mine only")]);
    const { attemptId } = await startAttempt(w.riya, test.id);
    await expect(paperFor(w.kabir, attemptId)).rejects.toThrow(/Attempt not found/);
    await expect(saveAnswer(w.kabir, attemptId, attemptId, null)).rejects.toThrow(/Attempt not found/);
    await expect(submitAttempt(w.kabir, attemptId)).rejects.toThrow(/Attempt not found/);
    await expect(attemptResult(w.kabir, attemptId)).rejects.toThrow(/Attempt not found/);
    await expect(recordProctorEvent(w.kabir, attemptId, "tab_hidden")).rejects.toThrow(/Attempt not found/);
  });

  it("only learners take tests (self.take_test allow and deny)", async () => {
    const w = await world("Integrity Role U");
    const { test } = await quiz(w, [single("Role question")]);
    await expect(startAttempt(w.riya, test.id)).resolves.toBeTruthy();
    await expect(startAttempt(w.hod, test.id)).rejects.toThrow(/access/);
    await expect(myTests(w.farah)).rejects.toThrow(/access/);
  });
});

describe("assessments integrity: faculty only see and grade their own batches", () => {
  it("results and grading are limited to the faculty member's batches", async () => {
    const w = await world("Integrity Grade U");
    const { test } = await quiz(w, [{ type: "short", prompt: "Explain an index.", guide: "Speeds up lookups", marks: 4 }]);
    const morningAttempt = await startAttempt(w.riya, test.id);
    await answerAll(w, w.riya, morningAttempt.attemptId, true);
    await submitAttempt(w.riya, morningAttempt.attemptId);
    const eveningAttempt = await startAttempt(w.tara, test.id);
    await answerAll(w, w.tara, eveningAttempt.attemptId, true);
    await submitAttempt(w.tara, eveningAttempt.attemptId);

    // Results: Farah sees Riya (morning) only; Neil sees Tara (evening) only; the HOD sees both.
    expect((await testResults(w.farah, test.id)).students.map((s) => s.name)).toEqual(["Riya Student"]);
    expect((await testResults(w.neil, test.id)).students.map((s) => s.name)).toEqual(["Tara Student"]);
    expect((await testResults(w.hod, test.id)).students.map((s) => s.name).sort()).toEqual(["Riya Student", "Tara Student"]);
    await expect(staffAttempt(w.farah, eveningAttempt.attemptId)).rejects.toThrow(/Attempt not found/);
    await expect(staffAttempt(w.mktHod, morningAttempt.attemptId)).rejects.toThrow(/Attempt not found/);

    // Grading queue and grading follow the same rule.
    expect((await gradingQueue(w.farah)).map((q) => q.studentName)).toEqual(["Riya Student"]);
    expect((await gradingQueue(w.neil)).map((q) => q.studentName)).toEqual(["Tara Student"]);
    const [taraItem] = await systemDb().select().from(assessAttemptItems).where(eq(assessAttemptItems.attemptId, eveningAttempt.attemptId));
    await expect(gradeItem(w.farah, taraItem.id, { score: 4 })).rejects.toThrow(/Answer not found/);
    await expect(gradeItem(w.neil, taraItem.id, { score: 3, feedback: "Good, but mention B-trees." })).resolves.toMatchObject({ status: "graded" });
  });
});

describe("assessments: grading and test.submitted", () => {
  it("objective tests are graded at once and emit test.submitted with the final score", async () => {
    const w = await world("Grading Auto U");
    const { test } = await quiz(w, [single("Auto one"), single("Auto two")]);
    const { attemptId } = await startAttempt(w.riya, test.id);
    await answerAll(w, w.riya, attemptId, true);
    const done = await submitAttempt(w.riya, attemptId);
    expect(done.status).toBe("graded");
    const events = (await eventsOfType("test.submitted", w.uni.id)).filter((e) => (e.payload as { attemptId: string }).attemptId === attemptId);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ attemptId, testId: test.id, userId: w.riya.userId, courseId: w.course.id, batchId: w.morning.id, scorePercent: 100, passed: true });
    // Submitting again changes nothing and emits nothing.
    await submitAttempt(w.riya, attemptId);
    expect((await eventsOfType("test.submitted", w.uni.id)).filter((e) => (e.payload as { attemptId: string }).attemptId === attemptId)).toHaveLength(1);
    await drainEvents({ universityId: w.uni.id });
  });

  it("negative marks count, and the percent never goes below zero", async () => {
    const w = await world("Grading Negative U");
    const { test } = await quiz(w, [single("Wrong one"), single("Wrong two")]);
    const { attemptId } = await startAttempt(w.riya, test.id);
    await answerAll(w, w.riya, attemptId, false);
    await submitAttempt(w.riya, attemptId);
    const [row] = await systemDb().select().from(assessAttempts).where(eq(assessAttempts.id, attemptId));
    expect(row).toMatchObject({ score: -1, maxScore: 4, scorePercent: 0, passed: false });
  });

  it("short answers wait for a grader; test.submitted goes out once nothing is left to grade", async () => {
    const w = await world("Grading Manual U");
    const { test } = await quiz(w, [single("Objective part"), { type: "short", prompt: "Explain GROUP BY.", guide: "Groups rows", marks: 4 }]);
    const { attemptId } = await startAttempt(w.riya, test.id);
    await answerAll(w, w.riya, attemptId, true);
    const sub = await submitAttempt(w.riya, attemptId);
    expect(sub.status).toBe("awaiting_grading");
    const mine = (e: { payload: unknown }) => (e.payload as { attemptId: string }).attemptId === attemptId;
    expect((await eventsOfType("test.submitted", w.uni.id)).filter(mine)).toHaveLength(0);
    const waiting = await attemptResult(w.riya, attemptId);
    expect(waiting.attempt.score).toBeNull(); // no partial score shown while grading
    expect(waiting.attempt.status).toBe("awaiting_grading");

    const [queue] = await gradingQueue(w.farah);
    expect(queue).toMatchObject({ attemptId, studentName: "Riya Student", testTitle: "SQL basics" });
    await expect(gradeItem(w.farah, queue.itemId, { score: 5 })).rejects.toThrow(/between 0 and 4/);
    const [objective] = await systemDb().select().from(assessAttemptItems).where(eq(assessAttemptItems.attemptId, attemptId));
    if (objective.type !== "short") await expect(gradeItem(w.farah, objective.id, { score: 1 })).rejects.toThrow(/Only short answers/);
    await gradeItem(w.farah, queue.itemId, { score: 3, feedback: "Mention HAVING." });
    const events = (await eventsOfType("test.submitted", w.uni.id)).filter(mine);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ scorePercent: 83.33, passed: true });
    await expect(gradeItem(w.farah, queue.itemId, { score: 4 })).rejects.toThrow(/already final/);
    expect(await gradingQueue(w.farah)).toEqual([]);
    const final = await attemptResult(w.riya, attemptId);
    expect(final.items?.find((i) => i.type === "short")).toMatchObject({ awarded: 3, feedback: "Mention HAVING." });
  });

  it("a blank short answer needs no grading", async () => {
    const w = await world("Grading Blank U");
    const { test } = await quiz(w, [{ type: "short", prompt: "Explain views.", marks: 2 }]);
    const { attemptId } = await startAttempt(w.riya, test.id);
    expect((await submitAttempt(w.riya, attemptId)).status).toBe("graded");
  });
});

describe("assessments: proctoring events are recorded on the server", () => {
  it("counts tab switches and full-screen exits, and auto-submits past the tab-switch limit", async () => {
    const w = await world("Proctor U");
    const { test } = await quiz(w, [single("Proctored")], { proctoring: { tabSwitchLimit: 2, fullscreenRequired: true } });
    const { attemptId } = await startAttempt(w.riya, test.id);
    await expect(recordProctorEvent(w.riya, attemptId, "fullscreen_exit")).resolves.toMatchObject({ fullscreenExits: 1, submitted: false });
    await expect(recordProctorEvent(w.riya, attemptId, "tab_hidden")).resolves.toMatchObject({ tabSwitches: 1, submitted: false });
    await expect(recordProctorEvent(w.riya, attemptId, "tab_hidden")).resolves.toMatchObject({ tabSwitches: 2, submitted: false });
    await expect(recordProctorEvent(w.riya, attemptId, "tab_hidden")).resolves.toMatchObject({ tabSwitches: 3, submitted: true });
    const [row] = await systemDb().select().from(assessAttempts).where(eq(assessAttempts.id, attemptId));
    expect(row).toMatchObject({ status: "graded", submitReason: "tab_limit", tabSwitches: 3, fullscreenExits: 1 });
    const events = await systemDb().select().from(assessProctorEvents).where(eq(assessProctorEvents.attemptId, attemptId));
    expect(events.map((e) => e.kind).sort()).toEqual(["fullscreen_exit", "tab_hidden", "tab_hidden", "tab_hidden"]);
    const staff = await staffAttempt(w.hod, attemptId);
    expect(staff.events).toHaveLength(4);
  });
});

describe("assessments: resuming and shuffling", () => {
  it("answers autosave and the test resumes after a reload with the same paper", async () => {
    const w = await world("Resume U");
    const { test } = await quiz(w, [single("First"), single("Second"), single("Third")], { proctoring: { shuffleQuestions: true, shuffleOptions: true } });
    const { attemptId } = await startAttempt(w.riya, test.id);
    const first = await paperFor(w.riya, attemptId);
    if (first.state !== "in_progress") throw new Error("expected in progress");
    const pick = first.paper.items[1].options[2].id;
    await saveAnswer(w.riya, attemptId, first.paper.items[1].id, { option: pick });
    const again = await startAttempt(w.riya, test.id);
    expect(again).toEqual({ attemptId, resumed: true });
    const reloaded = await paperFor(w.riya, attemptId);
    if (reloaded.state !== "in_progress") throw new Error("expected in progress");
    expect(reloaded.paper.items.map((i) => [i.prompt, i.options.map((o) => o.id)])).toEqual(first.paper.items.map((i) => [i.prompt, i.options.map((o) => o.id)]));
    expect(reloaded.paper.items[1].response).toEqual({ option: pick });
  });

  it("draw rules give each attempt its own random questions", async () => {
    const w = await world("Draw U");
    const { createQuestion } = await import("@/modules/assessments/pool");
    const { addDrawRule } = await import("@/modules/assessments/manage");
    for (let i = 0; i < 12; i++) await createQuestion(w.hod, w.dept.id, single(`Drawn question ${i}`, { difficulty: "medium", tags: ["SQL"] }));
    const t = await createTest(w.hod, { kind: "quiz", title: "Drawn", courseId: w.course.id, allBatches: true, batchIds: [] });
    await addDrawRule(w.hod, t.id, { count: 8, pool: w.dept.id, difficulty: "medium", tag: "sql" });
    await updateProctoring(w.hod, t.id, PROCTOR);
    await setPublished(w.hod, t.id, true);
    const a = await startAttempt(w.riya, t.id);
    const b = await startAttempt(w.kabir, t.id);
    const pa = await paperFor(w.riya, a.attemptId);
    const pb = await paperFor(w.kabir, b.attemptId);
    if (pa.state !== "in_progress" || pb.state !== "in_progress") throw new Error("expected in progress");
    expect(pa.paper.items).toHaveLength(8);
    expect(pb.paper.items).toHaveLength(8);
    expect(new Set(pa.paper.items.map((i) => i.prompt)).size).toBe(8);
  });
});

describe("assessments: the learner's list", () => {
  it("splits tests into available, upcoming and completed, with results", async () => {
    const w = await world("Learner List U");
    await quiz(w, [single("Open question")], { title: "Open quiz" });
    await quiz(w, [single("Later question")], { title: "Later quiz", proctoring: { opensAt: "2099-01-01T10:00" } });
    const { test: done } = await quiz(w, [single("Done question")], { title: "Done quiz" });
    const { attemptId } = await startAttempt(w.riya, done.id);
    await answerAll(w, w.riya, attemptId, true);
    await submitAttempt(w.riya, attemptId);
    const mine = await myTests(w.riya);
    const by = (b: string) => mine.tests.filter((t) => t.bucket === b).map((t) => t.title);
    expect(by("available")).toEqual(["Open quiz"]);
    expect(by("upcoming")).toEqual(["Later quiz"]);
    expect(by("completed")).toEqual(["Done quiz"]);
    expect(mine.tests.find((t) => t.title === "Done quiz")?.best?.scorePercent).toBe(100);
    const results = await myResults(w.riya);
    expect(results.rows.map((r) => r.testTitle)).toEqual(["Done quiz"]);
  });

  it("shows a published test series as one item with its tests in order", async () => {
    const w = await world("Learner Series U");
    const { addToSeries } = await import("@/modules/assessments/manage");
    const series = await createTest(w.hod, { kind: "series", title: "Practice series", courseId: w.course.id, allBatches: true, batchIds: [] });
    const { test: one } = await quiz(w, [single("Series one")], { title: "Part 1" });
    const { test: two } = await quiz(w, [single("Series two")], { title: "Part 2" });
    await addToSeries(w.hod, series.id, one.id);
    await addToSeries(w.hod, series.id, two.id);
    // While the series is a draft, its tests are hidden too.
    expect((await myTests(w.riya)).tests).toEqual([]);
    await expect(startAttempt(w.riya, one.id)).rejects.toThrow(/Test not found/);
    await setPublished(w.hod, series.id, true);
    const mine = await myTests(w.riya);
    expect(mine.tests).toEqual([]);
    expect(mine.series).toHaveLength(1);
    expect(mine.series[0]).toMatchObject({ title: "Practice series", done: 0, bucket: "available" });
    expect(mine.series[0].tests.map((t) => t.title)).toEqual(["Part 1", "Part 2"]);
  });
});

describe("assessments: tenant isolation of attempt tables", () => {
  async function attempt(uni: { id: string }) {
    const dept = await makeDepartment(uni.id, uniqueCode(), "CS");
    const { batches, users } = await import("@/db/schema");
    const [c] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Iso" }).returning();
    const [b] = await systemDb()
      .insert(batches)
      .values({ universityId: uni.id, courseId: c.id, departmentId: dept.id, name: "B", startDate: "2030-01-01", endDate: "2030-02-01", seatLimit: 5 })
      .returning();
    const [t] = await systemDb().insert(assessTests).values({ universityId: uni.id, courseId: c.id, departmentId: dept.id, kind: "quiz", title: "Iso" }).returning();
    const [u] = await systemDb().insert(users).values({ name: "Iso Student", email: `iso.${uniqueCode().toLowerCase()}@test.zinny` }).returning();
    return { c, b, t, u };
  }

  it("assess_attempts is isolated", () =>
    expectTenantIsolated(assessAttempts, async (uni) => {
      const { c, b, t, u } = await attempt(uni);
      return { universityId: uni.id, testId: t.id, userId: u.id, courseId: c.id, batchId: b.id, attemptNo: 1 };
    }));

  it("assess_attempt_items is isolated", () =>
    expectTenantIsolated(assessAttemptItems, async (uni) => {
      const { c, b, t, u } = await attempt(uni);
      const [a] = await systemDb().insert(assessAttempts).values({ universityId: uni.id, testId: t.id, userId: u.id, courseId: c.id, batchId: b.id, attemptNo: 1 }).returning();
      return { universityId: uni.id, attemptId: a.id, position: 0, type: "short" as const, prompt: "Iso", answer: { guide: "" }, marks: 1 };
    }));

  it("assess_proctor_events is isolated", () =>
    expectTenantIsolated(assessProctorEvents, async (uni) => {
      const { c, b, t, u } = await attempt(uni);
      const [a] = await systemDb().insert(assessAttempts).values({ universityId: uni.id, testId: t.id, userId: u.id, courseId: c.id, batchId: b.id, attemptNo: 1 }).returning();
      return { universityId: uni.id, attemptId: a.id, kind: "tab_hidden" as const };
    }));
});
