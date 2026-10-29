import { afterAll, describe, expect, it } from "vitest";
import { closeDb, systemDb } from "@/db/client";
import { courses } from "@/db/schema";
import { assessDrawRules, assessTestBatches, assessTestQuestions, assessTests } from "@/modules/assessments/schema";
import { createQuestion } from "@/modules/assessments/pool";
import {
  addDrawRule,
  addQuestionsToTest,
  addToSeries,
  createTest,
  deleteTest,
  getTest,
  listTests,
  removeFromSeries,
  seriesTests,
  setPublished,
  testCourseChoices,
  testQuestions,
  updateProctoring,
  updateSettings,
} from "@/modules/assessments/manage";
import { startAttempt } from "@/modules/assessments/attempts";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, uniqueCode } from "../fixtures";
import { PROCTOR, quiz, single, world } from "./setup";

afterAll(closeDb);

describe("assessments: who can create tests", () => {
  it("faculty create tests only for their own batches, never for the whole course", async () => {
    const w = await world("Tests Faculty U");
    await expect(createTest(w.farah, { kind: "quiz", title: "Morning quiz", courseId: w.course.id, allBatches: false, batchIds: [w.morning.id] })).resolves.toBeTruthy();
    await expect(createTest(w.farah, { kind: "quiz", title: "Evening quiz", courseId: w.course.id, allBatches: false, batchIds: [w.evening.id] })).rejects.toThrow(
      /batches you teach/,
    );
    await expect(createTest(w.farah, { kind: "quiz", title: "Both", courseId: w.course.id, allBatches: false, batchIds: [w.morning.id, w.evening.id] })).rejects.toThrow(
      /batches you teach/,
    );
    await expect(createTest(w.farah, { kind: "quiz", title: "Whole course", courseId: w.course.id, allBatches: true, batchIds: [] })).rejects.toThrow(
      /whole course/,
    );
    const choices = await testCourseChoices(w.farah);
    expect(choices).toHaveLength(1);
    expect(choices[0]).toMatchObject({ courseId: w.course.id, wholeCourse: false });
    expect(choices[0].batches.map((b) => b.id)).toEqual([w.morning.id]);
  });

  it("the HOD and admins create course-wide tests; another department's HOD can't", async () => {
    const w = await world("Tests HOD U");
    await expect(createTest(w.hod, { kind: "mock_test", title: "Mid-term mock", courseId: w.course.id, allBatches: true, batchIds: [] })).resolves.toMatchObject({
      kind: "mock_test",
      timeLimitMinutes: 60,
      attemptLimit: 1,
    });
    await expect(createTest(w.admin, { kind: "quiz", title: "Admin quiz", courseId: w.course.id, allBatches: true, batchIds: [] })).resolves.toBeTruthy();
    await expect(createTest(w.mktHod, { kind: "quiz", title: "Other dept", courseId: w.course.id, allBatches: true, batchIds: [] })).rejects.toThrow(/whole course/);
    await expect(createTest(w.riya, { kind: "quiz", title: "Student", courseId: w.course.id, allBatches: true, batchIds: [] })).rejects.toThrow();
  });

  it("a batch from another course can't be targeted", async () => {
    const w = await world("Tests Cross U");
    const { createCourse } = await import("@/server/services/courses");
    const other = await createCourse(w.hod, { departmentId: w.dept.id, title: "Other course", pricePaise: 0 });
    await expect(createTest(w.hod, { kind: "quiz", title: "Mixed", courseId: other.id, allBatches: false, batchIds: [w.morning.id] })).rejects.toThrow(/isn't part of this course/);
  });
});

describe("assessments: one tests list with a type filter", () => {
  it("filters by type and shows each person only what they may see", async () => {
    const w = await world("Tests List U");
    await createTest(w.hod, { kind: "quiz", title: "Course quiz", courseId: w.course.id, allBatches: true, batchIds: [] });
    await createTest(w.hod, { kind: "mock_test", title: "Course mock", courseId: w.course.id, allBatches: true, batchIds: [] });
    await createTest(w.hod, { kind: "series", title: "Practice series", courseId: w.course.id, allBatches: true, batchIds: [] });
    await createTest(w.farah, { kind: "quiz", title: "Morning-only quiz", courseId: w.course.id, allBatches: false, batchIds: [w.morning.id] });
    await createTest(w.neil, { kind: "quiz", title: "Evening-only quiz", courseId: w.course.id, allBatches: false, batchIds: [w.evening.id] });

    expect((await listTests(w.hod)).map((t) => t.title).sort()).toEqual(["Course mock", "Course quiz", "Evening-only quiz", "Morning-only quiz", "Practice series"]);
    expect((await listTests(w.hod, { kind: "mock_test" })).map((t) => t.title)).toEqual(["Course mock"]);
    expect((await listTests(w.hod, { kind: "series" })).map((t) => t.title)).toEqual(["Practice series"]);
    // Farah sees course-wide tests and her own batch's, never the evening batch's.
    expect((await listTests(w.farah)).map((t) => t.title).sort()).toEqual(["Course mock", "Course quiz", "Morning-only quiz", "Practice series"]);
    expect((await listTests(w.mktHod)).map((t) => t.title)).toEqual([]);
    await expect(listTests(w.riya)).rejects.toThrow();
  });

  it("faculty can't open another batch's test, even by id", async () => {
    const w = await world("Tests Peek U");
    const t = await createTest(w.neil, { kind: "quiz", title: "Evening-only", courseId: w.course.id, allBatches: false, batchIds: [w.evening.id] });
    await expect(getTest(w.farah, t.id)).rejects.toThrow(/Test not found/);
    await expect(getTest(w.neil, t.id)).resolves.toMatchObject({ canManage: true });
  });

  it("faculty can view a course-wide test but not change it", async () => {
    const w = await world("Tests View U");
    const t = await createTest(w.hod, { kind: "quiz", title: "Course quiz", courseId: w.course.id, allBatches: true, batchIds: [] });
    await expect(getTest(w.farah, t.id)).resolves.toMatchObject({ canManage: false });
    await expect(updateProctoring(w.farah, t.id, PROCTOR)).rejects.toThrow(/every batch/);
  });
});

describe("assessments: questions, draw rules and publishing", () => {
  it("picks questions from the pool and adds draw rules, then publishes", async () => {
    const w = await world("Tests Build U");
    const qs = [];
    for (let i = 0; i < 3; i++) qs.push(await createQuestion(w.hod, w.dept.id, single(`Picked ${i}`, { tags: ["Basics"] })));
    for (let i = 0; i < 10; i++) await createQuestion(w.hod, w.dept.id, single(`Medium SQL ${i}`, { tags: ["SQL"], difficulty: "medium" }));
    const t = await createTest(w.hod, { kind: "quiz", title: "Build", courseId: w.course.id, allBatches: true, batchIds: [] });
    await expect(setPublished(w.hod, t.id, true)).rejects.toThrow(/Add questions/);
    const added = await addQuestionsToTest(w.hod, t.id, qs.map((q) => q.id));
    expect(added).toEqual({ added: 3, skipped: 0 });
    expect(await addQuestionsToTest(w.hod, t.id, [qs[0].id])).toEqual({ added: 0, skipped: 1 });
    await addDrawRule(w.hod, t.id, { count: 8, pool: w.dept.id, difficulty: "medium", tag: "SQL" });
    await expect(addDrawRule(w.hod, t.id, { count: 11, pool: w.dept.id, difficulty: "medium", tag: "SQL" })).rejects.toThrow(/only 10 questions/);
    const view = await testQuestions(w.hod, t.id);
    expect(view.questionCount).toBe(11);
    expect(view.totalMarks).toBe(22);
    expect(view.rules[0]).toMatchObject({ count: 8, difficulty: "medium", tag: "SQL", available: 10 });
    await setPublished(w.hod, t.id, true);
    expect((await getTest(w.hod, t.id)).test.status).toBe("published");
  });

  it("faculty can't add another department's questions to their test", async () => {
    const w = await world("Tests Pool Cross U");
    const mktQ = await createQuestion(w.mktHod, w.mkt.id, single("CTR?"));
    const t = await createTest(w.farah, { kind: "quiz", title: "Mine", courseId: w.course.id, allBatches: false, batchIds: [w.morning.id] });
    await expect(addQuestionsToTest(w.farah, t.id, [mktQ.id])).rejects.toThrow(/can't use this question pool/);
    await expect(addDrawRule(w.farah, t.id, { count: 1, pool: "university" })).rejects.toThrow(/can't use this question pool/);
  });

  it("checks proctoring values and the test window", async () => {
    const w = await world("Tests Proctor U");
    const t = await createTest(w.hod, { kind: "quiz", title: "Timed", courseId: w.course.id, allBatches: true, batchIds: [] });
    await expect(updateProctoring(w.hod, t.id, { ...PROCTOR, attemptLimit: 0 })).rejects.toThrow(/Attempts allowed/);
    await expect(updateProctoring(w.hod, t.id, { ...PROCTOR, timeLimitMinutes: 0 })).rejects.toThrow(/Time limit/);
    await expect(updateProctoring(w.hod, t.id, { ...PROCTOR, opensAt: "2030-01-02T10:00", closesAt: "2030-01-02T09:00" })).rejects.toThrow(/after the open time/);
    await expect(updateProctoring(w.hod, t.id, { ...PROCTOR, timeLimitMinutes: 90, opensAt: "2030-01-02T10:00", closesAt: "2030-01-02T11:00" })).rejects.toThrow(
      /shorter than the time limit/,
    );
    await updateProctoring(w.hod, t.id, { ...PROCTOR, timeLimitMinutes: 30, tabSwitchLimit: 2, opensAt: "2030-01-02T10:00", closesAt: "2030-01-02T12:00" });
    const { test } = await getTest(w.hod, t.id);
    expect(test).toMatchObject({ timeLimitMinutes: 30, tabSwitchLimit: 2 });
    expect(test.opensAt!.toISOString()).toBe("2030-01-02T04:30:00.000Z"); // 10:00 in Asia/Kolkata
  });

  it("settings: answers after close need a close time; targets follow the same rules as creating", async () => {
    const w = await world("Tests Settings U");
    const t = await createTest(w.hod, { kind: "quiz", title: "Settings", courseId: w.course.id, allBatches: true, batchIds: [] });
    const base = { title: "Settings", kind: "quiz", instructions: "", passPercent: 50, showAnswers: "after_submit", allBatches: true, batchIds: [] };
    await expect(updateSettings(w.hod, t.id, { ...base, showAnswers: "after_close" })).rejects.toThrow(/close time/);
    await expect(updateSettings(w.hod, t.id, { ...base, passPercent: 120 })).rejects.toThrow(/Pass mark/);
    await expect(updateSettings(w.hod, t.id, { ...base, kind: "series" })).rejects.toThrow(/can't become a test series/);
    await updateSettings(w.hod, t.id, { ...base, title: "Renamed", kind: "mock_test", allBatches: false, batchIds: [w.evening.id] });
    const after = await getTest(w.hod, t.id);
    expect(after.test).toMatchObject({ title: "Renamed", kind: "mock_test", allBatches: false, passPercent: 50 });
    expect(after.batchIds).toEqual([w.evening.id]);
  });

  it("a test students have taken can't be unpublished or deleted", async () => {
    const w = await world("Tests Locked U");
    const { test } = await quiz(w, [single("Question one")]);
    await startAttempt(w.riya, test.id);
    await expect(setPublished(w.hod, test.id, false)).rejects.toThrow(/already taken/);
    await expect(deleteTest(w.hod, test.id)).rejects.toThrow(/can't be deleted/);
    const fresh = await createTest(w.hod, { kind: "quiz", title: "Unused", courseId: w.course.id, allBatches: true, batchIds: [] });
    await deleteTest(w.hod, fresh.id);
    await expect(getTest(w.hod, fresh.id)).rejects.toThrow(/not found/);
  });
});

describe("assessments: test series", () => {
  it("an ordered set of tests of the same course", async () => {
    const w = await world("Series U");
    const series = await createTest(w.hod, { kind: "series", title: "Weekly practice", courseId: w.course.id, allBatches: true, batchIds: [] });
    const a = await createTest(w.hod, { kind: "quiz", title: "Week 1", courseId: w.course.id, allBatches: true, batchIds: [] });
    const b = await createTest(w.hod, { kind: "quiz", title: "Week 2", courseId: w.course.id, allBatches: true, batchIds: [] });
    await expect(setPublished(w.hod, series.id, true)).rejects.toThrow(/Add at least one test/);
    await addToSeries(w.hod, series.id, b.id);
    await addToSeries(w.hod, series.id, a.id);
    await expect(addToSeries(w.hod, series.id, a.id)).rejects.toThrow(/already in the series/);
    await expect(addToSeries(w.hod, series.id, series.id)).rejects.toThrow(/can't contain another series/);
    const { moveInSeries } = await import("@/modules/assessments/manage");
    await moveInSeries(w.hod, series.id, a.id, "up");
    expect((await seriesTests(w.hod, series.id)).children.map((c) => c.title)).toEqual(["Week 1", "Week 2"]);
    await removeFromSeries(w.hod, series.id, b.id);
    expect((await seriesTests(w.hod, series.id)).children.map((c) => c.title)).toEqual(["Week 1"]);
    const second = await createTest(w.hod, { kind: "series", title: "Other series", courseId: w.course.id, allBatches: true, batchIds: [] });
    await expect(addToSeries(w.hod, second.id, a.id)).rejects.toThrow(/another series/);
    // Faculty can't add a course-wide test to a series (they don't manage it).
    await expect(addToSeries(w.farah, series.id, b.id)).rejects.toThrow(/every batch/);
  });
});

describe("assessments: tenant isolation of test tables", () => {
  async function course(uni: { id: string }) {
    const dept = await makeDepartment(uni.id, uniqueCode(), "CS");
    const [c] = await systemDb().insert(courses).values({ universityId: uni.id, departmentId: dept.id, title: "Isolated" }).returning();
    return { dept, c };
  }
  async function test(uni: { id: string }) {
    const { dept, c } = await course(uni);
    const [t] = await systemDb().insert(assessTests).values({ universityId: uni.id, courseId: c.id, departmentId: dept.id, kind: "quiz", title: "Iso" }).returning();
    return { dept, c, t };
  }

  it("assess_tests is isolated", () =>
    expectTenantIsolated(assessTests, async (uni) => {
      const { dept, c } = await course(uni);
      return { universityId: uni.id, courseId: c.id, departmentId: dept.id, kind: "quiz" as const, title: "Iso" };
    }));

  it("assess_test_batches is isolated", () =>
    expectTenantIsolated(assessTestBatches, async (uni) => {
      const { dept, c, t } = await test(uni);
      const { batches } = await import("@/db/schema");
      const [b] = await systemDb()
        .insert(batches)
        .values({ universityId: uni.id, courseId: c.id, departmentId: dept.id, name: "B", startDate: "2030-01-01", endDate: "2030-02-01", seatLimit: 5 })
        .returning();
      return { universityId: uni.id, testId: t.id, batchId: b.id };
    }));

  it("assess_test_questions is isolated", () =>
    expectTenantIsolated(assessTestQuestions, async (uni) => {
      const { dept, t } = await test(uni);
      const { assessQuestions } = await import("@/modules/assessments/schema");
      const [q] = await systemDb()
        .insert(assessQuestions)
        .values({ universityId: uni.id, departmentId: dept.id, type: "true_false", prompt: "Iso", options: [], answer: { option: "t" } })
        .returning();
      return { universityId: uni.id, testId: t.id, questionId: q.id };
    }));

  it("assess_draw_rules is isolated", () =>
    expectTenantIsolated(assessDrawRules, async (uni) => {
      const { t } = await test(uni);
      return { universityId: uni.id, testId: t.id, count: 3 };
    }));
});
