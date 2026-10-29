/**
 * Tests, quizzes and test series for staff (brief items 3 to 5): one list with a type filter,
 * and inside a test the Questions, Proctoring, Settings and Results tabs.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, max, ne, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses } from "@/db/schema";
import { audit, batchLite, batchStudentIds, getCourseLite, notify, reach, universityLite, withTenant, type Actor } from "@/server/core";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  assertPoolAccess,
  canManageTargets,
  courseChoices,
  hasReach,
  loadTest,
  poolKeyToDepartment,
  testBatchIds,
  testFor,
  testForManager,
  testsInReach,
  uni,
  type TestRow,
} from "./access";
import { KIND_LABEL, SHOW_ANSWERS, TEST_KINDS, plural } from "./lib/labels";
import { formatMoment, zonedToUtc } from "./lib/time";
import {
  assessAttempts,
  assessDrawRules,
  assessQuestions,
  assessTestBatches,
  assessTestQuestions,
  assessTests,
  type Difficulty,
  type QuestionType,
  type ShowAnswers,
  type TestKind,
} from "./schema";

/* ───────────────────────────── The list ───────────────────────────── */

export type TestListFilter = { kind?: string; courseId?: string; q?: string; status?: string };

export async function listTests(actor: Actor, f: TestListFilter = {}) {
  const r = reach(actor, "assess.view_results", uni(actor));
  if (!hasReach(r)) throw new ForbiddenError("Tests open to staff who teach a batch.");
  return withTenant(actor, async (tx) => {
    const conds: (SQL | undefined)[] = [await testsInReach(tx, r)];
    if (f.kind && TEST_KINDS.includes(f.kind as TestKind)) conds.push(eq(assessTests.kind, f.kind as TestKind));
    if (f.courseId) conds.push(eq(assessTests.courseId, f.courseId));
    if (f.status === "draft" || f.status === "published") conds.push(eq(assessTests.status, f.status));
    if (f.q?.trim()) conds.push(ilike(assessTests.title, `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
    const rows = await tx
      .select({
        test: assessTests,
        courseTitle: courses.title,
        picked: sql<number>`(select count(*)::int from ${assessTestQuestions} tq join ${assessQuestions} q on q.id = tq.question_id where tq.test_id = ${assessTests.id} and q.archived_at is null)`,
        drawn: sql<number>`(select coalesce(sum(dr.count), 0)::int from ${assessDrawRules} dr where dr.test_id = ${assessTests.id})`,
        attempts: sql<number>`(select count(*)::int from ${assessAttempts} a where a.test_id = ${assessTests.id} and a.status <> 'in_progress')`,
        children: sql<number>`(select count(*)::int from ${assessTests} c where c.series_id = ${assessTests.id})`,
      })
      .from(assessTests)
      .innerJoin(courses, eq(courses.id, assessTests.courseId))
      .where(and(...conds))
      .orderBy(desc(assessTests.createdAt));
    const testIds = rows.map((r) => r.test.id);
    const targeted = testIds.length
      ? await tx
          .select({ testId: assessTestBatches.testId, name: batches.name })
          .from(assessTestBatches)
          .innerJoin(batches, eq(batches.id, assessTestBatches.batchId))
          .where(inArray(assessTestBatches.testId, testIds))
          .orderBy(batches.name)
      : [];
    const seriesIds = [...new Set(rows.map((r) => r.test.seriesId).filter(Boolean))] as string[];
    const seriesTitles = seriesIds.length
      ? new Map((await tx.select({ id: assessTests.id, title: assessTests.title }).from(assessTests).where(inArray(assessTests.id, seriesIds))).map((s) => [s.id, s.title]))
      : new Map<string, string>();
    const { timezone } = await universityLite(tx);
    return rows.map((r) => ({
      ...r.test,
      courseTitle: r.courseTitle,
      questionCount: r.picked + r.drawn,
      attemptCount: r.attempts,
      childCount: r.children,
      batchNames: targeted.filter((t) => t.testId === r.test.id).map((t) => t.name),
      seriesTitle: r.test.seriesId ? (seriesTitles.get(r.test.seriesId) ?? null) : null,
      window: describeWindow(r.test, timezone),
    }));
  });
}

export function describeWindow(t: Pick<TestRow, "opensAt" | "closesAt">, timezone: string, now = new Date()) {
  if (!t.opensAt && !t.closesAt) return "Always open";
  if (t.closesAt && t.closesAt <= now) return `Closed ${formatMoment(t.closesAt, timezone, now)}`;
  if (t.opensAt && t.opensAt > now) return `Opens ${formatMoment(t.opensAt, timezone, now)}`;
  return t.closesAt ? `Open until ${formatMoment(t.closesAt, timezone, now)}` : "Open";
}

/** Courses (and their batches) where the actor may create a test. */
export async function testCourseChoices(actor: Actor) {
  return withTenant(actor, (tx) => courseChoices(tx, actor));
}

/* ───────────────────────────── Create and settings ───────────────────────────── */

export type TestTargets = { allBatches: boolean; batchIds: string[] };

async function checkTargets(tx: Tx, actor: Actor, courseId: string, t: TestTargets) {
  const course = await getCourseLite(tx, courseId);
  const batchIds = t.allBatches ? [] : [...new Set(t.batchIds)];
  if (!t.allBatches && batchIds.length === 0) throw new ValidationError("Pick at least one batch, or make the test for the whole course.");
  for (const b of batchIds) {
    const lite = await batchLite(tx, b);
    if (lite.courseId !== courseId) throw new ValidationError("A batch you picked isn't part of this course.");
  }
  if (!canManageTargets(actor, { departmentId: course.departmentId, allBatches: t.allBatches, batchIds })) {
    throw new ForbiddenError(t.allBatches ? "Only the HOD or an admin can set a test for the whole course. Pick your own batches instead." : "You can only set tests for batches you teach.");
  }
  return { course, batchIds };
}

const DEFAULTS: Record<TestKind, Partial<typeof assessTests.$inferInsert>> = {
  quiz: { attemptLimit: 3, showAnswers: "after_submit", passPercent: 40 },
  mock_test: {
    timeLimitMinutes: 60,
    attemptLimit: 1,
    shuffleQuestions: true,
    shuffleOptions: true,
    onePerPage: true,
    fullscreenRequired: true,
    tabSwitchLimit: 3,
    showAnswers: "after_submit",
    passPercent: 40,
  },
  series: { showAnswers: "after_submit", passPercent: 40 },
};

export async function createTest(actor: Actor, input: { kind: string; title: string; courseId: string } & TestTargets) {
  const kind = input.kind as TestKind;
  if (!TEST_KINDS.includes(kind)) throw new ValidationError("Pick a type: quiz, mock test or test series.");
  const title = input.title.trim();
  if (title.length < 3) throw new ValidationError("Give the test a title of at least 3 characters.");
  if (title.length > 160) throw new ValidationError("Keep the title under 160 characters.");
  if (!input.courseId) throw new ValidationError("Pick the course this test belongs to.");
  return withTenant(actor, async (tx) => {
    const { course, batchIds } = await checkTargets(tx, actor, input.courseId, input);
    if (course.status === "archived") throw new ValidationError("This course is archived. Pick another course.");
    const [t] = await tx
      .insert(assessTests)
      .values({
        universityId: uni(actor),
        courseId: course.id,
        departmentId: course.departmentId,
        kind,
        title,
        allBatches: input.allBatches,
        ...DEFAULTS[kind],
        createdBy: actor.userId || null,
      })
      .returning();
    if (batchIds.length) await tx.insert(assessTestBatches).values(batchIds.map((batchId) => ({ universityId: uni(actor), testId: t.id, batchId })));
    await audit(tx, actor, "assess.test.create", "assess_test", t.id, { kind, courseId: course.id, allBatches: input.allBatches, batchIds });
    return t;
  });
}

/** Everything the test page needs about the test itself (tabs load their own data). */
export async function getTest(actor: Actor, testId: string) {
  return withTenant(actor, async (tx) => {
    const { test, batchIds, canManage } = await testFor(tx, actor, testId);
    const course = await getCourseLite(tx, test.courseId);
    const courseBatches = await tx
      .select({ id: batches.id, name: batches.name, status: batches.status })
      .from(batches)
      .where(eq(batches.courseId, test.courseId))
      .orderBy(asc(batches.startDate), asc(batches.name));
    const series = test.seriesId ? (await tx.select({ id: assessTests.id, title: assessTests.title }).from(assessTests).where(eq(assessTests.id, test.seriesId)))[0] ?? null : null;
    const [{ attempts }] = await tx.select({ attempts: sql<number>`count(*)::int` }).from(assessAttempts).where(eq(assessAttempts.testId, testId));
    const university = await universityLite(tx);
    return { test, course, batchIds, courseBatches, series, attemptCount: attempts, canManage, timezone: university.timezone };
  });
}

export async function updateSettings(
  actor: Actor,
  testId: string,
  input: { title: string; kind: string; instructions: string; passPercent: number; showAnswers: string } & TestTargets,
) {
  const title = input.title.trim();
  if (title.length < 3) throw new ValidationError("Give the test a title of at least 3 characters.");
  if (title.length > 160) throw new ValidationError("Keep the title under 160 characters.");
  if (input.instructions.length > 4000) throw new ValidationError("Keep the instructions under 4000 characters.");
  if (!Number.isInteger(input.passPercent) || input.passPercent < 0 || input.passPercent > 100) throw new ValidationError("Pass mark must be a whole number from 0 to 100.");
  const showAnswers = input.showAnswers as ShowAnswers;
  if (!SHOW_ANSWERS.includes(showAnswers)) throw new ValidationError("Pick when answers are shown.");
  return withTenant(actor, async (tx) => {
    const { test } = await testForManager(tx, actor, testId);
    const kind = input.kind as TestKind;
    if (!TEST_KINDS.includes(kind)) throw new ValidationError("Pick a type: quiz, mock test or test series.");
    if ((kind === "series") !== (test.kind === "series")) throw new ValidationError("A test can't become a test series, or the other way round. Create a new one instead.");
    if (showAnswers === "after_close" && !test.closesAt) throw new ValidationError("Set a close time under Proctoring first, or pick another option for when answers are shown.");
    const { batchIds } = await checkTargets(tx, actor, test.courseId, input);
    await tx
      .update(assessTests)
      .set({ title, kind, instructions: input.instructions.trim(), passPercent: input.passPercent, showAnswers, allBatches: input.allBatches, updatedAt: new Date() })
      .where(eq(assessTests.id, testId));
    await tx.delete(assessTestBatches).where(eq(assessTestBatches.testId, testId));
    if (batchIds.length) await tx.insert(assessTestBatches).values(batchIds.map((batchId) => ({ universityId: uni(actor), testId, batchId })));
    await audit(tx, actor, "assess.test.settings", "assess_test", testId, { kind, allBatches: input.allBatches, batchIds, passPercent: input.passPercent, showAnswers });
  });
}

export type ProctoringInput = {
  timeLimitMinutes: number | null;
  fullscreenRequired: boolean;
  tabSwitchLimit: number | null;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  onePerPage: boolean;
  attemptLimit: number;
  /** Local date and time in the university's time zone, "2026-11-03T10:00", or "" for none. */
  opensAt: string;
  closesAt: string;
};

export async function updateProctoring(actor: Actor, testId: string, input: ProctoringInput) {
  const intIn = (v: number | null, lo: number, hi: number, msg: string) => {
    if (v === null) return null;
    if (!Number.isInteger(v) || v < lo || v > hi) throw new ValidationError(msg);
    return v;
  };
  const timeLimit = intIn(input.timeLimitMinutes, 1, 1440, "Time limit must be a whole number of minutes from 1 to 1440, or empty for none.");
  const tabLimit = intIn(input.tabSwitchLimit, 0, 50, "Tab-switch limit must be a whole number from 0 to 50, or empty for no limit.");
  const attemptLimit = intIn(input.attemptLimit, 1, 50, "Attempts allowed must be a whole number from 1 to 50.")!;
  return withTenant(actor, async (tx) => {
    const { test } = await testForManager(tx, actor, testId);
    if (test.kind === "series") throw new ValidationError("A test series has no proctoring of its own. Set it on each test in the series.");
    const { timezone } = await universityLite(tx);
    const parse = (v: string, what: string) => {
      if (!v.trim()) return null;
      const d = zonedToUtc(v, timezone);
      if (!d) throw new ValidationError(`${what} must be a date and time, like 2026-11-03 10:00.`);
      return d;
    };
    const opensAt = parse(input.opensAt, "Opens at");
    const closesAt = parse(input.closesAt, "Closes at");
    if (opensAt && closesAt && closesAt <= opensAt) throw new ValidationError("The close time must be after the open time.");
    if (!closesAt && test.showAnswers === "after_close") throw new ValidationError("Answers are set to show after the test closes, so it needs a close time. Change that under Settings first, or set a close time.");
    if (closesAt && opensAt && timeLimit && closesAt.getTime() - opensAt.getTime() < timeLimit * 60_000) {
      throw new ValidationError("The window is shorter than the time limit. Students who start on time couldn't use all their time.");
    }
    await tx
      .update(assessTests)
      .set({
        timeLimitMinutes: timeLimit,
        fullscreenRequired: input.fullscreenRequired,
        tabSwitchLimit: tabLimit,
        shuffleQuestions: input.shuffleQuestions,
        shuffleOptions: input.shuffleOptions,
        onePerPage: input.onePerPage,
        attemptLimit,
        opensAt,
        closesAt,
        updatedAt: new Date(),
      })
      .where(eq(assessTests.id, testId));
    await audit(tx, actor, "assess.test.proctoring", "assess_test", testId, {
      timeLimit,
      tabLimit,
      attemptLimit,
      fullscreen: input.fullscreenRequired,
      opensAt: opensAt?.toISOString() ?? null,
      closesAt: closesAt?.toISOString() ?? null,
    });
  });
}

/* ───────────────────────────── Questions and draw rules ───────────────────────────── */

export async function testQuestions(actor: Actor, testId: string) {
  return withTenant(actor, async (tx) => {
    const { test, canManage } = await testFor(tx, actor, testId);
    const picked = await tx
      .select({ q: assessQuestions, position: assessTestQuestions.position })
      .from(assessTestQuestions)
      .innerJoin(assessQuestions, eq(assessQuestions.id, assessTestQuestions.questionId))
      .where(and(eq(assessTestQuestions.testId, testId), isNull(assessQuestions.archivedAt)))
      .orderBy(asc(assessTestQuestions.position));
    const rules = await tx.select().from(assessDrawRules).where(eq(assessDrawRules.testId, testId)).orderBy(asc(assessDrawRules.position), asc(assessDrawRules.id));
    const available = await Promise.all(rules.map((r) => countMatching(tx, r, [])));
    const pickedMarks = picked.reduce((s, p) => s + p.q.marks, 0);
    const avg = await Promise.all(rules.map((r) => avgMarks(tx, r)));
    const ruleMarks = rules.reduce((s, r, i) => s + r.count * avg[i], 0);
    return {
      test,
      canManage,
      picked: picked.map((p) => p.q),
      rules: rules.map((r, i) => ({ ...r, available: available[i] })),
      questionCount: picked.length + rules.reduce((s, r) => s + r.count, 0),
      totalMarks: Math.round((pickedMarks + ruleMarks) * 100) / 100,
      marksAreExact: rules.length === 0 || avg.every((a, i) => rules[i].count === 0 || a === avg[0]),
    };
  });
}

type RuleLike = { poolDepartmentId: string | null; difficulty: Difficulty | null; type: QuestionType | null; tag: string | null };

export function ruleCondition(r: RuleLike, exclude: string[]): SQL {
  return and(
    isNull(assessQuestions.archivedAt),
    r.poolDepartmentId ? eq(assessQuestions.departmentId, r.poolDepartmentId) : isNull(assessQuestions.departmentId),
    r.difficulty ? eq(assessQuestions.difficulty, r.difficulty) : undefined,
    r.type ? eq(assessQuestions.type, r.type) : undefined,
    r.tag ? sql`exists (select 1 from unnest(${assessQuestions.tags}) t where lower(t) = lower(${r.tag}))` : undefined,
    exclude.length ? sql`${assessQuestions.id} not in (${sql.join(exclude.map((id) => sql`${id}::uuid`), sql`, `)})` : undefined,
  )!;
}

async function countMatching(tx: Tx, r: RuleLike, exclude: string[]) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(assessQuestions).where(ruleCondition(r, exclude));
  return n;
}

async function avgMarks(tx: Tx, r: RuleLike) {
  const [{ a }] = await tx.select({ a: sql<number>`coalesce(avg(${assessQuestions.marks}), 0)::float` }).from(assessQuestions).where(ruleCondition(r, []));
  return a;
}

export function describeRule(r: RuleLike & { count: number }, poolName: string) {
  const bits = [r.difficulty, r.type ? r.type.replace("_", " ") : null].filter(Boolean).join(" ");
  return `${r.count} random ${bits ? `${bits} ` : ""}question${r.count === 1 ? "" : "s"}${r.tag ? ` tagged ${r.tag}` : ""} from the ${poolName}`;
}

async function assertQuestionsEditable(tx: Tx, test: TestRow) {
  if (test.kind === "series") throw new ValidationError("A test series has no questions of its own. Add tests to it instead.");
  void tx;
}

export async function addQuestionsToTest(actor: Actor, testId: string, questionIds: string[]) {
  const ids = [...new Set(questionIds)].filter(Boolean);
  if (ids.length === 0) throw new ValidationError("Tick at least one question to add.");
  if (ids.length > 200) throw new ValidationError("Add at most 200 questions at a time.");
  return withTenant(actor, async (tx) => {
    const { test } = await testForManager(tx, actor, testId);
    await assertQuestionsEditable(tx, test);
    const qs = await tx.select().from(assessQuestions).where(and(inArray(assessQuestions.id, ids), isNull(assessQuestions.archivedAt)));
    if (qs.length !== ids.length) throw new NotFoundError("Question");
    for (const pool of new Set(qs.map((q) => q.departmentId))) await assertPoolAccess(tx, actor, pool);
    const existing = new Set((await tx.select({ id: assessTestQuestions.questionId }).from(assessTestQuestions).where(eq(assessTestQuestions.testId, testId))).map((r) => r.id));
    const [{ last }] = await tx.select({ last: max(assessTestQuestions.position) }).from(assessTestQuestions).where(eq(assessTestQuestions.testId, testId));
    const fresh = ids.filter((id) => !existing.has(id));
    if (fresh.length) {
      await tx.insert(assessTestQuestions).values(fresh.map((questionId, i) => ({ universityId: uni(actor), testId, questionId, position: (last ?? -1) + 1 + i })));
    }
    await audit(tx, actor, "assess.test.add_questions", "assess_test", testId, { added: fresh.length });
    return { added: fresh.length, skipped: ids.length - fresh.length };
  });
}

export async function removeQuestionFromTest(actor: Actor, testId: string, questionId: string) {
  return withTenant(actor, async (tx) => {
    await testForManager(tx, actor, testId);
    const gone = await tx.delete(assessTestQuestions).where(and(eq(assessTestQuestions.testId, testId), eq(assessTestQuestions.questionId, questionId))).returning();
    if (gone.length === 0) throw new NotFoundError("Question");
    await audit(tx, actor, "assess.test.remove_question", "assess_test", testId, { questionId });
  });
}

/** Moves a picked question one place up or down. */
export async function moveQuestionInTest(actor: Actor, testId: string, questionId: string, direction: "up" | "down") {
  return withTenant(actor, async (tx) => {
    await testForManager(tx, actor, testId);
    const rows = await tx.select().from(assessTestQuestions).where(eq(assessTestQuestions.testId, testId)).orderBy(asc(assessTestQuestions.position));
    const i = rows.findIndex((r) => r.questionId === questionId);
    if (i < 0) throw new NotFoundError("Question");
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    for (let k = 0; k < rows.length; k++) {
      await tx.update(assessTestQuestions).set({ position: k }).where(and(eq(assessTestQuestions.testId, testId), eq(assessTestQuestions.questionId, rows[k].questionId)));
    }
    await audit(tx, actor, "assess.test.reorder", "assess_test", testId, { questionId, direction });
  });
}

export async function addDrawRule(actor: Actor, testId: string, input: { count: number; pool: string; difficulty?: string; type?: string; tag?: string }) {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 200) throw new ValidationError("Draw between 1 and 200 questions.");
  const difficulty = (input.difficulty || null) as Difficulty | null;
  const type = (input.type || null) as QuestionType | null;
  if (difficulty && !["easy", "medium", "hard"].includes(difficulty)) throw new ValidationError("Difficulty must be easy, medium or hard.");
  if (type && !["single", "multiple", "true_false", "numeric", "short"].includes(type)) throw new ValidationError("Pick a question type, or any type.");
  const tag = input.tag?.trim() || null;
  const poolDepartmentId = poolKeyToDepartment(input.pool);
  return withTenant(actor, async (tx) => {
    const { test } = await testForManager(tx, actor, testId);
    await assertQuestionsEditable(tx, test);
    await assertPoolAccess(tx, actor, poolDepartmentId);
    const rule = { poolDepartmentId, difficulty, type, tag };
    const available = await countMatching(tx, rule, []);
    if (available < input.count) {
      throw new ValidationError(
        `The pool has only ${plural(available, "question")} that match${available === 1 ? "es" : ""}. Lower the number, loosen the rule, or add questions to the pool.`,
      );
    }
    const [{ last }] = await tx.select({ last: max(assessDrawRules.position) }).from(assessDrawRules).where(eq(assessDrawRules.testId, testId));
    const [r] = await tx
      .insert(assessDrawRules)
      .values({ universityId: uni(actor), testId, count: input.count, poolDepartmentId, difficulty, type, tag, position: (last ?? -1) + 1 })
      .returning();
    await audit(tx, actor, "assess.test.add_draw_rule", "assess_test", testId, { ruleId: r.id, count: r.count, difficulty, type, tag, poolDepartmentId });
    return r;
  });
}

export async function removeDrawRule(actor: Actor, testId: string, ruleId: string) {
  return withTenant(actor, async (tx) => {
    await testForManager(tx, actor, testId);
    const gone = await tx.delete(assessDrawRules).where(and(eq(assessDrawRules.id, ruleId), eq(assessDrawRules.testId, testId))).returning();
    if (gone.length === 0) throw new NotFoundError("Draw rule");
    await audit(tx, actor, "assess.test.remove_draw_rule", "assess_test", testId, { ruleId });
  });
}

/* ───────────────────────────── Publishing ───────────────────────────── */

/** Why a test can't be published yet (empty = ready). */
export async function publishProblems(tx: Tx, test: TestRow, now = new Date()): Promise<string[]> {
  const problems: string[] = [];
  if (test.closesAt && test.closesAt <= now) problems.push("The close time has passed. Move it later under Proctoring.");
  if (test.kind === "series") {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(assessTests).where(eq(assessTests.seriesId, test.id));
    if (n === 0) problems.push("Add at least one test to the series.");
    return problems;
  }
  const picked = await tx
    .select({ id: assessTestQuestions.questionId })
    .from(assessTestQuestions)
    .innerJoin(assessQuestions, eq(assessQuestions.id, assessTestQuestions.questionId))
    .where(and(eq(assessTestQuestions.testId, test.id), isNull(assessQuestions.archivedAt)));
  const rules = await tx.select().from(assessDrawRules).where(eq(assessDrawRules.testId, test.id)).orderBy(asc(assessDrawRules.position));
  if (picked.length === 0 && rules.length === 0) problems.push("Add questions from the pool, or a draw rule.");
  const used = picked.map((p) => p.id);
  for (const r of rules) {
    const n = await countMatching(tx, r, used);
    if (n < r.count) problems.push(`A draw rule asks for ${r.count} questions but only ${n} are left in the pool after the others are taken. Lower it or add questions.`);
    // Reserve the lowest-id matches so later rules are checked against what's left.
    const take = await tx.select({ id: assessQuestions.id }).from(assessQuestions).where(ruleCondition(r, used)).orderBy(asc(assessQuestions.id)).limit(r.count);
    used.push(...take.map((t) => t.id));
  }
  return problems;
}

export async function setPublished(actor: Actor, testId: string, publish: boolean) {
  return withTenant(actor, async (tx) => {
    const { test } = await testForManager(tx, actor, testId);
    const locked = await loadTest(tx, testId, { lock: true });
    if (publish) {
      if (locked.status === "published") return { status: "published" as const };
      const problems = await publishProblems(tx, locked);
      if (problems.length) throw new ValidationError(problems.join(" "));
      await tx.update(assessTests).set({ status: "published", publishedAt: new Date(), updatedAt: new Date() }).where(eq(assessTests.id, testId));
      await audit(tx, actor, "assess.test.publish", "assess_test", testId);
      await announce(tx, actor, locked);
      return { status: "published" as const };
    }
    if (locked.status === "draft") return { status: "draft" as const };
    const testIds = test.kind === "series" ? [testId, ...(await tx.select({ id: assessTests.id }).from(assessTests).where(eq(assessTests.seriesId, testId))).map((r) => r.id)] : [testId];
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(assessAttempts).where(inArray(assessAttempts.testId, testIds));
    if (n > 0) throw new ConflictError("Students have already taken this. Close its window under Proctoring instead, so their results stay.");
    await tx.update(assessTests).set({ status: "draft", updatedAt: new Date() }).where(eq(assessTests.id, testId));
    await audit(tx, actor, "assess.test.unpublish", "assess_test", testId);
    return { status: "draft" as const };
  });
}

/** Tells the students of the test's batches that it's there. */
async function announce(tx: Tx, actor: Actor, test: TestRow) {
  if (test.seriesId) {
    const [series] = await tx.select().from(assessTests).where(eq(assessTests.id, test.seriesId));
    if (!series || series.status !== "published") return; // they'll hear when the series is published
  }
  const batchIds = await testBatchIds(tx, test);
  const students = (await Promise.all(batchIds.map((b) => batchStudentIds(tx, b)))).flat();
  if (students.length === 0) return;
  const { timezone } = await universityLite(tx);
  const when = test.opensAt && test.opensAt > new Date() ? `Opens ${formatMoment(test.opensAt, timezone)}.` : test.closesAt ? `Open until ${formatMoment(test.closesAt, timezone)}.` : "Open now.";
  await notify(tx, uni(actor), students, {
    kind: "assess.test.published",
    title: `New ${KIND_LABEL[test.kind].toLowerCase()}: ${test.title}`,
    body: when,
    data: { testId: test.id, courseId: test.courseId },
  });
}

/** Deletes a test that no student has started. Tests in a series leave the series. */
export async function deleteTest(actor: Actor, testId: string) {
  return withTenant(actor, async (tx) => {
    const { test } = await testForManager(tx, actor, testId);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(assessAttempts).where(eq(assessAttempts.testId, testId));
    if (n > 0) throw new ConflictError("Students have already taken this test, so it can't be deleted. Close its window instead.");
    await tx.delete(assessTests).where(eq(assessTests.id, testId));
    await audit(tx, actor, "assess.test.delete", "assess_test", testId, { title: test.title, kind: test.kind });
  });
}

/* ───────────────────────────── Test series ───────────────────────────── */

export async function seriesTests(actor: Actor, seriesId: string) {
  return withTenant(actor, async (tx) => {
    const { test, canManage } = await testFor(tx, actor, seriesId);
    if (test.kind !== "series") throw new NotFoundError("Test series");
    const children = await tx
      .select({
        test: assessTests,
        attempts: sql<number>`(select count(*)::int from ${assessAttempts} a where a.test_id = ${assessTests.id} and a.status <> 'in_progress')`,
      })
      .from(assessTests)
      .where(eq(assessTests.seriesId, seriesId))
      .orderBy(asc(assessTests.seriesPosition), asc(assessTests.createdAt));
    // Tests that could join: same course, not a series, not in another series, and the actor manages them.
    const candidates = canManage
      ? await tx
          .select()
          .from(assessTests)
          .where(and(eq(assessTests.courseId, test.courseId), ne(assessTests.kind, "series"), isNull(assessTests.seriesId)))
          .orderBy(asc(assessTests.title))
      : [];
    const manageable = [];
    for (const c of candidates) {
      const ids = await testBatchIds(tx, c);
      if (canManageTargets(actor, { departmentId: c.departmentId, allBatches: c.allBatches, batchIds: ids })) manageable.push(c);
    }
    const { timezone } = await universityLite(tx);
    return { series: test, canManage, children: children.map((c) => ({ ...c.test, attemptCount: c.attempts, window: describeWindow(c.test, timezone) })), candidates: manageable };
  });
}

export async function addToSeries(actor: Actor, seriesId: string, testId: string) {
  return withTenant(actor, async (tx) => {
    const { test: series } = await testForManager(tx, actor, seriesId);
    if (series.kind !== "series") throw new ValidationError("Tests can only be added to a test series.");
    const { test } = await testForManager(tx, actor, testId);
    if (test.kind === "series") throw new ValidationError("A test series can't contain another series.");
    if (test.courseId !== series.courseId) throw new ValidationError("Only tests of the same course can be in a series.");
    if (test.seriesId) throw new ConflictError(test.seriesId === seriesId ? "This test is already in the series." : "This test is already in another series. Remove it from there first.");
    const [{ last }] = await tx.select({ last: max(assessTests.seriesPosition) }).from(assessTests).where(eq(assessTests.seriesId, seriesId));
    await tx.update(assessTests).set({ seriesId, seriesPosition: (last ?? -1) + 1, updatedAt: new Date() }).where(eq(assessTests.id, testId));
    await audit(tx, actor, "assess.series.add", "assess_test", seriesId, { testId });
    if (series.status === "published" && test.status === "published") await announce(tx, actor, { ...test, seriesId });
  });
}

export async function removeFromSeries(actor: Actor, seriesId: string, testId: string) {
  return withTenant(actor, async (tx) => {
    await testForManager(tx, actor, seriesId);
    const updated = await tx
      .update(assessTests)
      .set({ seriesId: null, seriesPosition: 0, updatedAt: new Date() })
      .where(and(eq(assessTests.id, testId), eq(assessTests.seriesId, seriesId)))
      .returning();
    if (updated.length === 0) throw new NotFoundError("Test");
    await audit(tx, actor, "assess.series.remove", "assess_test", seriesId, { testId });
  });
}

export async function moveInSeries(actor: Actor, seriesId: string, testId: string, direction: "up" | "down") {
  return withTenant(actor, async (tx) => {
    await testForManager(tx, actor, seriesId);
    const rows = await tx.select({ id: assessTests.id }).from(assessTests).where(eq(assessTests.seriesId, seriesId)).orderBy(asc(assessTests.seriesPosition), asc(assessTests.createdAt));
    const i = rows.findIndex((r) => r.id === testId);
    if (i < 0) throw new NotFoundError("Test");
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    for (let k = 0; k < rows.length; k++) await tx.update(assessTests).set({ seriesPosition: k }).where(eq(assessTests.id, rows[k].id));
    await audit(tx, actor, "assess.series.reorder", "assess_test", seriesId, { testId, direction });
  });
}

/** Tests for one course (the course page's Tests tab). */
export async function courseTests(actor: Actor, courseId: string) {
  return listTests(actor, { courseId });
}
