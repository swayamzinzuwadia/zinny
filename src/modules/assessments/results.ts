/**
 * Results for staff (the Results tab, brief item 4) and the test-scores report (item 9).
 * Faculty only ever see attempts from their own batches, even on a course-wide test.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { batches, courses, departments } from "@/db/schema";
import type { ReportParams, ReportResult } from "@/contracts/module";
import { audit, peopleLite, reach, universityLite, withTenant, type Actor } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { attemptsInReach, canOnAttempt, hasReach, loadTest, testFor, uni } from "./access";
import { canGrade, reviewItem } from "./attempts";
import { zonedDate, zonedToUtc } from "./lib/time";
import { assessAttemptItems, assessAttempts, assessProctorEvents, assessTests } from "./schema";

/** The batches of this test whose attempts the actor may see. */
function visibleBatchFilter(actor: Actor, departmentId: string, batchIds: string[]) {
  return batchIds.filter((b) => canOnAttempt(actor, "assess.view_results", { batchId: b }, { departmentId }));
}

export async function testResults(actor: Actor, testId: string, opts: { batchId?: string } = {}) {
  return withTenant(actor, async (tx) => {
    const { test } = await testFor(tx, actor, testId);
    // Every batch an attempt came from (a student may have switched batch since), filtered to what the actor may see.
    const fromAttempts = (await tx.selectDistinct({ b: assessAttempts.batchId }).from(assessAttempts).where(eq(assessAttempts.testId, testId))).map((r) => r.b);
    const visible = visibleBatchFilter(actor, test.departmentId, fromAttempts);
    const batchNames = visible.length
      ? new Map((await tx.select({ id: batches.id, name: batches.name }).from(batches).where(inArray(batches.id, visible))).map((b) => [b.id, b.name]))
      : new Map<string, string>();
    const shown = opts.batchId ? visible.filter((b) => b === opts.batchId) : visible;
    if (shown.length === 0) return { test, batches: [...batchNames].map(([id, name]) => ({ id, name })), students: [], questions: [], summary: emptySummary(), timezone: (await universityLite(tx)).timezone };

    const attempts = await tx
      .select()
      .from(assessAttempts)
      .where(and(eq(assessAttempts.testId, testId), inArray(assessAttempts.batchId, shown)))
      .orderBy(asc(assessAttempts.userId), asc(assessAttempts.attemptNo));
    const people = new Map((await peopleLite(tx, attempts.map((a) => a.userId))).map((p) => [p.id, p]));
    const byStudent = new Map<string, typeof attempts>();
    for (const a of attempts) byStudent.set(a.userId, [...(byStudent.get(a.userId) ?? []), a]);
    const students = [...byStudent.entries()]
      .map(([userId, list]) => {
        const graded = list.filter((a) => a.status === "graded");
        const bestA = graded.reduce<(typeof list)[number] | null>((b, a) => (!b || (a.scorePercent ?? 0) > (b.scorePercent ?? 0) ? a : b), null);
        return {
          userId,
          name: people.get(userId)?.name ?? "Student",
          email: people.get(userId)?.email ?? "",
          batchName: batchNames.get(list[list.length - 1].batchId) ?? "",
          attempts: list.map((a) => ({ ...a, canGrade: canGrade(actor, a, test) })),
          best: bestA,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    // % correct per question: across finished attempts, per pool question.
    const finishedIds = attempts.filter((a) => a.status !== "in_progress").map((a) => a.id);
    const questions = finishedIds.length
      ? await tx
          .select({
            questionId: assessAttemptItems.questionId,
            prompt: sql<string>`min(${assessAttemptItems.prompt})`,
            type: sql<string>`min(${assessAttemptItems.type}::text)`,
            seen: sql<number>`count(*)::int`,
            answered: sql<number>`count(${assessAttemptItems.response})::int`,
            correct: sql<number>`count(*) filter (where ${assessAttemptItems.correct})::int`,
            waiting: sql<number>`count(*) filter (where ${assessAttemptItems.needsGrading})::int`,
            avgScore: sql<number>`coalesce(avg(coalesce(${assessAttemptItems.manualScore}, ${assessAttemptItems.autoScore})), 0)::float`,
            marks: sql<number>`max(${assessAttemptItems.marks})::float`,
            firstPos: sql<number>`min(${assessAttemptItems.position})::int`,
          })
          .from(assessAttemptItems)
          .where(inArray(assessAttemptItems.attemptId, finishedIds))
          .groupBy(assessAttemptItems.questionId)
          .orderBy(sql`min(${assessAttemptItems.position})`)
      : [];

    const finished = attempts.filter((a) => a.status === "graded");
    const summary = {
      students: students.length,
      attempts: attempts.filter((a) => a.status !== "in_progress").length,
      inProgress: attempts.filter((a) => a.status === "in_progress").length,
      awaiting: attempts.filter((a) => a.status === "awaiting_grading").length,
      average: finished.length ? finished.reduce((s, a) => s + (a.scorePercent ?? 0), 0) / finished.length : null,
      passRate: finished.length ? (finished.filter((a) => a.passed).length / finished.length) * 100 : null,
    };
    return {
      test,
      batches: [...batchNames].map(([id, name]) => ({ id, name })),
      students,
      questions: questions.map((q) => ({ ...q, percentCorrect: q.type === "short" ? null : q.seen ? (q.correct / q.seen) * 100 : 0 })),
      summary,
      timezone: (await universityLite(tx)).timezone,
    };
  });
}

function emptySummary() {
  return { students: 0, attempts: 0, inProgress: 0, awaiting: 0, average: null as number | null, passRate: null as number | null };
}

/** One attempt, in full, for staff who may see it (answers included). */
export async function staffAttempt(actor: Actor, attemptId: string) {
  return withTenant(actor, async (tx) => {
    const [a] = await tx.select().from(assessAttempts).where(eq(assessAttempts.id, attemptId));
    if (!a) throw new NotFoundError("Attempt");
    const test = await loadTest(tx, a.testId);
    if (!canOnAttempt(actor, "assess.view_results", a, test) && !canOnAttempt(actor, "assess.grade", a, test)) throw new NotFoundError("Attempt");
    const [student] = await peopleLite(tx, [a.userId]);
    const [batch] = await tx.select({ name: batches.name }).from(batches).where(eq(batches.id, a.batchId));
    const items = await tx.select().from(assessAttemptItems).where(eq(assessAttemptItems.attemptId, a.id)).orderBy(asc(assessAttemptItems.position));
    const events = await tx.select().from(assessProctorEvents).where(eq(assessProctorEvents.attemptId, a.id)).orderBy(asc(assessProctorEvents.at));
    const { timezone } = await universityLite(tx);
    await audit(tx, actor, "assess.attempt.view", "assess_attempt", a.id);
    return {
      attempt: a,
      test,
      student: student ?? { id: a.userId, name: "Student", email: "" },
      batchName: batch?.name ?? "",
      // Staff see the answers; in-progress attempts show what's saved so far, unmarked.
      items: items.map((i) => ({ ...reviewItem(i, true), gradedAt: i.gradedAt })),
      events,
      canGrade: canGrade(actor, a, test),
      timezone,
    };
  });
}

/* ───────────────────────────── Dashboard numbers ───────────────────────────── */

/** Short answers waiting for this actor to grade, per test (for the dashboard card). */
export async function toGradeSummary(actor: Actor) {
  const r = reach(actor, "assess.grade", uni(actor));
  if (!hasReach(r)) return { total: 0, tests: [] };
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        testId: assessTests.id,
        title: assessTests.title,
        courseTitle: courses.title,
        attempts: sql<number>`count(distinct ${assessAttempts.id})::int`,
        answers: sql<number>`count(*)::int`,
        oldest: sql<Date>`min(${assessAttempts.submittedAt})`,
      })
      .from(assessAttemptItems)
      .innerJoin(assessAttempts, eq(assessAttempts.id, assessAttemptItems.attemptId))
      .innerJoin(assessTests, eq(assessTests.id, assessAttempts.testId))
      .innerJoin(courses, eq(courses.id, assessTests.courseId))
      .where(and(eq(assessAttemptItems.needsGrading, true), eq(assessAttempts.status, "awaiting_grading"), attemptsInReach(r)))
      .groupBy(assessTests.id, assessTests.title, courses.title)
      .orderBy(sql`min(${assessAttempts.submittedAt})`);
    return { total: rows.reduce((s, x) => s + x.attempts, 0), tests: rows };
  });
}

/* ───────────────────────────── Report: test scores ───────────────────────────── */

export async function testScoresReport(actor: Actor, params: ReportParams): Promise<ReportResult> {
  const columns: ReportResult["columns"] = [
    { key: "submitted", label: "Submitted", type: "date" },
    { key: "student", label: "Student", type: "text" },
    { key: "email", label: "Email", type: "text" },
    { key: "course", label: "Course", type: "text" },
    { key: "batch", label: "Batch", type: "text" },
    { key: "test", label: "Test", type: "text" },
    { key: "type", label: "Type", type: "text" },
    { key: "attempt", label: "Attempt", type: "number" },
    { key: "score", label: "Marks", type: "number" },
    { key: "maxScore", label: "Out of", type: "number" },
    { key: "percent", label: "Score", type: "percent" },
    { key: "result", label: "Result", type: "text" },
  ];
  const r = reach(actor, "assess.view_results", uni(actor));
  if (!hasReach(r)) return { columns, rows: [] };
  return withTenant(actor, async (tx) => {
    const { timezone } = await universityLite(tx);
    const conds: (SQL | undefined)[] = [sql`${assessAttempts.status} <> 'in_progress'`, attemptsInReach(r)];
    if (params.from) {
      const from = zonedToUtc(`${params.from}T00:00`, timezone);
      if (from) conds.push(gte(assessAttempts.submittedAt, from));
    }
    if (params.to) {
      const to = zonedToUtc(`${params.to}T23:59`, timezone);
      if (to) conds.push(lte(assessAttempts.submittedAt, new Date(to.getTime() + 59_999)));
    }
    if (params.departmentId) conds.push(eq(assessTests.departmentId, params.departmentId));
    if (params.courseId) conds.push(eq(assessAttempts.courseId, params.courseId));
    if (params.batchId) conds.push(eq(assessAttempts.batchId, params.batchId));
    const rows = await tx
      .select({
        submittedAt: assessAttempts.submittedAt,
        userId: assessAttempts.userId,
        course: courses.title,
        department: departments.name,
        batch: batches.name,
        test: assessTests.title,
        kind: assessTests.kind,
        attemptNo: assessAttempts.attemptNo,
        status: assessAttempts.status,
        score: assessAttempts.score,
        maxScore: assessAttempts.maxScore,
        percent: assessAttempts.scorePercent,
        passed: assessAttempts.passed,
      })
      .from(assessAttempts)
      .innerJoin(assessTests, eq(assessTests.id, assessAttempts.testId))
      .innerJoin(courses, eq(courses.id, assessAttempts.courseId))
      .innerJoin(departments, eq(departments.id, assessTests.departmentId))
      .innerJoin(batches, eq(batches.id, assessAttempts.batchId))
      .where(and(...conds))
      .orderBy(desc(assessAttempts.submittedAt))
      .limit(10_000);
    const people = new Map((await peopleLite(tx, rows.map((x) => x.userId))).map((p) => [p.id, p]));
    const KIND = { quiz: "Quiz", mock_test: "Mock test", series: "Test series" } as const;
    return {
      columns,
      rows: rows.map((x) => ({
        submitted: x.submittedAt ? zonedDate(x.submittedAt, timezone) : null,
        student: people.get(x.userId)?.name ?? "",
        email: people.get(x.userId)?.email ?? "",
        course: x.course,
        batch: x.batch,
        test: x.test,
        type: KIND[x.kind],
        attempt: x.attemptNo,
        score: x.status === "graded" ? x.score : null,
        maxScore: x.maxScore,
        percent: x.status === "graded" ? x.percent : null,
        result: x.status === "awaiting_grading" ? "Being graded" : x.passed ? "Passed" : "Not passed",
      })),
    };
  });
}
