import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { batches, courses, departments, programs, roleAssignments, users } from "@/db/schema";
import { assertCan, reach, type Actor } from "../authz/engine";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { audit, withTenant } from "../tenant";

function uni(actor: Actor) {
  return actor.universityId!;
}

/** Departments, each with its HOD, faculty and courses (PRD page 7). */
export async function listDepartments(actor: Actor) {
  const r = reach(actor, "department.view", uni(actor));
  if (!r.all && r.departmentIds.size === 0) return [];
  return withTenant(actor, async (tx) => {
    const depts = await tx
      .select()
      .from(departments)
      .where(r.all ? undefined : inArray(departments.id, [...r.departmentIds]))
      .orderBy(departments.name);
    if (depts.length === 0) return [];
    const ids = depts.map((d) => d.id);

    const now = new Date();
    const teaching = await tx
      .select({
        departmentId: sql<string>`coalesce(${roleAssignments.departmentId}, ${batches.departmentId})`,
        userId: roleAssignments.userId,
        role: roleAssignments.role,
        name: users.name,
        endsAt: roleAssignments.endsAt,
      })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .leftJoin(batches, eq(batches.id, roleAssignments.batchId))
      .where(
        and(
          isNull(roleAssignments.revokedAt),
          inArray(roleAssignments.role, ["hod", "permanent_faculty", "visiting_faculty"]),
        ),
      );
    const courseCounts = await tx
      .select({ departmentId: courses.departmentId, n: sql<number>`count(*)::int` })
      .from(courses)
      .where(inArray(courses.departmentId, ids))
      .groupBy(courses.departmentId);

    return depts.map((d) => {
      const mine = teaching.filter((t) => t.departmentId === d.id && (!t.endsAt || t.endsAt > now));
      return {
        ...d,
        hods: [...new Map(mine.filter((t) => t.role === "hod").map((t) => [t.userId, t.name])).values()],
        facultyCount: new Set(mine.filter((t) => t.role !== "hod").map((t) => t.userId)).size,
        courseCount: courseCounts.find((c) => c.departmentId === d.id)?.n ?? 0,
      };
    });
  });
}

export async function createDepartment(actor: Actor, input: { code: string; name: string }) {
  assertCan(actor, "department.manage", { universityId: uni(actor) });
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw new ValidationError("Code should be 2–12 letters or numbers, like CS or MKT.");
  if (name.length < 2) throw new ValidationError("Give the department a name.");
  return withTenant(actor, async (tx) => {
    const [dup] = await tx.select().from(departments).where(eq(departments.code, code));
    if (dup) throw new ConflictError(`A department with code ${code} already exists.`);
    const [dept] = await tx.insert(departments).values({ universityId: uni(actor), code, name }).returning();
    await audit(tx, actor, "department.create", "department", dept.id, { code, name });
    return dept;
  });
}

/** Makes someone the Head of Department. One HOD per department: the previous one is replaced. */
export async function setHod(actor: Actor, departmentId: string, userId: string) {
  assertCan(actor, "department.manage", { universityId: uni(actor), departmentIds: [departmentId] });
  return withTenant(actor, async (tx) => {
    const [dept] = await tx.select().from(departments).where(eq(departments.id, departmentId));
    if (!dept) throw new NotFoundError("Department");
    const [person] = await tx.select().from(users).where(eq(users.id, userId));
    if (!person) throw new NotFoundError("Person");
    await tx
      .update(roleAssignments)
      .set({ revokedAt: new Date() })
      .where(and(eq(roleAssignments.role, "hod"), eq(roleAssignments.departmentId, departmentId), isNull(roleAssignments.revokedAt)));
    const [a] = await tx
      .insert(roleAssignments)
      .values({ userId, role: "hod", scopeType: "department", universityId: uni(actor), departmentId, createdBy: actor.userId })
      .returning();
    await audit(tx, actor, "department.set_hod", "department", departmentId, { userId });
    return a;
  });
}

export async function createProgram(actor: Actor, input: { departmentId: string; name: string }) {
  assertCan(actor, "program.manage", { universityId: uni(actor), departmentIds: [input.departmentId] });
  return withTenant(actor, async (tx) => {
    const [p] = await tx
      .insert(programs)
      .values({ universityId: uni(actor), departmentId: input.departmentId, name: input.name.trim() })
      .returning();
    await audit(tx, actor, "program.create", "program", p.id, { name: p.name });
    return p;
  });
}

export async function listPrograms(actor: Actor) {
  return withTenant(actor, (tx) => tx.select().from(programs).orderBy(programs.name));
}
