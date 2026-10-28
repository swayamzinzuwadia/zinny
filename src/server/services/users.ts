/**
 * Users section (PRD pages 2, 3 and 7): people lists by group, adding people,
 * giving and removing roles, CSV import, graduation to alumni, parent links.
 */
import Papa from "papaparse";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import {
  batches,
  courses,
  departments,
  enrolments,
  parentLinks,
  roleAssignments,
  users,
  type RoleName,
} from "@/db/schema";
import { assertCan, can, reach, type Actor } from "../authz/engine";
import { ALLOWED_SCOPES, ROLE_LABELS, USER_GROUPS } from "../authz/roles";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { audit, withTenant } from "../tenant";

const UNIVERSITY_ROLES = Object.keys(ALLOWED_SCOPES) as RoleName[];
const FACULTY_ROLES: RoleName[] = ["permanent_faculty", "visiting_faculty"];
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function uni(actor: Actor) {
  return actor.universityId!;
}

export type PersonRole = {
  assignmentId: string;
  role: RoleName;
  label: string;
  scope: string;
  endsAt: Date | null;
};
export type Person = { id: string; name: string; email: string; phone: string | null; roles: PersonRole[] };

/* ─────────────────────────── Lists ─────────────────────────── */

export async function listPeople(actor: Actor, group: keyof typeof USER_GROUPS): Promise<Person[]> {
  const r = reach(actor, "user.view", uni(actor));
  if (!r.all && r.departmentIds.size === 0 && r.batchIds.size === 0) return [];
  const groupRoles = USER_GROUPS[group] as readonly RoleName[];

  return withTenant(actor, async (tx) => {
    const rows = await tx
      .select({
        assignmentId: roleAssignments.id,
        userId: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: roleAssignments.role,
        scopeType: roleAssignments.scopeType,
        startsAt: roleAssignments.startsAt,
        endsAt: roleAssignments.endsAt,
        departmentId: roleAssignments.departmentId,
        batchId: roleAssignments.batchId,
        deptName: departments.name,
        batchName: batches.name,
        batchDeptId: batches.departmentId,
        batchCourse: courses.title,
      })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .leftJoin(departments, eq(departments.id, roleAssignments.departmentId))
      .leftJoin(batches, eq(batches.id, roleAssignments.batchId))
      .leftJoin(courses, eq(courses.id, batches.courseId))
      .where(and(isNull(roleAssignments.revokedAt), inArray(roleAssignments.role, [...groupRoles])))
      .orderBy(users.name);

    // Expired visiting faculty stay in the list (shown as ended) until their role is removed.
    let visible = rows;

    if (!r.all) {
      // Scoped viewers: HOD sees their department, faculty see their students.
      const allowedUsers = new Set<string>();
      if (group === "teaching" && r.departmentIds.size > 0) {
        for (const x of rows) {
          const dept = x.departmentId ?? x.batchDeptId;
          if (dept && r.departmentIds.has(dept)) allowedUsers.add(x.userId);
        }
      }
      if (group === "students") {
        const scoped = await tx
          .selectDistinct({ userId: enrolments.userId })
          .from(enrolments)
          .innerJoin(batches, eq(batches.id, enrolments.batchId))
          .where(
            and(
              inArray(enrolments.status, ["held", "active", "completed"]),
              sql`(${r.departmentIds.size > 0 ? inArray(batches.departmentId, [...r.departmentIds]) : sql`false`}
                or ${r.batchIds.size > 0 ? inArray(batches.id, [...r.batchIds]) : sql`false`})`,
            ),
          );
        scoped.forEach((s) => allowedUsers.add(s.userId));
      }
      visible = visible.filter((x) => allowedUsers.has(x.userId));
    }

    const people = new Map<string, Person>();
    for (const x of visible) {
      const p = people.get(x.userId) ?? { id: x.userId, name: x.name, email: x.email, phone: x.phone, roles: [] };
      const scope =
        x.scopeType === "department"
          ? (x.deptName ?? "Department")
          : x.scopeType === "batch"
            ? `${x.batchCourse ?? "Course"} · ${x.batchName ?? "Batch"}`
            : "Whole university";
      p.roles.push({ assignmentId: x.assignmentId, role: x.role, label: ROLE_LABELS[x.role], scope, endsAt: x.endsAt });
      people.set(x.userId, p);
    }
    return [...people.values()];
  });
}

/* ─────────────────────────── Roles ─────────────────────────── */

export type RoleInput = {
  userId: string;
  role: RoleName;
  departmentId?: string | null;
  batchId?: string | null;
  endsAt?: Date | null;
};

/**
 * Gives someone a role in a scope. Institute Admin can give any university role.
 * A HOD can only give faculty roles inside their own department.
 */
async function assignRoleTx(tx: Tx, actor: Actor, input: RoleInput) {
  const allowed = ALLOWED_SCOPES[input.role];
  if (!allowed) throw new ValidationError("That role can't be given inside a university.");

  let departmentId: string | null = null;
  let scopeType: "university" | "department" | "batch";
  if (input.batchId) {
    scopeType = "batch";
    const [b] = await tx.select().from(batches).where(eq(batches.id, input.batchId));
    if (!b) throw new NotFoundError("Batch");
    departmentId = b.departmentId;
  } else if (input.departmentId) {
    scopeType = "department";
    departmentId = input.departmentId;
  } else {
    scopeType = "university";
  }
  if (!allowed.includes(scopeType)) {
    throw new ValidationError(`${ROLE_LABELS[input.role]} is given at ${allowed.join(" or ")} level.`);
  }
  if (input.role === "visiting_faculty" && !input.endsAt) {
    throw new ValidationError("Visiting faculty need an access end date.");
  }

  const target = { universityId: uni(actor), departmentIds: departmentId ? [departmentId] : [] };
  const isAdmin = can(actor, "user.manage_roles", { universityId: uni(actor) });
  if (!isAdmin) {
    // HOD path: faculty roles in their own department only.
    if (!FACULTY_ROLES.includes(input.role) || !departmentId || !can(actor, "user.manage_roles", target)) {
      throw new ForbiddenError("You can only add faculty to your own department.");
    }
  }

  const [dup] = await tx
    .select()
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.userId, input.userId),
        eq(roleAssignments.role, input.role),
        isNull(roleAssignments.revokedAt),
        input.batchId ? eq(roleAssignments.batchId, input.batchId) : isNull(roleAssignments.batchId),
        scopeType === "department" ? eq(roleAssignments.departmentId, departmentId!) : isNull(roleAssignments.departmentId),
      ),
    );
  if (dup) return dup;

  const [a] = await tx
    .insert(roleAssignments)
    .values({
      userId: input.userId,
      role: input.role,
      scopeType,
      universityId: uni(actor),
      departmentId: scopeType === "department" ? departmentId : null,
      batchId: scopeType === "batch" ? input.batchId! : null,
      endsAt: input.endsAt ?? null,
      createdBy: actor.userId,
    })
    .returning();
  await audit(tx, actor, "role.assign", "role_assignment", a.id, {
    userId: input.userId,
    role: input.role,
    scopeType,
    departmentId,
    batchId: input.batchId ?? null,
  });
  return a;
}

export async function assignRole(actor: Actor, input: RoleInput) {
  return withTenant(actor, (tx) => assignRoleTx(tx, actor, input));
}

export async function revokeRole(actor: Actor, assignmentId: string) {
  return withTenant(actor, async (tx) => {
    const [a] = await tx.select().from(roleAssignments).where(eq(roleAssignments.id, assignmentId));
    if (!a) throw new NotFoundError("Role");
    let departmentId = a.departmentId;
    if (a.batchId) {
      const [b] = await tx.select().from(batches).where(eq(batches.id, a.batchId));
      departmentId = b?.departmentId ?? null;
    }
    const isAdmin = can(actor, "user.manage_roles", { universityId: uni(actor) });
    const hodOk =
      FACULTY_ROLES.includes(a.role) &&
      !!departmentId &&
      can(actor, "user.manage_roles", { universityId: uni(actor), departmentIds: [departmentId] });
    if (!isAdmin && !hodOk) throw new ForbiddenError();
    if (a.userId === actor.userId && a.role === "institute_admin") {
      throw new ValidationError("You can't remove your own admin role.");
    }
    await tx.update(roleAssignments).set({ revokedAt: new Date() }).where(eq(roleAssignments.id, assignmentId));
    await audit(tx, actor, "role.revoke", "role_assignment", assignmentId, { userId: a.userId, role: a.role });
  });
}

/* ─────────────────────────── Adding people ─────────────────────────── */

async function upsertPerson(tx: Tx, email: string, name: string, phone?: string | null): Promise<string> {
  const res = await tx.execute<{ id: string }>(sql`select zinny_upsert_user(${email}, ${name}, ${phone ?? ""}) as id`);
  return res[0].id;
}

export type NewPerson = {
  name: string;
  email: string;
  phone?: string;
  role: RoleName;
  departmentId?: string | null;
  endsAt?: Date | null;
};

export async function addPerson(actor: Actor, input: NewPerson) {
  if (!emailRe.test(input.email)) throw new ValidationError("Enter a valid email.");
  if (input.name.trim().length < 2) throw new ValidationError("Enter the person's name.");
  return withTenant(actor, async (tx) => {
    const userId = await upsertPerson(tx, input.email, input.name, input.phone);
    await assignRoleTx(tx, actor, {
      userId,
      role: input.role,
      departmentId: input.departmentId ?? null,
      endsAt: input.endsAt ?? null,
    });
    await audit(tx, actor, "user.add", "user", userId, { email: input.email.toLowerCase(), role: input.role });
    return userId;
  });
}

/* ─────────────────────────── CSV import ─────────────────────────── */

export type ImportRow = {
  line: number;
  name: string;
  email: string;
  role: string;
  department: string;
  ok: boolean;
  error?: string;
};

/**
 * Bulk import of students and staff (PRD page 7).
 * Columns: name, email, phone, role, department, access_ends
 * Everything is checked first. Nothing is saved unless every row is valid.
 */
export async function importPeople(actor: Actor, csv: string, opts: { commit: boolean }) {
  assertCan(actor, "user.import", { universityId: uni(actor) });
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
  });
  if (!parsed.meta.fields?.includes("email") || !parsed.meta.fields?.includes("name") || !parsed.meta.fields?.includes("role")) {
    throw new ValidationError("The file needs at least these columns: name, email, role.");
  }

  return withTenant(actor, async (tx) => {
    const depts = await tx.select().from(departments);
    const byCode = new Map(depts.map((d) => [d.code.toUpperCase(), d]));
    const seen = new Set<string>();
    const rows: (ImportRow & { input?: NewPerson })[] = parsed.data.map((raw, i) => {
      const line = i + 2; // header is line 1
      const name = (raw.name ?? "").trim();
      const email = (raw.email ?? "").trim().toLowerCase();
      const role = (raw.role ?? "").trim().toLowerCase().replace(/[\s/&]+/g, "_") as RoleName;
      const department = (raw.department ?? "").trim().toUpperCase();
      const base = { line, name, email, role, department };
      const fail = (error: string) => ({ ...base, ok: false, error });

      if (name.length < 2) return fail("Name is missing.");
      if (!emailRe.test(email)) return fail("Email is not valid.");
      if (seen.has(email)) return fail("This email appears twice in the file.");
      seen.add(email);
      const scopes = ALLOWED_SCOPES[role];
      if (!scopes) return fail(`Unknown role "${raw.role}". Use student, permanent_faculty, visiting_faculty, hod, accounts_fees, board_owner or institute_admin.`);
      const needsDept = !scopes.includes("university");
      const dept = department ? byCode.get(department) : undefined;
      if (needsDept && !dept) return fail(department ? `No department with code ${department}.` : "This role needs a department code.");
      let endsAt: Date | null = null;
      if (raw.access_ends?.trim()) {
        endsAt = new Date(`${raw.access_ends.trim()}T23:59:59+05:30`);
        if (Number.isNaN(endsAt.getTime())) return fail("access_ends must look like 2027-03-31.");
      }
      if (role === "visiting_faculty" && !endsAt) return fail("Visiting faculty need an access_ends date.");
      return {
        ...base,
        ok: true,
        input: { name, email, phone: raw.phone?.trim(), role, departmentId: needsDept ? dept!.id : null, endsAt },
      };
    });

    const errors = rows.filter((r) => !r.ok).length;
    let saved = 0;
    if (opts.commit && errors === 0) {
      for (const r of rows) {
        const userId = await upsertPerson(tx, r.input!.email, r.input!.name, r.input!.phone);
        await assignRoleTx(tx, actor, {
          userId,
          role: r.input!.role,
          departmentId: r.input!.departmentId,
          endsAt: r.input!.endsAt,
        });
        saved++;
      }
      await audit(tx, actor, "user.import", "user", null, { rows: saved });
    }
    return {
      rows: rows.map(({ input: _input, ...r }) => r),
      total: rows.length,
      errors,
      saved,
    };
  });
}

/* ─────────────────────────── Graduation and parents ─────────────────────────── */

/** Student → alumni: keeps certificates, loses courses that belong to a program (PRD page 7). */
export async function graduate(actor: Actor, userId: string) {
  assertCan(actor, "user.graduate", { universityId: uni(actor) });
  return withTenant(actor, async (tx) => {
    const [student] = await tx
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, userId), eq(roleAssignments.role, "student"), isNull(roleAssignments.revokedAt)));
    if (!student) throw new ConflictError("This person is not a current student.");
    await tx.update(roleAssignments).set({ revokedAt: new Date() }).where(eq(roleAssignments.id, student.id));
    await tx.insert(roleAssignments).values({
      userId,
      role: "alumni",
      scopeType: "university",
      universityId: uni(actor),
      createdBy: actor.userId,
    });
    const programCourses = tx
      .select({ id: courses.id })
      .from(courses)
      .where(sql`${courses.programId} is not null`);
    const ended = await tx
      .update(enrolments)
      .set({ status: "ended" })
      .where(
        and(
          eq(enrolments.userId, userId),
          inArray(enrolments.status, ["held", "active"]),
          inArray(enrolments.courseId, programCourses),
        ),
      )
      .returning({ id: enrolments.id });
    await audit(tx, actor, "user.graduate", "user", userId, { endedEnrolments: ended.length });
    return { endedEnrolments: ended.length };
  });
}

/** Links a parent to a student for a read-only view. Creates the parent's account if needed. */
export async function linkParent(actor: Actor, input: { studentUserId: string; parentEmail: string; parentName: string; phone?: string }) {
  assertCan(actor, "user.link_parent", { universityId: uni(actor) });
  if (!emailRe.test(input.parentEmail)) throw new ValidationError("Enter a valid email.");
  return withTenant(actor, async (tx) => {
    const [student] = await tx
      .select()
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, input.studentUserId), inArray(roleAssignments.role, ["student", "alumni"]), isNull(roleAssignments.revokedAt)));
    if (!student) throw new NotFoundError("Student");
    const parentId = await upsertPerson(tx, input.parentEmail, input.parentName, input.phone);
    await assignRoleTx(tx, actor, { userId: parentId, role: "parent" });
    await tx
      .insert(parentLinks)
      .values({ universityId: uni(actor), parentUserId: parentId, studentUserId: input.studentUserId })
      .onConflictDoNothing();
    await audit(tx, actor, "user.link_parent", "user", input.studentUserId, { parentId });
    return parentId;
  });
}

/** Faculty who can be put on a batch in a department: anyone with a faculty or HOD role there. */
export async function teachersForDepartment(actor: Actor, departmentId: string) {
  assertCan(actor, "batch.assign_faculty", { universityId: uni(actor), departmentIds: [departmentId] });
  return withTenant(actor, async (tx) => {
    const rows = await tx
      .selectDistinct({ id: users.id, name: users.name, email: users.email, role: roleAssignments.role, endsAt: roleAssignments.endsAt })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(
        and(
          isNull(roleAssignments.revokedAt),
          eq(roleAssignments.scopeType, "department"),
          inArray(roleAssignments.role, ["hod", "permanent_faculty", "visiting_faculty"]),
          eq(roleAssignments.departmentId, departmentId),
        ),
      )
      .orderBy(users.name);
    const now = new Date();
    return rows.filter((r) => !r.endsAt || r.endsAt > now);
  });
}

export { UNIVERSITY_ROLES };
