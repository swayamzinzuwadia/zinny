import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { assessQuestions } from "@/modules/assessments/schema";
import { archiveQuestion, createQuestion, importQuestions, listPools, searchQuestions, updateQuestion, CSV_SAMPLE } from "@/modules/assessments/pool";
import { expectTenantIsolated } from "../helpers/isolation";
import { makeDepartment, person, uniqueCode } from "../fixtures";
import { single, world } from "./setup";

afterAll(closeDb);

describe("assessments: who can write in the question pool", () => {
  it("admins write anywhere, including the university-wide pool", async () => {
    const w = await world("Pool Admin U");
    await expect(createQuestion(w.admin, null, single("Uni-wide question"))).resolves.toMatchObject({ departmentId: null });
    await expect(createQuestion(w.admin, w.mkt.id, single("Marketing question"))).resolves.toMatchObject({ departmentId: w.mkt.id });
    const pools = await listPools(w.admin);
    expect(pools[0]).toMatchObject({ key: "university", departmentId: null });
    expect(pools.map((p) => p.departmentId)).toEqual(expect.arrayContaining([w.dept.id, w.mkt.id]));
  });

  it("a HOD writes in their own department's pool, not another department's or the university pool", async () => {
    const w = await world("Pool HOD U");
    await expect(createQuestion(w.hod, w.dept.id, single("CS question"))).resolves.toBeTruthy();
    await expect(createQuestion(w.hod, w.mkt.id, single("Sneaky"))).rejects.toThrow(/can't use this question pool/);
    await expect(createQuestion(w.hod, null, single("Sneaky"))).rejects.toThrow(/can't use this question pool/);
    expect((await listPools(w.hod)).map((p) => p.departmentId)).toEqual([w.dept.id]);
  });

  it("faculty add to and use the pool of a department where they teach a batch, and nowhere else", async () => {
    const w = await world("Pool Faculty U");
    await expect(createQuestion(w.farah, w.dept.id, single("Farah's question"))).resolves.toBeTruthy();
    await expect(createQuestion(w.farah, w.mkt.id, single("Sneaky"))).rejects.toThrow(/can't use this question pool/);
    await expect(createQuestion(w.farah, null, single("Sneaky"))).rejects.toThrow(/can't use this question pool/);
    // A faculty member with no batch has no pool at all.
    const idle = await (await person("Idle Faculty", "permanent_faculty", { universityId: w.uni.id, departmentId: w.dept.id })).actor();
    await expect(createQuestion(idle, w.dept.id, single("Sneaky"))).rejects.toThrow(/can't use this question pool/);
    await expect(searchQuestions(idle)).rejects.toThrow(/Pools open to staff/);
  });

  it("faculty edit and remove only their own questions; the HOD edits anyone's in the department", async () => {
    const w = await world("Pool Edit U");
    const mine = await createQuestion(w.farah, w.dept.id, single("Farah's"));
    const hodQ = await createQuestion(w.hod, w.dept.id, single("Hema's"));
    await expect(updateQuestion(w.farah, mine.id, single("Farah's, edited"))).resolves.toMatchObject({ prompt: "Farah's, edited" });
    await expect(updateQuestion(w.farah, hodQ.id, single("Hijacked"))).rejects.toThrow(/Only the person who wrote/);
    await expect(archiveQuestion(w.neil, mine.id)).rejects.toThrow(/Only the person who wrote/);
    await expect(updateQuestion(w.hod, mine.id, single("Fixed by the HOD"))).resolves.toMatchObject({ prompt: "Fixed by the HOD" });
    await expect(updateQuestion(w.mktHod, mine.id, single("Other dept"))).rejects.toThrow(/can't use this question pool/);
    await archiveQuestion(w.farah, mine.id);
    const { rows } = await searchQuestions(w.hod, { pool: w.dept.id });
    expect(rows.map((r) => r.id)).not.toContain(mine.id);
  });

  it("students can't touch the pool", async () => {
    const w = await world("Pool Student U");
    await expect(createQuestion(w.riya, w.dept.id, single("Sneaky"))).rejects.toThrow(/can't use this question pool/);
    await expect(searchQuestions(w.riya)).rejects.toThrow();
  });
});

describe("assessments: searching the pool", () => {
  it("filters by text, tag, type and difficulty, only in pools the actor can use", async () => {
    const w = await world("Pool Search U");
    await createQuestion(w.hod, w.dept.id, single("Which JOIN keeps unmatched rows?", { tags: ["SQL", "Joins"], difficulty: "hard" }));
    await createQuestion(w.hod, w.dept.id, { type: "true_false", prompt: "A view stores data.", isTrue: false, tags: ["SQL"], difficulty: "easy" });
    await createQuestion(w.hod, w.dept.id, { type: "numeric", prompt: "Median of 1, 3, 9?", value: 3, tags: ["Statistics"], difficulty: "easy" });
    await createQuestion(w.mktHod, w.mkt.id, single("What is CTR?", { tags: ["SQL"] }));

    const all = await searchQuestions(w.hod);
    expect(all.total).toBe(3);
    expect((await searchQuestions(w.hod, { q: "join" })).rows.map((r) => r.prompt)).toEqual(["Which JOIN keeps unmatched rows?"]);
    expect((await searchQuestions(w.hod, { tag: "sql" })).total).toBe(2);
    expect((await searchQuestions(w.hod, { type: "numeric" })).rows[0].prompt).toBe("Median of 1, 3, 9?");
    expect((await searchQuestions(w.hod, { difficulty: "easy", tag: "SQL" })).rows.map((r) => r.prompt)).toEqual(["A view stores data."]);
    expect(all.tags.map((t) => t.tag)).toEqual(expect.arrayContaining(["SQL", "Joins", "Statistics"]));
    // The admin sees every pool.
    expect((await searchQuestions(w.admin, { tag: "SQL" })).total).toBe(3);
    // Asking for a pool you can't use returns nothing rather than another department's questions.
    expect((await searchQuestions(w.hod, { pool: w.mkt.id })).total).toBe(0);
  });
});

describe("assessments: CSV import", () => {
  it("checks every row first and saves nothing when any row is wrong", async () => {
    const w = await world("Import U");
    const bad = `type,question,option_a,option_b,answer
single,Good row,Yes,No,A
single,Bad answer,Yes,No,C
essay,Wrong type,,,`;
    const check = await importQuestions(w.hod, w.dept.id, bad, { commit: true });
    expect(check.errors).toBe(2);
    expect(check.saved).toBe(0);
    expect(check.rows.map((r) => [r.line, r.ok])).toEqual([
      [2, true],
      [3, false],
      [4, false],
    ]);
    expect(check.rows[1].error).toMatch(/doesn't match a filled option/);
    expect((await searchQuestions(w.hod)).total).toBe(0);
  });

  it("imports the sample file, and importing it again adds nothing", async () => {
    const w = await world("Import Sample U");
    const dry = await importQuestions(w.hod, w.dept.id, CSV_SAMPLE, { commit: false });
    expect(dry).toMatchObject({ errors: 0, saved: 0, total: 5 });
    const done = await importQuestions(w.hod, w.dept.id, CSV_SAMPLE, { commit: true });
    expect(done.saved).toBe(5);
    const again = await importQuestions(w.hod, w.dept.id, CSV_SAMPLE, { commit: true });
    expect(again).toMatchObject({ saved: 0, skipped: 5, errors: 0 });
    const { rows } = await searchQuestions(w.hod);
    expect(rows.map((r) => r.type).sort()).toEqual(["multiple", "numeric", "short", "single", "true_false"]);
  });

  it("flags the same question twice in one file, and refuses pools you can't write to", async () => {
    const w = await world("Import Dup U");
    const twice = `type,question,answer\ntrue_false,Same,true\ntrue_false,Same,false`;
    const r = await importQuestions(w.hod, w.dept.id, twice, { commit: false });
    expect(r.rows[1].error).toMatch(/appears twice/);
    await expect(importQuestions(w.hod, w.mkt.id, CSV_SAMPLE, { commit: true })).rejects.toThrow(/can't use this question pool/);
    await expect(importQuestions(w.hod, w.dept.id, "name,email\nx,y", { commit: false })).rejects.toThrow(/type, question, answer/);
  });
});

describe("assessments: tenant isolation", () => {
  it("assess_questions is isolated per university", () =>
    expectTenantIsolated(assessQuestions, async (uni) => ({
      universityId: uni.id,
      departmentId: (await makeDepartment(uni.id, uniqueCode(), "CS")).id,
      type: "true_false" as const,
      prompt: "Isolated?",
      options: [],
      answer: { option: "t" },
    })));

  it("the university-wide pool row is isolated too", () =>
    expectTenantIsolated(assessQuestions, (uni) => ({
      universityId: uni.id,
      departmentId: null,
      type: "short" as const,
      prompt: "Uni pool",
      options: [],
      answer: { guide: "" },
    })));
});
