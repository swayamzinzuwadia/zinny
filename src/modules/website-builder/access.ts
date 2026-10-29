/**
 * Who may do what in the website module.
 *  - `website.manage` (Institute Admin): everything in the Website section.
 *  - `self.profile` + a teaching role: your own public faculty profile ("My profile page").
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { batches, courses, roleAssignments, type RoleName } from "@/db/schema";
import { assertCan, can, peopleLite, type Actor } from "@/server/core";
import { isActive } from "@/server/authz/engine";
import { ForbiddenError } from "@/server/errors";

/** Roles that teach, and so may have a public faculty profile. */
export const TEACHING_ROLES: readonly RoleName[] = ["hod", "permanent_faculty", "visiting_faculty"];

/** Roles that work in the admin panel: possible blog authors. */
const STAFF_ROLES: readonly RoleName[] = ["institute_admin", "board_owner", "accounts_fees", "hod", "permanent_faculty", "visiting_faculty"];

export function uniOf(actor: Actor): string {
  if (!actor.universityId) throw new ForbiddenError("Open a university first.");
  return actor.universityId;
}

export function canManageSite(actor: Actor): boolean {
  return !!actor.universityId && can(actor, "website.manage", { universityId: actor.universityId });
}

export function assertManage(actor: Actor): string {
  const universityId = uniOf(actor);
  assertCan(actor, "website.manage", { universityId });
  return universityId;
}

/** Teaching staff right now (HOD, permanent or visiting faculty) in the actor's university. */
export function isTeachingStaff(actor: Actor, now = new Date()): boolean {
  return actor.assignments.some((a) => isActive(a, now) && a.universityId === actor.universityId && TEACHING_ROLES.includes(a.role));
}

/** Your own faculty profile: `self.profile` on yourself, and you must teach here. */
export function assertOwnProfile(actor: Actor, userId: string): string {
  const universityId = uniOf(actor);
  assertCan(actor, "self.profile", { universityId, ownerUserId: userId });
  if (!isTeachingStaff(actor)) throw new ForbiddenError("Public profiles are for teaching staff. Ask an Institute Admin if you teach here.");
  return universityId;
}

type Row = typeof roleAssignments.$inferSelect;

async function activeAssignments(tx: Tx, universityId: string, roles?: readonly RoleName[]): Promise<Row[]> {
  const rows = await tx
    .select()
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.universityId, universityId),
        isNull(roleAssignments.revokedAt),
        roles ? inArray(roleAssignments.role, [...roles]) : undefined,
      ),
    );
  const now = new Date();
  return rows.filter((r) => r.startsAt <= now && (!r.endsAt || r.endsAt > now));
}

/**
 * Everyone who may manage the website (holds `website.manage` for the whole university):
 * the people who are notified about enquiries and can be assigned one.
 */
export async function websiteManagerIds(tx: Tx, universityId: string): Promise<string[]> {
  const rows = await activeAssignments(tx, universityId);
  const byUser = new Map<string, Row[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  const out: string[] = [];
  for (const [userId, list] of byUser) {
    const actor: Actor = {
      userId,
      name: "",
      email: "",
      universityId,
      supportSessionId: null,
      assignments: list.map((r) => ({
        role: r.role,
        scopeType: r.scopeType,
        universityId: r.universityId,
        departmentId: r.departmentId,
        batchId: r.batchId,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
      })),
    };
    if (can(actor, "website.manage", { universityId })) out.push(userId);
  }
  return out;
}

export async function websiteManagers(tx: Tx, universityId: string) {
  const people = await peopleLite(tx, await websiteManagerIds(tx, universityId));
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

/** People who work in the admin panel, by name (blog author choices). */
export async function staffPeople(tx: Tx, universityId: string) {
  const rows = await activeAssignments(tx, universityId, STAFF_ROLES);
  const people = await peopleLite(tx, [...new Set(rows.map((r) => r.userId))]);
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

/** Teaching staff (user ids) right now. */
export async function teachingStaffIds(tx: Tx, universityId: string): Promise<string[]> {
  const rows = await activeAssignments(tx, universityId, TEACHING_ROLES);
  return [...new Set(rows.map((r) => r.userId))];
}

/** Courses each person teaches now (from their batch assignments), published courses only. */
export async function coursesTaughtBy(tx: Tx, universityId: string, userIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  const rows = (await activeAssignments(tx, universityId, ["permanent_faculty", "visiting_faculty"])).filter(
    (r) => r.scopeType === "batch" && r.batchId && userIds.includes(r.userId),
  );
  if (rows.length === 0) return out;
  const bs = await tx
    .select({ id: batches.id, courseId: batches.courseId, status: courses.status })
    .from(batches)
    .innerJoin(courses, eq(courses.id, batches.courseId))
    .where(inArray(batches.id, rows.map((r) => r.batchId!)));
  const courseOf = new Map(bs.filter((b) => b.status === "published").map((b) => [b.id, b.courseId]));
  for (const r of rows) {
    const c = courseOf.get(r.batchId!);
    if (!c) continue;
    const list = out.get(r.userId) ?? [];
    if (!list.includes(c)) list.push(c);
    out.set(r.userId, list);
  }
  return out;
}
