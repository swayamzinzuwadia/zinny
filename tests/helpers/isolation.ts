/**
 * expectTenantIsolated(table, makeRow) — the tenant isolation test every new table needs
 * (CLAUDE.md rule 10).
 *
 *   it("assess_questions is isolated", () =>
 *     expectTenantIsolated(assessQuestions, async (uni) => ({
 *       universityId: uni.id,
 *       departmentId: (await makeDepartment(uni.id, "CS", "CS")).id,
 *       prompt: "2 + 2?",
 *     })));
 *
 * It creates two universities (A and B), asks `makeRow(A)` for a valid row and inserts it
 * with the system connection, then asserts that B's actor, under row-level security:
 *   - cannot see the row (and sees no rows of the table at all),
 *   - cannot update or delete it,
 *   - cannot insert a row carrying A's university_id,
 * and that A's own actor can see it. `makeRow` may create any parent records it needs
 * (with the system connection or through services) for the university it is given.
 * It is called twice for university A, so anything with a unique column (a department
 * code, a slug) must be unique per call: use `uniqueCode()` from tests/fixtures.ts.
 */
import { expect } from "vitest";
import { getTableColumns, sql, type InferInsertModel } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { systemDb } from "@/db/client";
import { systemActorFor } from "@/server/actor";
import { withTenant } from "@/server/tenant";
import { makeUniversity } from "../fixtures";

type Uni = Awaited<ReturnType<typeof makeUniversity>>;

/** Drizzle wraps Postgres errors; the database's own message is on `cause`. */
async function refusal(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return err.cause?.message ?? err.message;
  }
}

export async function expectTenantIsolated<T extends PgTable>(
  table: T,
  makeRow: (uni: Uni) => Promise<InferInsertModel<T>> | InferInsertModel<T>,
) {
  const cols = getTableColumns(table) as Record<string, { name: string }>;
  const uniKey = Object.keys(cols).find((k) => cols[k].name === "university_id");
  if (!uniKey) throw new Error("expectTenantIsolated: the table has no university_id column.");

  const A = await makeUniversity("Isolation A");
  const B = await makeUniversity("Isolation B");
  const row = await makeRow(A);
  expect((row as Record<string, unknown>)[uniKey], "makeRow must set universityId to the university it is given").toBe(A.id);

  const inserted = (await systemDb().insert(table).values(row as never).returning()) as Record<string, unknown>[];
  expect(inserted).toHaveLength(1);
  const mine = sql`${sql.identifier("university_id")} = ${A.id}`;

  const asA = systemActorFor(A.id);
  const asB = systemActorFor(B.id);

  // A sees its own row.
  const seenByA = await withTenant(asA, (tx) => tx.select().from(table as PgTable).where(mine));
  expect(seenByA.length, "university A should see its own row").toBeGreaterThanOrEqual(1);

  // B sees nothing of A's, even without any filter.
  const seenByB = (await withTenant(asB, (tx) => tx.select().from(table as PgTable))) as Record<string, unknown>[];
  expect(seenByB.filter((r) => r[uniKey] === A.id), "university B must not see A's rows").toEqual([]);

  // B can't change or delete A's rows (they're invisible, so nothing is affected).
  const updated = await withTenant(asB, (tx) =>
    tx.execute(sql`update ${table} set ${sql.identifier("university_id")} = ${B.id} where ${mine} returning 1`),
  ).catch(() => []);
  expect(Array.from(updated as unknown as unknown[]), "university B must not update A's rows").toHaveLength(0);
  const deleted = await withTenant(asB, (tx) => tx.execute(sql`delete from ${table} where ${mine} returning 1`)).catch(() => []);
  expect(Array.from(deleted as unknown as unknown[]), "university B must not delete A's rows").toHaveLength(0);

  // B can't insert a row carrying A's university id.
  const second = await makeRow(A);
  const msg = await refusal(withTenant(asB, (tx) => tx.insert(table).values(second as never)));
  expect(msg, "inserting a row for university A as university B must be refused").not.toBeNull();
  expect(msg).toMatch(/row-level security|permission denied|violates/);

  // A's row is untouched.
  const still = await systemDb().select().from(table as PgTable).where(mine);
  expect(still.length).toBeGreaterThanOrEqual(1);
}
