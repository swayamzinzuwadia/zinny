/**
 * Taking a test (brief item 6) and marking it (item 7).
 *
 * Integrity rules, all enforced here on the server:
 *   - The paper sent to the browser never carries answers or explanations (PaperView).
 *   - The attempt's end time is set by the server when it starts. Answers that arrive after
 *     it (plus ANSWER_GRACE_MS for the network) are refused, and the attempt is submitted.
 *   - The attempt limit holds even with two tabs: attempt numbers are unique per student
 *     and test, and only one attempt can be in progress at a time.
 *   - A student only ever reaches tests for batches they are actively enrolled in.
 */
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { assertCan, audit, emit, notify, peopleLite, reach, studentEnrolments, systemActorFor, withTenant, type Actor } from "@/server/core";
import { ConflictError, NotFoundError, ValidationError } from "@/server/errors";
import { attemptsInReach, canOnAttempt, hasReach, loadTest, testBatchIds, uni, type TestRow } from "./access";
import { cleanResponse, correctOptionIds, markItem, percentOf, roundMarks } from "./lib/marking";
import { shuffled } from "./lib/random";
import { ruleCondition } from "./manage";
import {
  assessAttemptItems,
  assessAttempts,
  assessDrawRules,
  assessProctorEvents,
  assessQuestions,
  assessTestQuestions,
  assessTests,
  type ProctorKind,
  type QuestionAnswer,
  type QuestionOption,
  type QuestionResponse,
  type QuestionType,
  type SubmitReason,
} from "./schema";

/** Answers sent just before the end can arrive a moment after it; this much network delay is allowed. */
export const ANSWER_GRACE_MS = 2_000;

export type AttemptRow = typeof assessAttempts.$inferSelect;
export type ItemRow = typeof assessAttemptItems.$inferSelect;

const own = (actor: Actor) => ({ universityId: uni(actor), ownerUserId: actor.userId });

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/* ───────────────────────────── Which tests a student may take ───────────────────────────── */

/**
 * The batch through which the student may take this test: an active enrolment in a batch the
 * test is for. Null when there is none. Tests in a series also need the series published.
 */
export async function studentBatchFor(tx: Tx, userId: string, test: TestRow): Promise<string | null> {
  if (test.status !== "published") return null;
  if (test.seriesId) {
    const [series] = await tx.select({ status: assessTests.status }).from(assessTests).where(eq(assessTests.id, test.seriesId));
    if (!series || series.status !== "published") return null;
  }
  const mine = (await studentEnrolments(tx, userId)).filter((e) => e.status === "active" && e.courseId === test.courseId);
  if (mine.length === 0) return null;
  const allowed = new Set(await testBatchIds(tx, test));
  return mine.find((e) => allowed.has(e.batchId))?.batchId ?? null;
}

export type WindowState = "upcoming" | "open" | "closed";

export function windowState(t: Pick<TestRow, "opensAt" | "closesAt">, now = new Date()): WindowState {
  if (t.opensAt && t.opensAt > now) return "upcoming";
  if (t.closesAt && t.closesAt <= now) return "closed";
  return "open";
}

/* ───────────────────────────── Starting ───────────────────────────── */

async function buildPaper(tx: Tx, test: TestRow) {
  const picked = await tx
    .select({ q: assessQuestions })
    .from(assessTestQuestions)
    .innerJoin(assessQuestions, eq(assessQuestions.id, assessTestQuestions.questionId))
    .where(and(eq(assessTestQuestions.testId, test.id), isNull(assessQuestions.archivedAt)))
    .orderBy(asc(assessTestQuestions.position));
  const questions = picked.map((p) => p.q);
  const used = questions.map((q) => q.id);
  const rules = await tx.select().from(assessDrawRules).where(eq(assessDrawRules.testId, test.id)).orderBy(asc(assessDrawRules.position), asc(assessDrawRules.id));
  for (const r of rules) {
    const drawn = await tx.select().from(assessQuestions).where(ruleCondition(r, used)).orderBy(sql`random()`).limit(r.count);
    if (drawn.length < r.count) {
      throw new ConflictError("This test can't be put together right now: the question pool has fewer questions than it needs. Tell your teacher.", "pool_short");
    }
    questions.push(...drawn);
    used.push(...drawn.map((d) => d.id));
  }
  if (questions.length === 0) throw new ConflictError("This test has no questions yet. Tell your teacher.", "no_questions");
  const ordered = test.shuffleQuestions ? shuffled(questions) : questions;
  return ordered.map((q, i) => ({
    questionId: q.id,
    position: i,
    type: q.type,
    prompt: q.prompt,
    options: test.shuffleOptions && q.type !== "true_false" ? shuffled(q.options) : q.options,
    answer: q.answer,
    explanation: q.explanation,
    marks: q.marks,
    negativeMarks: q.negativeMarks,
  }));
}

/**
 * Starts an attempt, or returns the one already in progress (a reload or a second tab).
 * Returns the attempt id.
 */
export async function startAttempt(actor: Actor, testId: string): Promise<{ attemptId: string; resumed: boolean }> {
  assertCan(actor, "self.take_test", own(actor));
  const run = () =>
    withTenant(actor, async (tx) => {
      const test = await loadTest(tx, testId).catch(() => null);
      if (!test || test.kind === "series") throw new NotFoundError("Test");
      const batchId = await studentBatchFor(tx, actor.userId, test);
      if (!batchId) throw new NotFoundError("Test");

      const now = new Date();
      const open = await tx
        .select()
        .from(assessAttempts)
        .where(and(eq(assessAttempts.testId, testId), eq(assessAttempts.userId, actor.userId), eq(assessAttempts.status, "in_progress")))
        .for("update");
      if (open[0]) {
        if (!isExpired(open[0], now)) return { attemptId: open[0].id, resumed: true };
        await finalize(tx, systemActorFor(uni(actor)), open[0], "time_up");
      }

      const state = windowState(test, now);
      if (state === "upcoming") throw new ConflictError("This test hasn't opened yet.", "not_open");
      if (state === "closed") throw new ConflictError("This test has closed.", "closed");
      const [{ used }] = await tx
        .select({ used: sql<number>`count(*)::int` })
        .from(assessAttempts)
        .where(and(eq(assessAttempts.testId, testId), eq(assessAttempts.userId, actor.userId)));
      if (used >= test.attemptLimit) {
        throw new ConflictError(test.attemptLimit === 1 ? "You've already taken this test." : `You've used all ${test.attemptLimit} attempts.`, "attempt_limit");
      }

      const paper = await buildPaper(tx, test);
      const limitEnd = test.timeLimitMinutes ? new Date(now.getTime() + test.timeLimitMinutes * 60_000) : null;
      const endsAt = limitEnd && test.closesAt ? (limitEnd < test.closesAt ? limitEnd : test.closesAt) : (limitEnd ?? test.closesAt);
      const [attempt] = await tx
        .insert(assessAttempts)
        .values({
          universityId: uni(actor),
          testId,
          userId: actor.userId,
          courseId: test.courseId,
          batchId,
          attemptNo: used + 1,
          startedAt: now,
          endsAt,
          maxScore: roundMarks(paper.reduce((s, p) => s + p.marks, 0)),
        })
        .returning();
      await tx.insert(assessAttemptItems).values(paper.map((p) => ({ universityId: uni(actor), attemptId: attempt.id, ...p })));
      await audit(tx, actor, "assess.attempt.start", "assess_attempt", attempt.id, { testId, attemptNo: attempt.attemptNo, endsAt: endsAt?.toISOString() ?? null });
      return { attemptId: attempt.id, resumed: false };
    });
  try {
    return await run();
  } catch (e) {
    // Two tabs started at the same moment: one insert won. Run again to resume that attempt
    // (or to report that the limit is reached).
    if (isUniqueViolation(e)) return run();
    throw e;
  }
}

function isExpired(a: Pick<AttemptRow, "endsAt">, now = new Date(), graceMs = 0): boolean {
  return a.endsAt !== null && now.getTime() > a.endsAt.getTime() + graceMs;
}

/* ───────────────────────────── The paper (what the browser gets) ───────────────────────────── */

/** One question as the student sees it while taking the test. No answer, no explanation. */
export type PaperItem = {
  id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  marks: number;
  negativeMarks: number;
  response: QuestionResponse | null;
};

export type PaperView = {
  attemptId: string;
  testId: string;
  title: string;
  kind: TestRow["kind"];
  attemptNo: number;
  attemptLimit: number;
  /** ISO time the server ends the attempt; null = untimed. */
  endsAt: string | null;
  /** The server's clock when the page was made, so the browser's timer ignores a wrong device clock. */
  serverNow: string;
  maxScore: number;
  fullscreenRequired: boolean;
  tabSwitchLimit: number | null;
  tabSwitches: number;
  onePerPage: boolean;
  items: PaperItem[];
};

/** Strips everything the student may not see yet. The only shape of an item that reaches the browser during a test. */
export function toPaperItem(i: ItemRow): PaperItem {
  return { id: i.id, position: i.position, type: i.type, prompt: i.prompt, options: i.options, marks: i.marks, negativeMarks: i.negativeMarks, response: i.response };
}

async function ownAttempt(tx: Tx, actor: Actor, attemptId: string, opts: { lock?: boolean } = {}) {
  const q = tx.select().from(assessAttempts).where(eq(assessAttempts.id, attemptId));
  const [a] = opts.lock ? await q.for("update") : await q;
  // Someone else's attempt looks exactly like a missing one.
  if (!a || a.userId !== actor.userId) throw new NotFoundError("Attempt");
  return a;
}

export type PaperResult = { state: "in_progress"; paper: PaperView } | { state: "submitted"; attemptId: string };

/** The attempt to show while taking the test. Submits it first if its time has run out. */
export async function paperFor(actor: Actor, attemptId: string): Promise<PaperResult> {
  assertCan(actor, "self.take_test", own(actor));
  return withTenant(actor, async (tx) => {
    let a = await ownAttempt(tx, actor, attemptId, { lock: true });
    if (a.status === "in_progress" && isExpired(a)) {
      a = await finalize(tx, systemActorFor(uni(actor)), a, "time_up");
    }
    if (a.status !== "in_progress") return { state: "submitted", attemptId: a.id };
    const test = await loadTest(tx, a.testId);
    const items = await tx.select().from(assessAttemptItems).where(eq(assessAttemptItems.attemptId, a.id)).orderBy(asc(assessAttemptItems.position));
    return {
      state: "in_progress",
      paper: {
        attemptId: a.id,
        testId: test.id,
        title: test.title,
        kind: test.kind,
        attemptNo: a.attemptNo,
        attemptLimit: test.attemptLimit,
        endsAt: a.endsAt?.toISOString() ?? null,
        serverNow: new Date().toISOString(),
        maxScore: a.maxScore,
        fullscreenRequired: test.fullscreenRequired,
        tabSwitchLimit: test.tabSwitchLimit,
        tabSwitches: a.tabSwitches,
        onePerPage: test.onePerPage,
        items: items.map(toPaperItem),
      },
    };
  });
}

/* ───────────────────────────── Autosave, proctoring, submit ───────────────────────────── */

export type SaveResult = { ok: true; savedAt: string } | { ok: false; submitted: true; message: string };

/** Saves one answer. Refused once the attempt is submitted or its time is up (then it is submitted). */
export async function saveAnswer(actor: Actor, attemptId: string, itemId: string, raw: unknown): Promise<SaveResult> {
  assertCan(actor, "self.take_test", own(actor));
  return withTenant(actor, async (tx) => {
    const a = await ownAttempt(tx, actor, attemptId, { lock: true });
    if (a.status !== "in_progress") return { ok: false, submitted: true, message: "This attempt has already been submitted. Your answer wasn't saved." };
    const now = new Date();
    if (isExpired(a, now, ANSWER_GRACE_MS)) {
      await finalize(tx, systemActorFor(uni(actor)), a, "time_up");
      return { ok: false, submitted: true, message: "Time is up, so this answer wasn't saved. Your test has been submitted." };
    }
    const [item] = await tx
      .select()
      .from(assessAttemptItems)
      .where(and(eq(assessAttemptItems.id, itemId), eq(assessAttemptItems.attemptId, a.id)));
    if (!item) throw new NotFoundError("Question");
    const response = cleanResponse(item.type, item.options, raw);
    await tx.update(assessAttemptItems).set({ response, answeredAt: response ? now : null }).where(eq(assessAttemptItems.id, item.id));
    return { ok: true, savedAt: now.toISOString() };
  });
}

export type ProctorResult = { tabSwitches: number; fullscreenExits: number; limit: number | null; submitted: boolean };

/** Records that the student left the test (switched tab or app) or left full screen. */
export async function recordProctorEvent(actor: Actor, attemptId: string, kind: ProctorKind): Promise<ProctorResult> {
  assertCan(actor, "self.take_test", own(actor));
  if (kind !== "tab_hidden" && kind !== "fullscreen_exit") throw new ValidationError("Unknown proctoring event.");
  return withTenant(actor, async (tx) => {
    const a = await ownAttempt(tx, actor, attemptId, { lock: true });
    const test = await loadTest(tx, a.testId);
    if (a.status !== "in_progress") return { tabSwitches: a.tabSwitches, fullscreenExits: a.fullscreenExits, limit: test.tabSwitchLimit, submitted: true };
    if (isExpired(a, new Date(), ANSWER_GRACE_MS)) {
      await finalize(tx, systemActorFor(uni(actor)), a, "time_up");
      return { tabSwitches: a.tabSwitches, fullscreenExits: a.fullscreenExits, limit: test.tabSwitchLimit, submitted: true };
    }
    await tx.insert(assessProctorEvents).values({ universityId: uni(actor), attemptId: a.id, kind });
    const [updated] = await tx
      .update(assessAttempts)
      .set(kind === "tab_hidden" ? { tabSwitches: sql`${assessAttempts.tabSwitches} + 1` } : { fullscreenExits: sql`${assessAttempts.fullscreenExits} + 1` })
      .where(eq(assessAttempts.id, a.id))
      .returning();
    let submitted = false;
    if (kind === "tab_hidden" && test.tabSwitchLimit !== null && updated.tabSwitches > test.tabSwitchLimit) {
      await finalize(tx, actor, updated, "tab_limit");
      submitted = true;
    }
    return { tabSwitches: updated.tabSwitches, fullscreenExits: updated.fullscreenExits, limit: test.tabSwitchLimit, submitted };
  });
}

/** The student submits. Past the end time it counts as "time ran out". Submitting twice is harmless. */
export async function submitAttempt(actor: Actor, attemptId: string) {
  assertCan(actor, "self.take_test", own(actor));
  return withTenant(actor, async (tx) => {
    const a = await ownAttempt(tx, actor, attemptId, { lock: true });
    if (a.status !== "in_progress") return { status: a.status, attemptId: a.id };
    const reason: SubmitReason = isExpired(a) ? "time_up" : "student";
    const done = await finalize(tx, reason === "time_up" ? systemActorFor(uni(actor)) : actor, a, reason);
    return { status: done.status, attemptId: done.id };
  });
}

/* ───────────────────────────── Marking ───────────────────────────── */

/**
 * Marks every item, closes the attempt, and emits test.submitted when nothing is left to
 * grade by hand. Expects the attempt row locked by the caller.
 */
export async function finalize(tx: Tx, actor: Actor, a: AttemptRow, reason: SubmitReason): Promise<AttemptRow> {
  if (a.status !== "in_progress") return a;
  const items = await tx.select().from(assessAttemptItems).where(eq(assessAttemptItems.attemptId, a.id));
  let objective = 0;
  let manual = 0;
  for (const item of items) {
    const m = markItem(item, item.response);
    if (m.needsGrading) manual++;
    else objective += m.autoScore ?? 0;
    await tx
      .update(assessAttemptItems)
      .set({ autoScore: m.autoScore, correct: m.correct, needsGrading: m.needsGrading })
      .where(eq(assessAttemptItems.id, item.id));
  }
  const now = new Date();
  const submittedAt = reason === "time_up" && a.endsAt && a.endsAt < now ? a.endsAt : now;
  const score = roundMarks(objective);
  const test = await loadTest(tx, a.testId);
  if (manual > 0) {
    const [saved] = await tx
      .update(assessAttempts)
      .set({ status: "awaiting_grading", submittedAt, submitReason: reason, score })
      .where(eq(assessAttempts.id, a.id))
      .returning();
    await audit(tx, actor, "assess.attempt.submit", "assess_attempt", a.id, { reason, waitingForGrading: manual });
    return saved;
  }
  const scorePercent = percentOf(score, a.maxScore);
  const passed = scorePercent >= test.passPercent;
  const [saved] = await tx
    .update(assessAttempts)
    .set({ status: "graded", submittedAt, submitReason: reason, score, scorePercent, passed, gradedAt: now })
    .where(eq(assessAttempts.id, a.id))
    .returning();
  await audit(tx, actor, "assess.attempt.submit", "assess_attempt", a.id, { reason, score, scorePercent, passed });
  await emitSubmitted(tx, actor, saved);
  return saved;
}

export async function emitSubmitted(tx: Tx, actor: Actor, a: AttemptRow) {
  await emit(tx, actor, "test.submitted", {
    attemptId: a.id,
    testId: a.testId,
    userId: a.userId,
    courseId: a.courseId,
    batchId: a.batchId,
    scorePercent: a.scorePercent ?? 0,
    passed: !!a.passed,
  });
}

/**
 * Submits every attempt whose end time has passed (the job runs this each minute, so a
 * student who closed the tab is still submitted on time). Returns how many it closed.
 */
export async function closeExpiredAttempts(actor: Actor, now = new Date()): Promise<number> {
  return withTenant(actor, async (tx) => {
    const cutoff = new Date(now.getTime() - ANSWER_GRACE_MS);
    const due = await tx
      .select()
      .from(assessAttempts)
      .where(and(eq(assessAttempts.status, "in_progress"), lt(assessAttempts.endsAt, cutoff)))
      .orderBy(asc(assessAttempts.endsAt))
      .limit(500)
      .for("update", { skipLocked: true });
    for (const a of due) await finalize(tx, actor, a, "time_up");
    return due.length;
  });
}

/* ───────────────────────────── Results for the student ───────────────────────────── */

export type ReviewItem = PaperItem & {
  /** Only when answers may be shown. */
  correctOptionIds?: string[];
  correctValue?: { value: number; tolerance: number };
  guide?: string;
  explanation?: string;
  correct: boolean | null;
  awarded: number | null;
  needsGrading: boolean;
  feedback: string;
};

export type AttemptResult = {
  attempt: Pick<AttemptRow, "id" | "attemptNo" | "status" | "score" | "maxScore" | "scorePercent" | "passed" | "submitReason"> & {
    startedAt: string;
    submittedAt: string | null;
  };
  test: Pick<TestRow, "id" | "title" | "kind" | "passPercent" | "showAnswers" | "attemptLimit"> & { closesAt: string | null };
  attemptsUsed: number;
  canRetake: boolean;
  /** Why answers aren't shown (when they aren't). */
  answersHidden: null | "never" | "until_close" | "grading";
  items: ReviewItem[] | null;
};

/** May this student see the answers of this attempt now? */
export function answersVisible(test: Pick<TestRow, "showAnswers" | "closesAt">, now = new Date()): { visible: boolean; reason: "never" | "until_close" | null } {
  if (test.showAnswers === "never") return { visible: false, reason: "never" };
  if (test.showAnswers === "after_close") return test.closesAt && test.closesAt <= now ? { visible: true, reason: null } : { visible: false, reason: "until_close" };
  return { visible: true, reason: null };
}

export async function attemptResult(actor: Actor, attemptId: string): Promise<AttemptResult> {
  assertCan(actor, "self.take_test", own(actor));
  return withTenant(actor, async (tx) => {
    let a = await ownAttempt(tx, actor, attemptId, { lock: true });
    if (a.status === "in_progress" && isExpired(a)) a = await finalize(tx, systemActorFor(uni(actor)), a, "time_up");
    if (a.status === "in_progress") throw new ConflictError("This attempt is still in progress.", "in_progress");
    const test = await loadTest(tx, a.testId);
    const [{ used }] = await tx
      .select({ used: sql<number>`count(*)::int` })
      .from(assessAttempts)
      .where(and(eq(assessAttempts.testId, test.id), eq(assessAttempts.userId, actor.userId)));
    const canRetake = used < test.attemptLimit && windowState(test) === "open" && (await studentBatchFor(tx, actor.userId, test)) !== null;
    const show = answersVisible(test);
    let items: ReviewItem[] | null = null;
    let hidden: AttemptResult["answersHidden"] = show.visible ? null : show.reason;
    if (show.visible) {
      const rows = await tx.select().from(assessAttemptItems).where(eq(assessAttemptItems.attemptId, a.id)).orderBy(asc(assessAttemptItems.position));
      items = rows.map((r) => reviewItem(r, true));
    } else if (a.status === "awaiting_grading") {
      hidden = hidden ?? "grading";
    }
    return {
      attempt: {
        id: a.id,
        attemptNo: a.attemptNo,
        status: a.status,
        score: a.status === "graded" ? a.score : null,
        maxScore: a.maxScore,
        scorePercent: a.scorePercent,
        passed: a.passed,
        submitReason: a.submitReason,
        startedAt: a.startedAt.toISOString(),
        submittedAt: a.submittedAt?.toISOString() ?? null,
      },
      test: {
        id: test.id,
        title: test.title,
        kind: test.kind,
        passPercent: test.passPercent,
        showAnswers: test.showAnswers,
        attemptLimit: test.attemptLimit,
        closesAt: test.closesAt?.toISOString() ?? null,
      },
      attemptsUsed: used,
      canRetake,
      answersHidden: hidden,
      items,
    };
  });
}

/** An item for review. `withAnswers` = the correct answer and explanation may be included. */
export function reviewItem(r: ItemRow, withAnswers: boolean): ReviewItem {
  const base: ReviewItem = {
    ...toPaperItem(r),
    correct: r.correct,
    awarded: r.needsGrading ? null : (r.manualScore ?? r.autoScore),
    needsGrading: r.needsGrading,
    feedback: r.feedback,
  };
  if (!withAnswers) return base;
  return { ...base, ...answerParts(r.answer), explanation: r.explanation };
}

function answerParts(answer: QuestionAnswer): Pick<ReviewItem, "correctOptionIds" | "correctValue" | "guide"> {
  if ("value" in answer) return { correctValue: { value: answer.value, tolerance: answer.tolerance } };
  if ("guide" in answer) return { guide: answer.guide };
  return { correctOptionIds: correctOptionIds(answer) };
}

/* ───────────────────────────── Manual grading ───────────────────────────── */

/** Whoever holds assess.grade on the attempt's batch grades its short answers. */
export async function gradeItem(actor: Actor, itemId: string, input: { score: number; feedback?: string }) {
  return withTenant(actor, async (tx) => {
    const [item] = await tx.select().from(assessAttemptItems).where(eq(assessAttemptItems.id, itemId));
    if (!item) throw new NotFoundError("Answer");
    const [a] = await tx.select().from(assessAttempts).where(eq(assessAttempts.id, item.attemptId)).for("update");
    const test = await loadTest(tx, a.testId);
    if (!canGrade(actor, a, test)) throw new NotFoundError("Answer");
    if (item.type !== "short") throw new ValidationError("Only short answers are graded by hand. The others are marked automatically.");
    if (a.status === "in_progress") throw new ConflictError("The student is still taking this test.");
    if (a.status === "graded") throw new ConflictError("This attempt is already final. Its result has been sent to the student.");
    const score = input.score;
    if (!Number.isFinite(score) || score < 0 || score > item.marks) throw new ValidationError(`Give between 0 and ${item.marks} marks.`);
    if (roundMarks(score) !== score) throw new ValidationError("Marks can have at most two decimal places.");
    const feedback = (input.feedback ?? "").trim();
    if (feedback.length > 2000) throw new ValidationError("Keep the feedback under 2000 characters.");
    await tx
      .update(assessAttemptItems)
      .set({ manualScore: score, correct: score === item.marks, needsGrading: false, feedback, gradedBy: actor.userId || null, gradedAt: new Date() })
      .where(eq(assessAttemptItems.id, item.id));
    await audit(tx, actor, "assess.attempt.grade", "assess_attempt", a.id, { itemId, score });
    return completeIfGraded(tx, actor, a, test);
  });
}

/** Graders are checked against the attempt's own batch, never the test's other batches. */
export function canGrade(actor: Actor, a: Pick<AttemptRow, "batchId">, test: Pick<TestRow, "departmentId">) {
  return canOnAttempt(actor, "assess.grade", a, test);
}

/** When the last short answer is graded: the final score, the student is told, and test.submitted goes out. */
async function completeIfGraded(tx: Tx, actor: Actor, a: AttemptRow, test: TestRow) {
  const [{ left }] = await tx
    .select({ left: sql<number>`count(*)::int` })
    .from(assessAttemptItems)
    .where(and(eq(assessAttemptItems.attemptId, a.id), eq(assessAttemptItems.needsGrading, true)));
  if (left > 0) return { status: "awaiting_grading" as const, left };
  const [{ total }] = await tx
    .select({ total: sql<number>`coalesce(sum(coalesce(${assessAttemptItems.manualScore}, ${assessAttemptItems.autoScore})), 0)::float` })
    .from(assessAttemptItems)
    .where(eq(assessAttemptItems.attemptId, a.id));
  const score = roundMarks(total);
  const scorePercent = percentOf(score, a.maxScore);
  const passed = scorePercent >= test.passPercent;
  const [saved] = await tx
    .update(assessAttempts)
    .set({ status: "graded", score, scorePercent, passed, gradedAt: new Date() })
    .where(and(eq(assessAttempts.id, a.id), eq(assessAttempts.status, "awaiting_grading")))
    .returning();
  if (!saved) return { status: "graded" as const, left: 0 };
  await audit(tx, actor, "assess.attempt.final", "assess_attempt", a.id, { score, scorePercent, passed });
  await notify(tx, uni(actor), [a.userId], {
    kind: "assess.result.ready",
    title: `Your result for ${test.title} is ready`,
    body: `You scored ${Math.round(scorePercent)}%.`,
    data: { attemptId: a.id, testId: test.id },
  });
  await emitSubmitted(tx, actor, saved);
  return { status: "graded" as const, left: 0 };
}

/* ───────────────────────────── Grading queue ───────────────────────────── */

export async function gradingQueue(actor: Actor, opts: { testId?: string } = {}) {
  const r = reach(actor, "assess.grade", uni(actor));
  if (!hasReach(r)) return [];
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        itemId: assessAttemptItems.id,
        prompt: assessAttemptItems.prompt,
        marks: assessAttemptItems.marks,
        attemptId: assessAttempts.id,
        userId: assessAttempts.userId,
        batchId: assessAttempts.batchId,
        submittedAt: assessAttempts.submittedAt,
        testId: assessTests.id,
        testTitle: assessTests.title,
      })
      .from(assessAttemptItems)
      .innerJoin(assessAttempts, eq(assessAttempts.id, assessAttemptItems.attemptId))
      .innerJoin(assessTests, eq(assessTests.id, assessAttempts.testId))
      .where(
        and(
          eq(assessAttemptItems.needsGrading, true),
          eq(assessAttempts.status, "awaiting_grading"),
          opts.testId ? eq(assessTests.id, opts.testId) : undefined,
          attemptsInReach(r),
        ),
      )
      .orderBy(asc(assessAttempts.submittedAt), asc(assessAttemptItems.position));
    const people = new Map((await peopleLite(tx, rows.map((r) => r.userId))).map((p) => [p.id, p]));
    return rows.map((row) => ({ ...row, studentName: people.get(row.userId)?.name ?? "Student" }));
  });
}
