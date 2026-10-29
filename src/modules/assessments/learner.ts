/**
 * The learner's tests (brief item 6): available, upcoming and completed, only for the
 * student's own active batches. A test series shows as one item.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses } from "@/db/schema";
import { assertCan, studentEnrolments, universityLite, withTenant, type Actor } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { uni, type TestRow } from "./access";
import { windowState, type WindowState } from "./attempts";
import { assessAttemptItems, assessAttempts, assessDrawRules, assessTestBatches, assessTestQuestions, assessTests, type AttemptStatus } from "./schema";

export type MyAttempt = {
  id: string;
  attemptNo: number;
  status: AttemptStatus;
  scorePercent: number | null;
  passed: boolean | null;
  submittedAt: Date | null;
  endsAt: Date | null;
};

export type MyTest = {
  id: string;
  title: string;
  kind: TestRow["kind"];
  courseId: string;
  courseTitle: string;
  batchId: string;
  opensAt: Date | null;
  closesAt: Date | null;
  timeLimitMinutes: number | null;
  attemptLimit: number;
  passPercent: number;
  questionCount: number;
  window: WindowState;
  attempts: MyAttempt[];
  inProgress: MyAttempt | null;
  best: MyAttempt | null;
  /** available = can start or resume now; upcoming = opens later; completed = nothing more to do. */
  bucket: "available" | "upcoming" | "completed";
  seriesId: string | null;
};

export type MySeries = {
  id: string;
  title: string;
  courseId: string;
  courseTitle: string;
  tests: MyTest[];
  done: number;
  bucket: "available" | "upcoming" | "completed";
};

export type MyTests = { tests: MyTest[]; series: MySeries[]; timezone: string };

function bucketOf(t: Pick<MyTest, "window" | "attempts" | "attemptLimit" | "inProgress">): MyTest["bucket"] {
  if (t.inProgress) return "available";
  const used = t.attempts.length;
  if (t.window === "upcoming") return "upcoming";
  if (t.window === "open" && used < t.attemptLimit) return "available";
  return "completed";
}

function best(attempts: MyAttempt[]): MyAttempt | null {
  const graded = attempts.filter((a) => a.status === "graded");
  if (graded.length) return graded.reduce((b, a) => ((a.scorePercent ?? 0) > (b.scorePercent ?? 0) ? a : b));
  return attempts.find((a) => a.status === "awaiting_grading") ?? null;
}

/** Published tests for the student's active batches, with their own attempts. */
async function loadMine(tx: Tx, actor: Actor, opts: { courseId?: string; batchId?: string } = {}) {
  const active = (await studentEnrolments(tx, actor.userId)).filter((e) => e.status === "active");
  const scoped = active.filter((e) => (!opts.courseId || e.courseId === opts.courseId) && (!opts.batchId || e.batchId === opts.batchId));
  if (scoped.length === 0) return { tests: [] as MyTest[], series: [] as MySeries[] };
  const batchByCourse = new Map(scoped.map((e) => [e.courseId, e.batchId]));
  const batchIds = scoped.map((e) => e.batchId);
  const courseIds = [...batchByCourse.keys()];

  const rows = await tx
    .select({ t: assessTests, courseTitle: courses.title })
    .from(assessTests)
    .innerJoin(courses, eq(courses.id, assessTests.courseId))
    .where(
      and(
        eq(assessTests.status, "published"),
        inArray(assessTests.courseId, courseIds),
        or(
          eq(assessTests.allBatches, true),
          sql`exists (select 1 from ${assessTestBatches} tb where tb.test_id = assess_tests.id and tb.batch_id in (${sql.join(
            batchIds.map((b) => sql`${b}::uuid`),
            sql`, `,
          )}))`,
        ),
      ),
    )
    .orderBy(asc(assessTests.seriesPosition), asc(assessTests.opensAt), asc(assessTests.createdAt));

  const seriesRows = rows.filter((r) => r.t.kind === "series");
  const publishedSeries = new Set(seriesRows.map((r) => r.t.id));
  // A test in a series shows only when the series itself is published and reaches this student.
  const testRows = rows.filter((r) => r.t.kind !== "series" && (!r.t.seriesId || publishedSeries.has(r.t.seriesId)));
  const ids = testRows.map((r) => r.t.id);

  const attempts = ids.length
    ? await tx
        .select()
        .from(assessAttempts)
        .where(and(eq(assessAttempts.userId, actor.userId), inArray(assessAttempts.testId, ids)))
        .orderBy(desc(assessAttempts.attemptNo))
    : [];
  // Questions per test: picked ones plus what the draw rules add.
  const countOf = new Map<string, number>();
  if (ids.length) {
    const picked = await tx
      .select({ testId: assessTestQuestions.testId, n: sql<number>`count(*)::int` })
      .from(assessTestQuestions)
      .where(inArray(assessTestQuestions.testId, ids))
      .groupBy(assessTestQuestions.testId);
    const drawn = await tx
      .select({ testId: assessDrawRules.testId, n: sql<number>`coalesce(sum(${assessDrawRules.count}), 0)::int` })
      .from(assessDrawRules)
      .where(inArray(assessDrawRules.testId, ids))
      .groupBy(assessDrawRules.testId);
    for (const r of [...picked, ...drawn]) countOf.set(r.testId, (countOf.get(r.testId) ?? 0) + r.n);
  }

  const now = new Date();
  const tests: MyTest[] = testRows.map(({ t, courseTitle }) => {
    const mine: MyAttempt[] = attempts
      .filter((a) => a.testId === t.id)
      .map((a) => ({ id: a.id, attemptNo: a.attemptNo, status: a.status, scorePercent: a.scorePercent, passed: a.passed, submittedAt: a.submittedAt, endsAt: a.endsAt }));
    const inProgress = mine.find((a) => a.status === "in_progress" && (!a.endsAt || a.endsAt > now)) ?? null;
    const done = mine.filter((a) => a.status !== "in_progress");
    const base = {
      id: t.id,
      title: t.title,
      kind: t.kind,
      courseId: t.courseId,
      courseTitle,
      batchId: batchByCourse.get(t.courseId)!,
      opensAt: t.opensAt,
      closesAt: t.closesAt,
      timeLimitMinutes: t.timeLimitMinutes,
      attemptLimit: t.attemptLimit,
      passPercent: t.passPercent,
      questionCount: countOf.get(t.id) ?? 0,
      window: windowState(t, now),
      attempts: done,
      inProgress,
      best: best(done),
      seriesId: t.seriesId,
    };
    return { ...base, bucket: bucketOf({ ...base, attempts: mine.filter((a) => a.status !== "in_progress" || a === inProgress) }) };
  });

  const series: MySeries[] = seriesRows.map(({ t, courseTitle }) => {
    const children = tests.filter((x) => x.seriesId === t.id);
    const done = children.filter((c) => c.attempts.length > 0).length;
    const bucket: MySeries["bucket"] = children.some((c) => c.bucket === "available")
      ? "available"
      : children.some((c) => c.bucket === "upcoming")
        ? "upcoming"
        : "completed";
    return { id: t.id, title: t.title, courseId: t.courseId, courseTitle, tests: children, done, bucket };
  });
  return { tests: tests.filter((t) => !t.seriesId), series: series.filter((s) => s.tests.length > 0) };
}

export async function myTests(actor: Actor, opts: { courseId?: string; batchId?: string } = {}): Promise<MyTests> {
  assertCan(actor, "self.take_test", { universityId: uni(actor), ownerUserId: actor.userId });
  return withTenant(actor, async (tx) => {
    const { timezone } = await universityLite(tx);
    return { ...(await loadMine(tx, actor, opts)), timezone };
  });
}

/** One test the student can see (for the start page). NotFound when they can't. */
export async function myTest(actor: Actor, testId: string) {
  const all = await myTests(actor);
  const flat = [...all.tests, ...all.series.flatMap((s) => s.tests)];
  const t = flat.find((x) => x.id === testId);
  if (!t) throw new NotFoundError("Test");
  return withTenant(actor, async (tx) => {
    const [row] = await tx.select().from(assessTests).where(eq(assessTests.id, testId));
    const series = t.seriesId ? all.series.find((s) => s.id === t.seriesId) ?? null : null;
    return { test: t, row, series, timezone: all.timezone };
  });
}

export async function mySeries(actor: Actor, seriesId: string) {
  const all = await myTests(actor);
  const s = all.series.find((x) => x.id === seriesId);
  if (!s) throw new NotFoundError("Test series");
  return { series: s, timezone: all.timezone };
}

/** Graded results across the student's courses, newest first (the hub's "Test results"). */
export async function myResults(actor: Actor, limit = 20, opts: { courseId?: string } = {}) {
  assertCan(actor, "self.take_test", { universityId: uni(actor), ownerUserId: actor.userId });
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        attemptId: assessAttempts.id,
        attemptNo: assessAttempts.attemptNo,
        status: assessAttempts.status,
        scorePercent: assessAttempts.scorePercent,
        passed: assessAttempts.passed,
        submittedAt: assessAttempts.submittedAt,
        testId: assessTests.id,
        testTitle: assessTests.title,
        kind: assessTests.kind,
        courseTitle: courses.title,
        batchName: batches.name,
      })
      .from(assessAttempts)
      .innerJoin(assessTests, eq(assessTests.id, assessAttempts.testId))
      .innerJoin(courses, eq(courses.id, assessAttempts.courseId))
      .innerJoin(batches, eq(batches.id, assessAttempts.batchId))
      .where(
        and(
          eq(assessAttempts.userId, actor.userId),
          sql`${assessAttempts.status} <> 'in_progress'`,
          opts.courseId ? eq(assessAttempts.courseId, opts.courseId) : undefined,
        ),
      )
      .orderBy(desc(assessAttempts.submittedAt))
      .limit(limit);
    const { timezone } = await universityLite(tx);
    return { rows, timezone };
  });
}

/** Short answers waiting in this attempt (for the "being graded" note). */
export async function waitingItems(tx: Tx, attemptId: string) {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(assessAttemptItems)
    .where(and(eq(assessAttemptItems.attemptId, attemptId), eq(assessAttemptItems.needsGrading, true), isNull(assessAttemptItems.gradedAt)));
  return n;
}
