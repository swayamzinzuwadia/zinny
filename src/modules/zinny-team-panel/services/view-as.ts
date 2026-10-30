/**
 * "View as student" for Super Admins: seeing the learner app as one person sees it, read
 * only. Starting and stopping land in the institute's own audit log.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { roleAssignments, universities, type RoleName } from "@/db/schema";
import type { Actor } from "@/server/core";
import { ValidationError } from "@/server/errors";
import { assertSuperAdmin } from "../lib/access";
import { db, isUuid, logAction } from "./shared";

export const LEARNER_ROLES = ["student", "alumni", "individual_learner", "parent"] as const satisfies readonly RoleName[];

export async function startViewAs(actor: Actor, universityId: string, userId: string): Promise<{ slug: string }> {
  assertSuperAdmin(actor);
  if (!isUuid(universityId) || !isUuid(userId)) throw new ValidationError("Pick a student to view as.");
  const [row] = await db()
    .select({ slug: universities.slug })
    .from(roleAssignments)
    .innerJoin(universities, eq(universities.id, roleAssignments.universityId))
    .where(
      and(
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.universityId, universityId),
        inArray(roleAssignments.role, [...LEARNER_ROLES]),
        isNull(roleAssignments.revokedAt),
      ),
    );
  if (!row) throw new ValidationError("This person isn't a student at that institute.");
  await db().transaction((tx) => logAction(tx, actor, { universityId, inUniversityLog: true }, "plat.view_as.start", "user", userId));
  return { slug: row.slug };
}

export async function stopViewAs(actor: Actor, universityId: string, userId: string) {
  assertSuperAdmin(actor);
  await db().transaction((tx) => logAction(tx, actor, { universityId, inUniversityLog: true }, "plat.view_as.stop", "user", userId));
}
