/**
 * Every account on Zinny, for Super Admins only: institute admins, staff, students,
 * parents, the Zinny team, and people who only signed up to buy on the marketplace. Institutes can't see each
 * other's people; this is the one place that looks across them, so each view is logged in
 * the activity log. Password hashes are never selected: only whether one is set.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { auditLog, batches, courses, customRoles, departments, enrolments, invoices, orders, roleAssignments, universities, users, type RoleName } from "@/db/schema";
import type { Actor } from "@/server/core";
import { NotFoundError } from "@/server/errors";
import { assertSuperAdmin } from "../lib/access";
import { AUTOMATED_ACTIONS, PLATFORM_ROLES, STAFF_ROLES } from "../lib/constants";
import { db, isUuid, logAction } from "./shared";

// "Learners", not "Students": the licence and the other pages count only the student role,
// and this group also holds alumni and individual learners.
export const PEOPLE_GROUPS = {
  all: { label: "Everyone", roles: null },
  students: { label: "Learners", roles: ["student", "alumni", "individual_learner"] },
  staff: { label: "Staff", roles: [...STAFF_ROLES] },
  parents: { label: "Parents", roles: ["parent"] },
  team: { label: "Zinny team", roles: [...PLATFORM_ROLES, "custom_platform"] },
} as const satisfies Record<string, { label: string; roles: readonly RoleName[] | null }>;

export type PeopleGroup = keyof typeof PEOPLE_GROUPS;
export const isPeopleGroup = (v: string): v is PeopleGroup => v in PEOPLE_GROUPS;

export const PEOPLE_PAGE_SIZE = 50;

export type PersonRow = {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  canSignIn: boolean;
  joinedAt: Date;
  /** Null for the Zinny team's own roles, and for an account that isn't at any institute. */
  universityId: string | null;
  universityName: string | null;
  universitySlug: string | null;
  /** Empty for someone with no role anywhere: a marketplace account. */
  roles: RoleName[];
  /** Names of the custom roles among `roles`, which only say "custom_institute" and the like. */
  customRoleNames: string[];
};

export type PeopleFilters = { q?: string; universityId?: string; group?: PeopleGroup; page?: number };

/**
 * One row per person per institute, by name. A person in two institutes shows twice; the
 * Zinny team's roles are a row of their own; an account with no role anywhere (someone
 * who signed up for the marketplace) shows once, with no institute.
 */
export async function listPeople(actor: Actor, filters: PeopleFilters): Promise<{ rows: PersonRow[]; hasMore: boolean; page: number }> {
  assertSuperAdmin(actor);
  const page = Math.max(1, filters.page ?? 1);
  const term = (filters.q ?? "").trim().slice(0, 80);
  const universityId = filters.universityId && isUuid(filters.universityId) ? filters.universityId : undefined;
  const group = filters.group ?? "all";
  const roles = PEOPLE_GROUPS[group].roles;
  const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;

  const rows = await db()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      canSignIn: sql<boolean>`${users.passwordHash} is not null`,
      joinedAt: users.createdAt,
      universityId: universities.id,
      universityName: universities.name,
      universitySlug: universities.slug,
      roles: sql<RoleName[]>`coalesce(array_agg(distinct ${roleAssignments.role}) filter (where ${roleAssignments.role} is not null), '{}')`,
      customRoleNames: sql<string[]>`coalesce(array_agg(distinct ${customRoles.name}) filter (where ${customRoles.name} is not null), '{}')`,
    })
    .from(users)
    .leftJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), isNull(roleAssignments.revokedAt)))
    .leftJoin(universities, eq(universities.id, roleAssignments.universityId))
    .leftJoin(customRoles, eq(customRoles.id, roleAssignments.customRoleId))
    .where(
      and(
        universityId ? eq(roleAssignments.universityId, universityId) : undefined,
        roles ? inArray(roleAssignments.role, [...roles]) : undefined,
        term ? or(ilike(users.name, like), ilike(users.email, like), ilike(users.phone, like)) : undefined,
      ),
    )
    .groupBy(users.id, universities.id)
    .orderBy(asc(sql`lower(${users.name})`), asc(universities.name))
    .limit(PEOPLE_PAGE_SIZE + 1)
    .offset((page - 1) * PEOPLE_PAGE_SIZE);

  await db().transaction((tx) => logAction(tx, actor, { universityId }, "plat.people.view", "user", null, { q: term, group, page }));
  return { rows: rows.slice(0, PEOPLE_PAGE_SIZE), hasMore: rows.length > PEOPLE_PAGE_SIZE, page };
}

export type InstitutePerson = { userId: string; name: string; email: string; canSignIn: boolean; roles: RoleName[] };

/**
 * The people of one institute for its page in the panel: admins and staff first, then
 * learners, with how many there are in all. Logged like any other look at the people list.
 */
export async function institutePeople(actor: Actor, universityId: string, limit = 8): Promise<{ rows: InstitutePerson[]; total: number }> {
  assertSuperAdmin(actor);
  if (!isUuid(universityId)) return { rows: [], total: 0 };
  const at = and(eq(roleAssignments.universityId, universityId), isNull(roleAssignments.revokedAt));
  const staffFirst = sql`min(case when ${roleAssignments.role} = 'institute_admin' then 0 when ${inArray(roleAssignments.role, [...STAFF_ROLES])} then 1 else 2 end)`;
  const [rows, [{ total }]] = await Promise.all([
    db()
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        canSignIn: sql<boolean>`${users.passwordHash} is not null`,
        roles: sql<RoleName[]>`array_agg(distinct ${roleAssignments.role})`,
      })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(at)
      .groupBy(users.id)
      .orderBy(staffFirst, asc(sql`lower(${users.name})`))
      .limit(Math.min(Math.max(limit, 1), 50)),
    db().select({ total: sql<number>`count(distinct ${roleAssignments.userId})`.mapWith(Number) }).from(roleAssignments).where(at),
  ]);
  await db().transaction((tx) => logAction(tx, actor, { universityId }, "plat.people.view", "user", null, { group: "all", page: 1, from: "institute" }));
  return { rows, total };
}

/** How many rows each group holds, for the filter tabs. Counts what `listPeople` lists. */
export async function peopleCounts(actor: Actor, universityId?: string): Promise<Record<PeopleGroup, number>> {
  assertSuperAdmin(actor);
  const scope = universityId && isUuid(universityId) ? universityId : undefined;
  const n = async (roles: readonly RoleName[] | null) => {
    const [r] = await db()
      .select({ n: sql<number>`count(distinct (${users.id}, ${roleAssignments.universityId}))`.mapWith(Number) })
      .from(users)
      .leftJoin(roleAssignments, and(eq(roleAssignments.userId, users.id), isNull(roleAssignments.revokedAt)))
      .where(and(scope ? eq(roleAssignments.universityId, scope) : undefined, roles ? inArray(roleAssignments.role, [...roles]) : undefined));
    return r.n;
  };
  const [all, students, staff, parents, team] = await Promise.all([
    n(PEOPLE_GROUPS.all.roles),
    n(PEOPLE_GROUPS.students.roles),
    n(PEOPLE_GROUPS.staff.roles),
    n(PEOPLE_GROUPS.parents.roles),
    n(PEOPLE_GROUPS.team.roles),
  ]);
  return { all, students, staff, parents, team };
}

/** Everything Zinny holds about one person, across every institute they belong to. */
export async function personDetail(actor: Actor, userId: string) {
  assertSuperAdmin(actor);
  if (!isUuid(userId)) throw new NotFoundError("Person");
  const conn = db();
  const [person] = await conn
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      canSignIn: sql<boolean>`${users.passwordHash} is not null`,
      joinedAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!person) throw new NotFoundError("Person");

  const [roles, courseRows, payments, activity] = await Promise.all([
    conn
      .select({
        id: roleAssignments.id,
        role: roleAssignments.role,
        scopeType: roleAssignments.scopeType,
        universityId: universities.id,
        universityName: universities.name,
        universitySlug: universities.slug,
        universityStatus: universities.status,
        departmentName: departments.name,
        batchName: batches.name,
        startsAt: roleAssignments.startsAt,
        endsAt: roleAssignments.endsAt,
        revokedAt: roleAssignments.revokedAt,
        customRoleName: customRoles.name,
      })
      .from(roleAssignments)
      .leftJoin(customRoles, eq(customRoles.id, roleAssignments.customRoleId))
      .leftJoin(universities, eq(universities.id, roleAssignments.universityId))
      .leftJoin(departments, eq(departments.id, roleAssignments.departmentId))
      .leftJoin(batches, eq(batches.id, roleAssignments.batchId))
      .where(eq(roleAssignments.userId, userId))
      .orderBy(asc(universities.name), desc(roleAssignments.createdAt)),
    conn
      .select({
        id: enrolments.id,
        status: enrolments.status,
        enrolledAt: enrolments.enrolledAt,
        courseTitle: courses.title,
        batchName: batches.name,
        universityName: universities.name,
      })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .innerJoin(batches, eq(batches.id, enrolments.batchId))
      .innerJoin(universities, eq(universities.id, enrolments.universityId))
      .where(eq(enrolments.userId, userId))
      .orderBy(desc(enrolments.createdAt)),
    conn
      .select({
        id: orders.id,
        status: orders.status,
        totalPaise: orders.totalPaise,
        paidAt: orders.paidAt,
        createdAt: orders.createdAt,
        courseTitle: courses.title,
        invoiceNumber: invoices.number,
        universityName: universities.name,
      })
      .from(orders)
      .innerJoin(courses, eq(courses.id, orders.courseId))
      .innerJoin(universities, eq(universities.id, orders.universityId))
      .leftJoin(invoices, eq(invoices.orderId, orders.id))
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt)),
    conn
      .select({ id: auditLog.id, action: auditLog.action, at: auditLog.at, universityName: universities.name })
      .from(auditLog)
      .leftJoin(universities, eq(universities.id, auditLog.universityId))
      .where(and(eq(auditLog.actorUserId, userId), notInArray(auditLog.action, [...AUTOMATED_ACTIONS])))
      .orderBy(desc(auditLog.at))
      .limit(15),
  ]);

  // The view lands in each institute's own log, so an institute can see that it happened.
  const institutes = [...new Set(roles.map((r) => r.universityId).filter((id): id is string => !!id))];
  await conn.transaction(async (tx) => {
    for (const universityId of institutes) {
      await logAction(tx, actor, { universityId, inUniversityLog: true }, "plat.person.view", "user", userId);
    }
    if (institutes.length === 0) await logAction(tx, actor, {}, "plat.person.view", "user", userId);
  });

  return { person, roles, courses: courseRows, payments, activity };
}
