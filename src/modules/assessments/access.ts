/**
 * Who may do what in assessments (brief: "Who can write"), as reusable checks.
 *
 * Pools
 *   - Every department has a pool. Its permission target is the department and all of its
 *     batches, so: admins pass (university scope), the HOD passes (department scope), and a
 *     faculty member passes when they teach at least one batch in that department.
 *   - The university-wide pool's target is the university alone: only admins pass.
 *   - Faculty may add to a pool and use it, but only edit or remove questions they wrote.
 *
 * Tests
 *   - A test's target is its course's department plus the batches it is for (every batch
 *     of the course when it is course-wide). Viewing needs the action on any of them.
 *   - Managing needs the action on every batch it is for; a course-wide test needs the
 *     department itself, so faculty only ever manage tests for their own batches.
 */
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses, departments } from "@/db/schema";
import { can, reach, type Action, type Actor, type Target } from "@/server/core";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { assessAttempts, assessTestBatches, assessTests } from "./schema";

export const uni = (actor: Actor) => actor.universityId!;

/** The university-wide pool's key in URLs and forms. Department pools use the department id. */
export const UNIVERSITY_POOL = "university";

/* ───────────────────────────── Pools ───────────────────────────── */

/** Permission target of a pool: null = the university-wide pool. */
export async function poolTarget(tx: Tx, actor: Actor, departmentId: string | null): Promise<Target> {
  if (departmentId === null) return { universityId: uni(actor) };
  const [d] = await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, departmentId));
  if (!d) throw new NotFoundError("Department");
  const bs = await tx.select({ id: batches.id }).from(batches).where(eq(batches.departmentId, departmentId));
  return { universityId: uni(actor), departmentIds: [departmentId], batchIds: bs.map((b) => b.id) };
}

export type Pool = { key: string; departmentId: string | null; name: string; code: string | null };

/** Every pool the actor can read and add to, university-wide first, then departments by name. */
export async function poolsFor(tx: Tx, actor: Actor): Promise<Pool[]> {
  const r = reach(actor, "assess.manage", uni(actor));
  const depts = await tx.select({ id: departments.id, name: departments.name, code: departments.code }).from(departments).orderBy(departments.name);
  let allowed: Set<string>;
  if (r.all) allowed = new Set(depts.map((d) => d.id));
  else {
    allowed = new Set(r.departmentIds);
    if (r.batchIds.size) {
      const rows = await tx.select({ departmentId: batches.departmentId }).from(batches).where(inArray(batches.id, [...r.batchIds]));
      for (const b of rows) allowed.add(b.departmentId);
    }
  }
  const pools: Pool[] = depts.filter((d) => allowed.has(d.id)).map((d) => ({ key: d.id, departmentId: d.id, name: `${d.name} pool`, code: d.code }));
  return r.all ? [{ key: UNIVERSITY_POOL, departmentId: null, name: "University-wide pool", code: null }, ...pools] : pools;
}

export function poolKeyToDepartment(key: string): string | null {
  return key === UNIVERSITY_POOL ? null : key;
}

export async function assertPoolAccess(tx: Tx, actor: Actor, departmentId: string | null): Promise<Target> {
  const target = await poolTarget(tx, actor, departmentId);
  if (!can(actor, "assess.manage", target)) throw new ForbiddenError("You can't use this question pool.");
  return target;
}

/**
 * Editing or removing an existing question: anyone who can manage the whole pool
 * (admin; HOD of that department), or the faculty member who wrote it.
 */
export function canEditQuestion(actor: Actor, q: { departmentId: string | null; createdBy: string | null }, target: Target): boolean {
  return can(actor, "assess.manage", target) && runsPoolOrWrote(actor, q);
}

/** The edit rule once pool access is known: whole-pool managers (admin, the HOD), or the author. */
export function runsPoolOrWrote(actor: Actor, q: { departmentId: string | null; createdBy: string | null }): boolean {
  const wholePool: Target = q.departmentId ? { universityId: uni(actor), departmentIds: [q.departmentId] } : { universityId: uni(actor) };
  return can(actor, "assess.manage", wholePool) || (!!actor.userId && q.createdBy === actor.userId);
}

/* ───────────────────────────── Tests ───────────────────────────── */

export type TestRow = typeof assessTests.$inferSelect;

/** The batches a test is for: every batch of its course when it is course-wide. */
export async function testBatchIds(tx: Tx, test: Pick<TestRow, "id" | "courseId" | "allBatches">): Promise<string[]> {
  if (test.allBatches) {
    const rows = await tx.select({ id: batches.id }).from(batches).where(eq(batches.courseId, test.courseId));
    return rows.map((r) => r.id);
  }
  const rows = await tx.select({ id: assessTestBatches.batchId }).from(assessTestBatches).where(eq(assessTestBatches.testId, test.id));
  return rows.map((r) => r.id);
}

export async function testTarget(tx: Tx, actor: Actor, test: Pick<TestRow, "id" | "courseId" | "allBatches" | "departmentId">): Promise<Target> {
  return { universityId: uni(actor), departmentIds: [test.departmentId], batchIds: await testBatchIds(tx, test) };
}

/** May the actor manage (edit, publish, delete) a test with these targets? */
export function canManageTargets(actor: Actor, t: { departmentId: string; allBatches: boolean; batchIds: readonly string[] }): boolean {
  const dept: Target = { universityId: uni(actor), departmentIds: [t.departmentId] };
  if (t.allBatches) return can(actor, "assess.manage", dept);
  if (t.batchIds.length === 0) return can(actor, "assess.manage", dept);
  return t.batchIds.every((b) => can(actor, "assess.manage", { ...dept, batchIds: [b] }));
}

export async function loadTest(tx: Tx, testId: string, opts: { lock?: boolean } = {}): Promise<TestRow> {
  const q = tx.select().from(assessTests).where(eq(assessTests.id, testId));
  const [t] = opts.lock ? await q.for("update") : await q;
  if (!t) throw new NotFoundError("Test");
  return t;
}

/** Loads a test the actor may see with `action` (throws NotFound when they can't, so ids don't leak). */
export async function testFor(tx: Tx, actor: Actor, testId: string, action: Action = "assess.view_results") {
  const test = await loadTest(tx, testId);
  const target = await testTarget(tx, actor, test);
  if (!can(actor, action, target) && !can(actor, "assess.manage", target)) throw new NotFoundError("Test");
  const batchIds = target.batchIds ?? [];
  const canManage = canManageTargets(actor, { departmentId: test.departmentId, allBatches: test.allBatches, batchIds });
  return { test, target, batchIds, canManage };
}

export async function testForManager(tx: Tx, actor: Actor, testId: string) {
  const t = await testFor(tx, actor, testId, "assess.manage");
  if (!t.canManage) throw new ForbiddenError("Only staff who teach every batch of this test can change it.");
  return t;
}

/** Courses the actor can create tests in, with the batches they may target and whether they may target the whole course. */
export async function courseChoices(tx: Tx, actor: Actor) {
  const r = reach(actor, "assess.manage", uni(actor));
  if (!r.all && r.departmentIds.size === 0 && r.batchIds.size === 0) return [];
  const rows = await tx
    .select({
      courseId: courses.id,
      courseTitle: courses.title,
      departmentId: courses.departmentId,
      status: courses.status,
      batchId: batches.id,
      batchName: batches.name,
      batchStatus: batches.status,
      startDate: batches.startDate,
    })
    .from(courses)
    .leftJoin(batches, eq(batches.courseId, courses.id))
    .where(
      r.all
        ? sql`${courses.status} <> 'archived'`
        : and(
            sql`${courses.status} <> 'archived'`,
            or(
              r.departmentIds.size ? inArray(courses.departmentId, [...r.departmentIds]) : undefined,
              r.batchIds.size ? inArray(batches.id, [...r.batchIds]) : undefined,
            ),
          ),
    )
    .orderBy(courses.title, batches.startDate, batches.name);
  const byCourse = new Map<
    string,
    { courseId: string; title: string; departmentId: string; wholeCourse: boolean; batches: { id: string; name: string; status: string }[] }
  >();
  for (const row of rows) {
    let c = byCourse.get(row.courseId);
    if (!c) {
      c = {
        courseId: row.courseId,
        title: row.courseTitle,
        departmentId: row.departmentId,
        wholeCourse: can(actor, "assess.manage", { universityId: uni(actor), departmentIds: [row.departmentId] }),
        batches: [],
      };
      byCourse.set(row.courseId, c);
    }
    if (row.batchId && can(actor, "assess.manage", { universityId: uni(actor), departmentIds: [row.departmentId], batchIds: [row.batchId] })) {
      c.batches.push({ id: row.batchId, name: row.batchName!, status: row.batchStatus! });
    }
  }
  return [...byCourse.values()].filter((c) => c.wholeCourse || c.batches.length > 0);
}

/* ───────────────────────────── List filters ───────────────────────────── */

type Reach = ReturnType<typeof reach>;

/** Tests visible with this reach: whole university, their departments, or tests for their batches. */
export async function testsInReach(tx: Tx, r: Reach): Promise<SQL | undefined> {
  if (r.all) return undefined;
  const conds: (SQL | undefined)[] = [];
  if (r.departmentIds.size) conds.push(inArray(assessTests.departmentId, [...r.departmentIds]));
  if (r.batchIds.size) {
    const ids = [...r.batchIds];
    const courseIds = (await tx.select({ courseId: batches.courseId }).from(batches).where(inArray(batches.id, ids))).map((b) => b.courseId);
    if (courseIds.length) conds.push(and(eq(assessTests.allBatches, true), inArray(assessTests.courseId, courseIds)));
    conds.push(
      sql`exists (select 1 from ${assessTestBatches} tb where tb.test_id = ${assessTests.id} and tb.batch_id in (${sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )}))`,
    );
  }
  const real = conds.filter(Boolean) as SQL[];
  return real.length ? or(...real) : sql`false`;
}

/** Attempts visible with this reach (needs assess_tests joined): their departments' tests or their batches' students. */
export function attemptsInReach(r: Reach): SQL | undefined {
  if (r.all) return undefined;
  const conds: SQL[] = [];
  if (r.departmentIds.size) conds.push(inArray(assessTests.departmentId, [...r.departmentIds]));
  if (r.batchIds.size) conds.push(inArray(assessAttempts.batchId, [...r.batchIds]));
  return conds.length ? or(...conds) : sql`false`;
}

export function hasReach(r: Reach) {
  return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
}

/** Can the actor see this attempt with `action`? Uses the attempt's own batch, never the test's other batches. */
export function canOnAttempt(actor: Actor, action: Action, a: { batchId: string }, test: { departmentId: string }) {
  return can(actor, action, { universityId: uni(actor), departmentIds: [test.departmentId], batchIds: [a.batchId] });
}
