import { randomUUID } from "node:crypto";
import { systemDb } from "@/db/client";
import { departments, roleAssignments, universities, users, type RoleName } from "@/db/schema";
import { loadActor } from "@/server/actor";

const tag = () => randomUUID().slice(0, 6);

export async function makeUniversity(name = "Test University") {
  const slug = `t-${tag()}`;
  const [u] = await systemDb()
    .insert(universities)
    .values({ name, slug, invoicePrefix: "TU", gstin: "27AAAAA0000A1Z5", legalName: `${name} Trust` })
    .returning();
  return u;
}

export async function makeUser(name: string) {
  const [u] = await systemDb()
    .insert(users)
    .values({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}.${tag()}@test.zinny` })
    .returning();
  return u;
}

export async function grant(
  userId: string,
  role: RoleName,
  scope: { universityId?: string; departmentId?: string; batchId?: string } = {},
  endsAt: Date | null = null,
) {
  const scopeType = scope.batchId ? "batch" : scope.departmentId ? "department" : scope.universityId ? "university" : "platform";
  await systemDb()
    .insert(roleAssignments)
    .values({
      userId,
      role,
      scopeType,
      universityId: scope.universityId ?? null,
      departmentId: scope.batchId ? null : (scope.departmentId ?? null),
      batchId: scope.batchId ?? null,
      endsAt,
    });
}

export async function makeDepartment(universityId: string, code: string, name: string) {
  const [d] = await systemDb().insert(departments).values({ universityId, code, name }).returning();
  return d;
}

/** A person with one role, returned as a ready-to-use actor. */
export async function person(
  name: string,
  role: RoleName,
  scope: { universityId?: string; departmentId?: string; batchId?: string },
  endsAt: Date | null = null,
) {
  const u = await makeUser(name);
  await grant(u.id, role, scope, endsAt);
  return { user: u, actor: () => loadActor(u.id, scope.universityId ?? null) };
}

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const slots = (days: number[], start: string, end: string) => days.map((weekday) => ({ weekday, startTime: start, endTime: end }));
