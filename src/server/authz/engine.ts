/**
 * The permission check every server action goes through (PRD page 9:
 * "Every action checks the user's role and scope on the server").
 *
 *   can(actor, "course.create", { universityId, departmentIds: [deptId] })
 *
 * An action is allowed when at least one of the actor's ACTIVE assignments
 *   1. has a role that grants the action, and
 *   2. has a scope that contains the target.
 */
import type { RoleName, ScopeType } from "@/db/schema";
import { ForbiddenError } from "../errors";
import { GRANTS_ONLY_AT, ROLE_GRANTS, SELF_ACTIONS, type Action } from "./roles";

export type Assignment = {
  role: RoleName;
  scopeType: ScopeType;
  universityId: string | null;
  departmentId: string | null;
  batchId: string | null;
  startsAt: Date;
  endsAt: Date | null;
};

export type Actor = {
  userId: string;
  name: string;
  email: string;
  /** The university space this request is working in (null on the Zinny team panel). */
  universityId: string | null;
  assignments: Assignment[];
  /** Set when a Zinny team member is inside a university through support mode. */
  supportSessionId: string | null;
  /** Set when a Super Admin is viewing the learner app as this person. Everything is then read only. */
  viewedBy?: { userId: string; name: string };
};

/** What an action is being done to. Fill in every department and batch the record belongs to. */
export type Target = {
  universityId: string;
  departmentIds?: readonly string[];
  batchIds?: readonly string[];
  /** For self.* actions: whose record it is. */
  ownerUserId?: string;
};

export function isActive(a: Assignment, now = new Date()): boolean {
  return a.startsAt <= now && (a.endsAt === null || a.endsAt > now);
}

/** Does this assignment grant `action` at all (role grants it, and from this kind of scope)? */
function grants(a: Assignment, action: Action): boolean {
  const only = GRANTS_ONLY_AT[a.role];
  if (only && a.scopeType !== "platform" && !only.includes(a.scopeType)) return false;
  return ROLE_GRANTS[a.role].includes(action);
}

function scopeContains(a: Assignment, t: Target): boolean {
  switch (a.scopeType) {
    case "platform":
      // Platform roles never reach into a university directly. Support mode
      // gives them a temporary university assignment instead (see loadActor).
      return false;
    case "university":
      return a.universityId === t.universityId;
    case "department":
      return a.universityId === t.universityId && !!a.departmentId && (t.departmentIds ?? []).includes(a.departmentId);
    case "batch":
      return a.universityId === t.universityId && !!a.batchId && (t.batchIds ?? []).includes(a.batchId);
  }
}

export function can(actor: Actor, action: Action, target: Target, now = new Date()): boolean {
  if (actor.universityId !== null && actor.universityId !== target.universityId) return false;
  if (SELF_ACTIONS.has(action)) {
    if (!actor.userId || target.ownerUserId !== actor.userId) return false;
    // Your own records don't sit in a department or batch: any active role in this
    // university that grants the action is enough (a HOD or a faculty member whose
    // only role is in a department still has their own profile).
    return actor.assignments.some(
      (a) => isActive(a, now) && a.scopeType !== "platform" && a.universityId === target.universityId && ROLE_GRANTS[a.role].includes(action),
    );
  }

  return actor.assignments.some(
    (a) => isActive(a, now) && grants(a, action) && scopeContains(a, target),
  );
}

/** Platform-level actions (Zinny team panel): no university target. */
export function canPlatform(actor: Actor, action: Action, now = new Date()): boolean {
  return actor.assignments.some(
    (a) => a.scopeType === "platform" && isActive(a, now) && ROLE_GRANTS[a.role].includes(action),
  );
}

export function assertCan(actor: Actor, action: Action, target: Target): void {
  if (!can(actor, action, target)) throw new ForbiddenError();
}

export function assertPlatform(actor: Actor, action: Action): void {
  if (!canPlatform(actor, action)) throw new ForbiddenError();
}

/**
 * Departments and batches where the actor holds a given action.
 * Used to filter lists ("HOD sees own department", "faculty sees own batches").
 * `all: true` means the action covers the whole university.
 */
export function reach(actor: Actor, action: Action, universityId: string, now = new Date()) {
  const result = { all: false, departmentIds: new Set<string>(), batchIds: new Set<string>() };
  for (const a of actor.assignments) {
    if (!isActive(a, now) || !grants(a, action) || a.universityId !== universityId) continue;
    if (a.scopeType === "university") result.all = true;
    if (a.scopeType === "department" && a.departmentId) result.departmentIds.add(a.departmentId);
    if (a.scopeType === "batch" && a.batchId) result.batchIds.add(a.batchId);
  }
  return result;
}

export function hasRole(actor: Actor, roles: readonly RoleName[], now = new Date()): boolean {
  return actor.assignments.some((a) => isActive(a, now) && roles.includes(a.role));
}
