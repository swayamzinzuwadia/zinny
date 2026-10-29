/**
 * Which batches a person reaches for an action, read from the core `batches` table
 * (core tables may be read directly; contracts.md rule 6). Faculty reach their own
 * batches, HODs their department's, admins and the Board every batch.
 */
import { and, asc, eq, inArray, ne, or, type SQL } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses, departments } from "@/db/schema";
import { reach, type Action, type Actor } from "@/server/core";
import { ForbiddenError } from "@/server/errors";

export function uniOf(actor: Actor): string {
  if (!actor.universityId) throw new ForbiddenError("Open a university space first.");
  return actor.universityId;
}

export function reachesAny(actor: Actor, action: Action): boolean {
  const r = reach(actor, action, uniOf(actor));
  return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
}

/** HOD and admin (and the system): the action from a department or university scope covering the batch. */
export function reachesAboveBatch(actor: Actor, action: Action, departmentId: string): boolean {
  const r = reach(actor, action, uniOf(actor));
  return r.all || r.departmentIds.has(departmentId);
}

export type ScopedBatch = {
  id: string;
  courseId: string;
  courseTitle: string;
  departmentId: string;
  departmentName: string;
  name: string;
  startDate: string;
  endDate: string;
  status: "draft" | "open" | "closed" | "archived";
};

export async function batchesInReach(
  tx: Tx,
  actor: Actor,
  action: Action,
  filter: { courseId?: string; departmentId?: string; batchId?: string; includeArchived?: boolean } = {},
): Promise<ScopedBatch[]> {
  const r = reach(actor, action, uniOf(actor));
  if (!r.all && r.departmentIds.size === 0 && r.batchIds.size === 0) return [];
  const conds: (SQL | undefined)[] = [
    filter.courseId ? eq(batches.courseId, filter.courseId) : undefined,
    filter.departmentId ? eq(batches.departmentId, filter.departmentId) : undefined,
    filter.batchId ? eq(batches.id, filter.batchId) : undefined,
    filter.includeArchived ? undefined : ne(batches.status, "archived"),
  ];
  if (!r.all) {
    conds.push(
      or(
        r.departmentIds.size ? inArray(batches.departmentId, [...r.departmentIds]) : undefined,
        r.batchIds.size ? inArray(batches.id, [...r.batchIds]) : undefined,
      ),
    );
  }
  return tx
    .select({
      id: batches.id,
      courseId: batches.courseId,
      courseTitle: courses.title,
      departmentId: batches.departmentId,
      departmentName: departments.name,
      name: batches.name,
      startDate: batches.startDate,
      endDate: batches.endDate,
      status: batches.status,
    })
    .from(batches)
    .innerJoin(courses, eq(courses.id, batches.courseId))
    .innerJoin(departments, eq(departments.id, batches.departmentId))
    .where(and(...conds))
    .orderBy(asc(courses.title), asc(batches.startDate), asc(batches.name));
}
