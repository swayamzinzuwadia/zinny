/**
 * Students and their departments. Inside the institute a student only sees the courses
 * and batches of the departments they belong to; a student in no department sees none.
 * The marketplace is separate and stays open to everyone.
 *
 * Admitting a student (from a join request) and changing their departments needs
 * `user.admit`. Admins reach every department; a HOD only their own, checked one
 * department at a time so a HOD can never add or remove someone else's.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { departments, roleAssignments, studentDepartments, users } from "@/db/schema";
import { assertCan, isActive, type Actor } from "../authz/engine";
import { NotFoundError, ValidationError } from "../errors";
import { audit, withTenant } from "../tenant";

const LEARNER_ROLES = new Set(["student", "alumni", "individual_learner", "parent"]);

function uni(actor: Actor) {
  return actor.universityId!;
}

/**
 * The departments whose courses this actor may see in the learner app, or null when they
 * aren't limited: staff (anyone holding a role other than a learner's) see everything.
 */
export async function learnerDepartmentScope(tx: Tx, actor: Actor): Promise<Set<string> | null> {
  const now = new Date();
  const here = actor.assignments.filter((a) => isActive(a, now) && a.universityId === uni(actor));
  if (here.some((a) => !LEARNER_ROLES.has(a.role))) return null;
  const rows = await tx
    .select({ departmentId: studentDepartments.departmentId })
    .from(studentDepartments)
    .where(eq(studentDepartments.userId, actor.userId));
  return new Set(rows.map((r) => r.departmentId));
}

async function checkDepartments(tx: Tx, actor: Actor, departmentIds: string[]) {
  if (departmentIds.length === 0) return;
  const found = await tx.select({ id: departments.id }).from(departments).where(inArray(departments.id, departmentIds));
  if (found.length !== new Set(departmentIds).size) throw new NotFoundError("Department");
  for (const d of departmentIds) assertCan(actor, "user.admit", { universityId: uni(actor), departmentIds: [d] });
}

/** Gives the person the student role here (if they don't have it) inside an open transaction. */
export async function ensureStudentRoleTx(tx: Tx, actor: Actor, userId: string) {
  const [has] = await tx
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, userId),
        eq(roleAssignments.universityId, uni(actor)),
        eq(roleAssignments.role, "student"),
        isNull(roleAssignments.revokedAt),
      ),
    );
  if (has) return false;
  const [row] = await tx
    .insert(roleAssignments)
    .values({ userId, role: "student", scopeType: "university", universityId: uni(actor), createdBy: actor.userId || null })
    .returning({ id: roleAssignments.id });
  await audit(tx, actor, "role.assign", "role_assignment", row.id, { userId, role: "student" });
  return true;
}

/** Adds departments to a student inside an open transaction. Permission is the caller's job. */
export async function addStudentDepartmentsTx(tx: Tx, actor: Actor, userId: string, departmentIds: string[]) {
  if (departmentIds.length === 0) return;
  await tx
    .insert(studentDepartments)
    .values([...new Set(departmentIds)].map((departmentId) => ({ universityId: uni(actor), userId, departmentId, createdBy: actor.userId || null })))
    .onConflictDoNothing();
  await audit(tx, actor, "student.departments_add", "user", userId, { departmentIds });
}

/** Lets a person in as a student of the given departments (at least one), e.g. when a join request is accepted. */
export async function admitStudentTx(tx: Tx, actor: Actor, userId: string, departmentIds: string[]) {
  if (departmentIds.length === 0) throw new ValidationError("Pick at least one department for this student.");
  await checkDepartments(tx, actor, departmentIds);
  await ensureStudentRoleTx(tx, actor, userId);
  await addStudentDepartmentsTx(tx, actor, userId, departmentIds);
}

/** The departments of each given student, for the Students page. */
export async function studentDepartmentMap(actor: Actor, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { id: string; name: string }[]>();
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({ userId: studentDepartments.userId, id: departments.id, name: departments.name })
      .from(studentDepartments)
      .innerJoin(departments, eq(departments.id, studentDepartments.departmentId))
      .where(inArray(studentDepartments.userId, userIds))
      .orderBy(departments.name);
    const map = new Map<string, { id: string; name: string }[]>();
    for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), { id: r.id, name: r.name }]);
    return map;
  });
}

/**
 * Sets a student's departments to exactly `departmentIds`. Only the departments that
 * change are checked, so a HOD can manage their own department on a student who also
 * belongs to others.
 */
export async function setStudentDepartments(actor: Actor, userId: string, departmentIds: string[]) {
  return withTenant(actor, async (tx) => {
    const [person] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    const [student] = await tx
      .select({ id: roleAssignments.id })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, userId),
          eq(roleAssignments.universityId, uni(actor)),
          inArray(roleAssignments.role, ["student", "alumni"]),
          isNull(roleAssignments.revokedAt),
        ),
      );
    if (!person || !student) throw new NotFoundError("Student");
    const current = new Set(
      (await tx.select({ d: studentDepartments.departmentId }).from(studentDepartments).where(eq(studentDepartments.userId, userId))).map((r) => r.d),
    );
    const wanted = new Set(departmentIds);
    const added = [...wanted].filter((d) => !current.has(d));
    const removed = [...current].filter((d) => !wanted.has(d));
    if (added.length === 0 && removed.length === 0) return { added: 0, removed: 0 };
    await checkDepartments(tx, actor, [...added, ...removed]);
    if (removed.length) {
      await tx.delete(studentDepartments).where(and(eq(studentDepartments.userId, userId), inArray(studentDepartments.departmentId, removed)));
      await audit(tx, actor, "student.departments_remove", "user", userId, { departmentIds: removed });
    }
    await addStudentDepartmentsTx(tx, actor, userId, added);
    return { added: added.length, removed: removed.length };
  });
}
