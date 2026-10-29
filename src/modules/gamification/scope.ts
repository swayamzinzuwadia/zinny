/**
 * Who sees and manages what on the staff pages (PRD page 3: Admin full, HOD own
 * department, permanent faculty view).
 *
 *   - Rules and badges are university-wide or belong to one department. Anyone who can
 *     view leaderboards somewhere sees the university-wide ones (they apply to everyone),
 *     plus the ones of departments they reach (a faculty member reaches the departments
 *     of the batches they teach).
 *   - Managing a university-wide item needs leaderboard.manage for the whole university;
 *     a department item needs it for that department.
 *   - Challenges and leaderboards belong to a batch or course and use its target.
 */
import { inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses, departments } from "@/db/schema";
import { can, reach, type Actor, type Target } from "@/server/core";
import { ForbiddenError } from "@/server/errors";

export function uni(actor: Actor): string {
  if (!actor.universityId) throw new ForbiddenError("Open a university first.");
  return actor.universityId;
}

export function holdsAnywhere(actor: Actor, action: "leaderboard.view" | "leaderboard.manage"): boolean {
  const r = reach(actor, action, uni(actor));
  return r.all || r.departmentIds.size > 0 || r.batchIds.size > 0;
}

/** Target for a university-wide (null) or department item. */
export function scopeTarget(universityId: string, departmentId: string | null): Target {
  return departmentId ? { universityId, departmentIds: [departmentId] } : { universityId };
}

export type Directory = {
  departments: Map<string, { id: string; code: string; name: string }>;
  courses: Map<string, { id: string; title: string; departmentId: string; status: string }>;
  batches: Map<string, { id: string; name: string; courseId: string; departmentId: string; status: string; startDate: string; endDate: string }>;
};

/** Departments, courses and batches of the university (core tables, read only). */
export async function directory(tx: Tx): Promise<Directory> {
  const [d, c, b] = await Promise.all([
    tx.select({ id: departments.id, code: departments.code, name: departments.name }).from(departments),
    tx.select({ id: courses.id, title: courses.title, departmentId: courses.departmentId, status: courses.status }).from(courses),
    tx
      .select({
        id: batches.id,
        name: batches.name,
        courseId: batches.courseId,
        departmentId: batches.departmentId,
        status: batches.status,
        startDate: batches.startDate,
        endDate: batches.endDate,
      })
      .from(batches),
  ]);
  return {
    departments: new Map(d.map((x) => [x.id, x])),
    courses: new Map(c.map((x) => [x.id, x])),
    batches: new Map(b.map((x) => [x.id, x])),
  };
}

export function batchTarget(universityId: string, b: { id: string; departmentId: string }): Target {
  return { universityId, departmentIds: [b.departmentId], batchIds: [b.id] };
}

export function courseTargetFrom(universityId: string, dir: Directory, courseId: string): Target {
  const c = dir.courses.get(courseId);
  return {
    universityId,
    departmentIds: c ? [c.departmentId] : [],
    batchIds: [...dir.batches.values()].filter((b) => b.courseId === courseId).map((b) => b.id),
  };
}

/** Departments whose rules and badges the viewer may see (all = every department). */
export async function visibleDepartments(tx: Tx, actor: Actor): Promise<{ all: boolean; ids: Set<string> }> {
  const r = reach(actor, "leaderboard.view", uni(actor));
  if (r.all) return { all: true, ids: new Set() };
  const ids = new Set(r.departmentIds);
  if (r.batchIds.size) {
    const rows = await tx.select({ d: batches.departmentId }).from(batches).where(inArray(batches.id, [...r.batchIds]));
    for (const x of rows) ids.add(x.d);
  }
  return { all: false, ids };
}

export function canSeeScoped(vis: { all: boolean; ids: Set<string> }, departmentId: string | null): boolean {
  return departmentId === null || vis.all || vis.ids.has(departmentId);
}

export function canManageScoped(actor: Actor, departmentId: string | null): boolean {
  return can(actor, "leaderboard.manage", scopeTarget(uni(actor), departmentId));
}

/** Departments the actor can create department-scoped items in, and whether they can create university-wide ones. */
export function manageableScopes(actor: Actor, dir: Directory) {
  const u = uni(actor);
  const universityWide = can(actor, "leaderboard.manage", { universityId: u });
  const depts = [...dir.departments.values()]
    .filter((d) => can(actor, "leaderboard.manage", { universityId: u, departmentIds: [d.id] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { universityWide, departments: depts };
}
