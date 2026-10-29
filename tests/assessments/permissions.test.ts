/**
 * One allow and one deny per permission rule in the brief and contracts.md section 9:
 * assess.manage, assess.grade, assess.view_results (staff) and self.take_test (learners).
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, systemDb } from "@/db/client";
import { assessAttemptItems } from "@/modules/assessments/schema";
import { gradeItem, paperFor, saveAnswer, startAttempt, submitAttempt } from "@/modules/assessments/attempts";
import { createTest, listTests, setPublished, updateProctoring } from "@/modules/assessments/manage";
import { testResults } from "@/modules/assessments/results";
import { createQuestion } from "@/modules/assessments/pool";
import { person } from "../fixtures";
import { PROCTOR, quiz, single, world } from "./setup";

afterAll(closeDb);

describe("assessments permissions", () => {
  it("assess.manage: the HOD changes a course-wide test; the board can't", async () => {
    const w = await world("Perm Manage U");
    const board = await (await person("Board Bharat", "board_owner", { universityId: w.uni.id })).actor();
    const t = await createTest(w.hod, { kind: "quiz", title: "Managed", courseId: w.course.id, allBatches: true, batchIds: [] });
    await expect(updateProctoring(w.hod, t.id, PROCTOR)).resolves.toBeUndefined();
    await expect(updateProctoring(board, t.id, PROCTOR)).rejects.toThrow(/every batch|not found/);
    await expect(createQuestion(board, w.dept.id, single("Board question"))).rejects.toThrow(/can't use this question pool/);
    await expect(setPublished(board, t.id, true)).rejects.toThrow();
  });

  it("assess.view_results: the board sees results across the university; accounts staff don't", async () => {
    const w = await world("Perm View U");
    const board = await (await person("Board Bharat", "board_owner", { universityId: w.uni.id })).actor();
    const accounts = await (await person("Accounts Arun", "accounts_fees", { universityId: w.uni.id })).actor();
    const { test } = await quiz(w, [single("Viewed question")]);
    const { attemptId } = await startAttempt(w.riya, test.id);
    await submitAttempt(w.riya, attemptId);
    expect((await testResults(board, test.id)).students.map((s) => s.name)).toEqual(["Riya Student"]);
    expect((await listTests(board)).map((t) => t.id)).toContain(test.id);
    await expect(testResults(accounts, test.id)).rejects.toThrow(/Test not found/);
    await expect(listTests(accounts)).rejects.toThrow(/staff who teach/);
  });

  it("assess.grade: the batch's faculty grade; the board (view only) can't", async () => {
    const w = await world("Perm Grade U");
    const board = await (await person("Board Bharat", "board_owner", { universityId: w.uni.id })).actor();
    const { test } = await quiz(w, [{ type: "short", prompt: "Explain normalisation.", marks: 3 }]);
    const { attemptId } = await startAttempt(w.riya, test.id);
    const p = await paperFor(w.riya, attemptId);
    if (p.state === "in_progress") await saveAnswer(w.riya, attemptId, p.paper.items[0].id, { text: "Splitting tables to avoid repeats" });
    await submitAttempt(w.riya, attemptId);
    const [item] = await systemDb().select().from(assessAttemptItems).where(eq(assessAttemptItems.attemptId, attemptId));
    await expect(gradeItem(board, item.id, { score: 3 })).rejects.toThrow(/Answer not found/);
    await expect(gradeItem(w.farah, item.id, { score: 2 })).resolves.toMatchObject({ status: "graded" });
  });

  it("self.take_test: an enrolled student takes a test; a parent can't", async () => {
    const w = await world("Perm Self U");
    const parent = await (await person("Parent Pallavi", "parent", { universityId: w.uni.id })).actor();
    const { test } = await quiz(w, [single("Self question")]);
    await expect(startAttempt(parent, test.id)).rejects.toThrow(/access/);
    await expect(startAttempt(w.riya, test.id)).resolves.toMatchObject({ resumed: false });
  });
});
