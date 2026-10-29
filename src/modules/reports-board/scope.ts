/**
 * Turning a permission's reach (whole university, some departments, some batches) into
 * query conditions, and checking ids that arrive from the browser.
 */
import { inArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { reach, type Action, type Actor } from "@/server/core";
import { ForbiddenError, ValidationError } from "@/server/errors";
import { isDate } from "./lib/dates";

export type Reach = ReturnType<typeof reach>;

export function hasReach(r: Reach): boolean {
  return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
}

/** Where the actor holds `action`, in their current university. Throws when they hold it nowhere. */
export function reachOf(actor: Actor, action: Action, message?: string): Reach {
  if (!actor.universityId) throw new ForbiddenError("Open a university first.");
  const r = reach(actor, action, actor.universityId);
  if (!hasReach(r)) throw new ForbiddenError(message);
  return r;
}

/**
 * Rows whose batch sits inside the reach: everything for university-wide access, else
 * batches in the actor's departments or the actor's own batches.
 */
export function batchInReach(r: Reach, batchId: PgColumn, departmentId: PgColumn): SQL | undefined {
  if (r.all) return undefined;
  const parts: SQL[] = [];
  if (r.departmentIds.size) parts.push(inArray(departmentId, [...r.departmentIds]));
  if (r.batchIds.size) parts.push(inArray(batchId, [...r.batchIds]));
  return parts.length ? or(...parts) : sql`false`;
}

/** Same check in memory, for rows already loaded. */
export function batchIsInReach(r: Reach, batch: { id: string; departmentId: string }): boolean {
  return r.all || r.departmentIds.has(batch.departmentId) || r.batchIds.has(batch.id);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}

/** Report parameters arrive from the URL: refuse anything that isn't a well-formed id or date. */
export function checkParams(params: { from?: string; to?: string; departmentId?: string; courseId?: string; batchId?: string }) {
  for (const key of ["departmentId", "courseId", "batchId"] as const) {
    const v = params[key];
    if (v !== undefined && !isUuid(v)) throw new ValidationError("That filter isn't valid. Pick it again from the list.", "bad_filter");
  }
  for (const key of ["from", "to"] as const) {
    const v = params[key];
    if (v !== undefined && !isDate(v)) throw new ValidationError("Dates must be real calendar dates, like 2026-04-01.", "bad_date");
  }
  if (params.from && params.to && params.from > params.to) {
    throw new ValidationError("The start date is after the end date. Swap them and run the report again.", "bad_range");
  }
}

/** Start of `from` and the start of the day after `to`, in the university's time zone, as SQL timestamps. */
export function dayStart(date: string, timezone: string): SQL {
  return sql`((${date})::date)::timestamp at time zone ${timezone}`;
}
export function dayAfter(date: string, timezone: string): SQL {
  return sql`((${date})::date + 1)::timestamp at time zone ${timezone}`;
}
